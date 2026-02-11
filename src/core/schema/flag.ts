/**
 * Flag schema builder with full type inference.
 *
 * Each factory (`flag.string()`, `flag.boolean()`, etc.) returns an immutable
 * `FlagBuilder` whose generic parameter tracks the value type and presence
 * state. Chained modifiers (`.default()`, `.required()`, `.alias()`, …) return
 * new builders with updated type-level and runtime state.
 *
 * @module dreamcli/core/schema/flag
 */

import type { PromptConfig } from './prompt.ts';

// ---------------------------------------------------------------------------
// Type-level configuration (phantom state tracked through the chain)
// ---------------------------------------------------------------------------

/**
 * Presence describes whether a flag value is guaranteed to exist when the
 * action handler runs:
 *
 * - `'optional'`  — may be `undefined` if not supplied
 * - `'required'`  — must be supplied; error if missing
 * - `'defaulted'` — always present (falls back to default value)
 */
type FlagPresence = 'optional' | 'required' | 'defaulted';

/**
 * Compile-time state carried through the builder chain.
 *
 * Adding new tracked properties only requires extending this interface — no
 * builder signature changes.
 */
interface FlagConfig {
	/** The resolved value type (e.g. `string`, `number`, `'us' | 'eu'`). */
	readonly valueType: unknown;
	/** Whether the flag is optional, required, or has a default. */
	readonly presence: FlagPresence;
}

// ---------------------------------------------------------------------------
// Type-level helpers
// ---------------------------------------------------------------------------

/** Replace the presence in a config. */
type WithPresence<C extends FlagConfig, P extends FlagPresence> = {
	readonly valueType: C['valueType'];
	readonly presence: P;
};

/**
 * Compute the final value type from config — this is what handlers receive.
 *
 * - `'optional'`   → `T | undefined`
 * - `'required'`   → `T`
 * - `'defaulted'`  → `T`
 */
type ResolvedValue<C extends FlagConfig> = C['presence'] extends 'optional'
	? C['valueType'] | undefined
	: C['valueType'];

/** Extract the resolved value type from a `FlagBuilder`. */
type InferFlag<B> = B extends FlagBuilder<infer C extends FlagConfig> ? ResolvedValue<C> : never;

/** Extract resolved value types from a record of builders. */
type InferFlags<T extends Record<string, FlagBuilder<FlagConfig>>> = {
	[K in keyof T]: InferFlag<T[K]>;
};

// ---------------------------------------------------------------------------
// Runtime schema data
// ---------------------------------------------------------------------------

/** Discriminator for the kind of value a flag accepts. */
type FlagKind = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'custom';

/**
 * Custom parse function for `flag.custom()`.
 *
 * Receives `string` from CLI argv and env vars, or any JSON-representable
 * value from config files. Narrow inside the function as needed.
 */
type FlagParseFn<T> = (raw: unknown) => T;

/**
 * The runtime descriptor stored inside every `FlagBuilder`. Consumers (parser,
 * help generator, resolution chain) read this to understand the flag's shape
 * without touching generics.
 */
interface FlagSchema {
	/** What kind of value this flag accepts. */
	readonly kind: FlagKind;
	/** Current presence state. */
	readonly presence: FlagPresence;
	/** Runtime default value (if any). */
	readonly defaultValue: unknown;
	/** Short/long aliases (e.g. `['f']` for `--force`). */
	readonly aliases: readonly string[];
	/** Environment variable name for v0.2+ resolution. */
	readonly envVar: string | undefined;
	/** Dotted config path for v0.2+ resolution (e.g. `'deploy.region'`). */
	readonly configPath: string | undefined;
	/** Human-readable description for help text. */
	readonly description: string | undefined;
	/** Allowed literal values when `kind === 'enum'`. */
	readonly enumValues: readonly string[] | undefined;
	/** Element schema when `kind === 'array'`. */
	readonly elementSchema: FlagSchema | undefined;
	/** Interactive prompt configuration for v0.3+ resolution. */
	readonly prompt: PromptConfig | undefined;
	/** Custom parse function (only when `kind === 'custom'`). */
	readonly parseFn: FlagParseFn<unknown> | undefined;
	/**
	 * Deprecation marker.
	 *
	 * - `undefined` — not deprecated (default)
	 * - `true` — deprecated with no migration message
	 * - `string` — deprecated with a reason/migration message
	 *
	 * When a deprecated flag is used, a warning is emitted to stderr.
	 * Help text shows `[deprecated]` or `[deprecated: <reason>]`.
	 */
	readonly deprecated: string | true | undefined;
	/**
	 * Whether this flag propagates to subcommands in nested command trees.
	 *
	 * When `true`, the flag is automatically available to all descendant
	 * commands. A child command that defines a flag with the same name
	 * shadows the propagated parent flag.
	 *
	 * Defaults to `false`.
	 */
	readonly propagate: boolean;
}

/** Create base schema data with sensible defaults. */
function createSchema(kind: FlagKind, overrides?: Partial<FlagSchema>): FlagSchema {
	return {
		kind,
		presence: 'optional',
		defaultValue: undefined,
		aliases: [],
		envVar: undefined,
		configPath: undefined,
		description: undefined,
		enumValues: undefined,
		elementSchema: undefined,
		prompt: undefined,
		parseFn: undefined,
		deprecated: undefined,
		propagate: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// FlagBuilder — immutable builder with type-level tracking
// ---------------------------------------------------------------------------

/**
 * Immutable flag schema builder.
 *
 * The type parameter `C` is a phantom that tracks the value type and presence
 * through the fluent chain. Each modifier returns a **new** builder — the
 * original is never mutated.
 *
 * @example
 * ```ts
 * const port = flag.number().default(8080);
 * type Port = InferFlag<typeof port>; // number
 *
 * const region = flag.enum(['us', 'eu', 'ap']);
 * type Region = InferFlag<typeof region>; // 'us' | 'eu' | 'ap' | undefined
 * ```
 */
class FlagBuilder<C extends FlagConfig> {
	/** @internal Runtime schema descriptor. */
	readonly schema: FlagSchema;

	/**
	 * @internal Type brand — exists only in the type system (`declare`
	 * produces no runtime property). Used by `InferFlag` / `InferFlags`.
	 */
	declare readonly _config: C;

	constructor(schema: FlagSchema) {
		this.schema = schema;
	}

	// -- Presence modifiers --------------------------------------------------

	/**
	 * Provide a default value. The flag becomes "always present" — handlers
	 * will never see `undefined`.
	 *
	 * The generic constraint `V extends C['valueType']` ensures the default
	 * matches the flag's declared type.
	 */
	default<V extends C['valueType']>(value: V): FlagBuilder<WithPresence<C, 'defaulted'>> {
		return new FlagBuilder({
			...this.schema,
			presence: 'defaulted',
			defaultValue: value,
		});
	}

	/**
	 * Mark the flag as required. If not resolved from any source the framework
	 * will emit a `ValidationError` before the action handler runs.
	 */
	required(): FlagBuilder<WithPresence<C, 'required'>> {
		return new FlagBuilder({
			...this.schema,
			presence: 'required',
		});
	}

	// -- Metadata modifiers --------------------------------------------------

	/**
	 * Add a short or long alias (e.g. `'f'` for `--force`, `'verbose'` as an
	 * alternative long name).
	 */
	alias(name: string): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			aliases: [...this.schema.aliases, name],
		});
	}

	/** Bind to an environment variable (resolved in v0.2+). */
	env(varName: string): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			envVar: varName,
		});
	}

	/** Bind to a dotted config path (resolved in v0.2+). */
	config(path: string): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			configPath: path,
		});
	}

	/** Human-readable description shown in help output. */
	describe(description: string): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			description,
		});
	}

	/**
	 * Attach interactive prompt configuration for v0.3+ resolution.
	 *
	 * When a flag value is not resolved from CLI, env, or config, the
	 * prompt engine uses this config to interactively ask the user.
	 * In non-interactive contexts (CI, piped stdin) prompts are skipped
	 * and resolution falls through to default or required validation.
	 */
	prompt(config: PromptConfig): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			prompt: config,
		});
	}

	/**
	 * Mark this flag as deprecated.
	 *
	 * When used, a warning is emitted to stderr. Help text shows
	 * `[deprecated]` or `[deprecated: <reason>]`.
	 *
	 * Does not change the flag's type-level config — it's metadata only.
	 *
	 * @param message - Optional migration reason/guidance.
	 */
	deprecated(message?: string): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			deprecated: message ?? true,
		});
	}

	/**
	 * Mark this flag as propagated to subcommands.
	 *
	 * Propagated flags are automatically available to all descendant
	 * commands in a nested command tree. A child command that defines
	 * a flag with the same name shadows the propagated parent flag.
	 *
	 * Does not change the flag's type-level config — it's metadata only.
	 */
	propagate(): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			propagate: true,
		});
	}
}

// ---------------------------------------------------------------------------
// Factory namespace
// ---------------------------------------------------------------------------

/**
 * Flag factory functions.
 *
 * Each function creates a `FlagBuilder` seeded with the correct `FlagKind`
 * and initial type-level config.
 */
interface FlagFactory {
	/** String-valued flag. */
	string(): FlagBuilder<{ readonly valueType: string; readonly presence: 'optional' }>;

	/** Number-valued flag. */
	number(): FlagBuilder<{ readonly valueType: number; readonly presence: 'optional' }>;

	/**
	 * Boolean flag. Implicitly defaults to `false` — the only flag kind where
	 * the absence of a value is still meaningful (not `undefined`).
	 */
	boolean(): FlagBuilder<{ readonly valueType: boolean; readonly presence: 'defaulted' }>;

	/**
	 * Enum flag with literal type inference.
	 *
	 * Requires a **non-empty** readonly tuple so that `T[number]` produces a
	 * union of string literals rather than just `string`.
	 *
	 * @example
	 * ```ts
	 * flag.enum(['us', 'eu', 'ap'])
	 * // inferred type: 'us' | 'eu' | 'ap'
	 * ```
	 */
	enum<const T extends readonly [string, ...string[]]>(
		values: T,
	): FlagBuilder<{ readonly valueType: T[number]; readonly presence: 'optional' }>;

	/**
	 * Array flag — collects multiple values of the same element type.
	 *
	 * @example
	 * ```ts
	 * flag.array(flag.string())
	 * // inferred type: string[]
	 * ```
	 */
	array<E extends FlagConfig>(
		element: FlagBuilder<E>,
	): FlagBuilder<{ readonly valueType: E['valueType'][]; readonly presence: 'optional' }>;

	/**
	 * Custom-parsed flag. The parse function receives the raw value and must
	 * return a value of type `T`. The return type is inferred from `parseFn`.
	 *
	 * The input is `string` from CLI argv and env vars, or any JSON value
	 * from config files. Narrow inside the function as needed:
	 *
	 * ```ts
	 * flag.custom((raw: unknown): string[] => {
	 *   if (Array.isArray(raw)) return raw.map(String);
	 *   if (typeof raw === 'string') return raw.split(',');
	 *   throw new Error(`Expected string or array, got ${typeof raw}`);
	 * })
	 * ```
	 *
	 * Throw an `Error` (or `ParseError`) to signal invalid input — it will
	 * be wrapped with context and re-thrown as a `ParseError`.
	 *
	 * @see `coerceConfigValue` `'custom'` case in `core/resolve/index.ts`
	 *
	 * @example
	 * ```ts
	 * flag.custom((raw) => new URL(String(raw)))
	 * // inferred type: URL | undefined
	 * ```
	 */
	custom<T>(parseFn: FlagParseFn<T>): FlagBuilder<{
		readonly valueType: T;
		readonly presence: 'optional';
	}>;
}

/** Flag schema factory. Use `flag.<kind>()` to create a builder. */
const flag: FlagFactory = {
	string(): FlagBuilder<{ readonly valueType: string; readonly presence: 'optional' }> {
		return new FlagBuilder(createSchema('string'));
	},

	number(): FlagBuilder<{ readonly valueType: number; readonly presence: 'optional' }> {
		return new FlagBuilder(createSchema('number'));
	},

	boolean(): FlagBuilder<{ readonly valueType: boolean; readonly presence: 'defaulted' }> {
		return new FlagBuilder(
			createSchema('boolean', {
				presence: 'defaulted',
				defaultValue: false,
			}),
		);
	},

	enum<const T extends readonly [string, ...string[]]>(
		values: T,
	): FlagBuilder<{ readonly valueType: T[number]; readonly presence: 'optional' }> {
		return new FlagBuilder(createSchema('enum', { enumValues: values }));
	},

	array<E extends FlagConfig>(
		element: FlagBuilder<E>,
	): FlagBuilder<{ readonly valueType: E['valueType'][]; readonly presence: 'optional' }> {
		return new FlagBuilder(createSchema('array', { elementSchema: element.schema }));
	},

	custom<T>(parseFn: FlagParseFn<T>): FlagBuilder<{
		readonly valueType: T;
		readonly presence: 'optional';
	}> {
		return new FlagBuilder(createSchema('custom', { parseFn: parseFn as FlagParseFn<unknown> }));
	},
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { flag, FlagBuilder, createSchema };
export type {
	FlagConfig,
	FlagFactory,
	FlagKind,
	FlagParseFn,
	FlagPresence,
	FlagSchema,
	InferFlag,
	InferFlags,
	ResolvedValue,
	WithPresence,
};
// Re-export prompt types for consumers
export type {
	ConfirmPromptConfig,
	InputPromptConfig,
	MultiselectPromptConfig,
	PromptConfig,
	PromptConfigBase,
	PromptKind,
	PromptResult,
	SelectChoice,
	SelectPromptConfig,
} from './prompt.ts';
