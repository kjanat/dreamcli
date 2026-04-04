/**
 * Flag schema builder with full type inference.
 *
 * Each factory (`flag.string()`, `flag.boolean()`, etc.) returns an immutable
 * {@linkcode FlagBuilder} whose generic parameter tracks the value type and presence
 * state. Chained modifiers (`.default()`, `.required()`, `.alias()`, …) return
 * new builders with updated type-level and runtime state.
 *
 * @module dreamcli/core/schema/flag
 */

import type { PromptConfig } from './prompt.ts';

// --- Type-level configuration (phantom state tracked through the chain)

/** All flag presence states as a runtime array. */
const FLAG_PRESENCES = ['optional', 'required', 'defaulted'] as const;

/**
 * Presence describes whether a flag value is guaranteed to exist when the
 * action handler runs:
 *
 * - `'optional'`  — not required; unresolved value follows the kind-specific
 *   optional fallback (`undefined` for most flags, `[]` for arrays)
 * - `'required'`  — must be supplied; error if missing
 * - `'defaulted'` — always present (falls back to default value)
 */
type FlagPresence = (typeof FLAG_PRESENCES)[number];

/**
 * Fallback behavior when an optional flag resolves no value from any source.
 *
 * Most optional flags resolve to `undefined`; array flags instead resolve to
 * an empty array `[]`.
 */
type OptionalFallback = 'undefined' | 'empty-array';

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
	/** What an unresolved optional flag becomes at the action boundary. */
	readonly optionalFallback: OptionalFallback;
}

// --- Type-level helpers

/**
 * Advanced type helper used by {@linkcode FlagBuilder} modifiers to replace presence.
 * Most consumers rely on inference and never reference this directly.
 */
type WithPresence<C extends FlagConfig, P extends FlagPresence> = {
	readonly valueType: C['valueType'];
	readonly presence: P;
	readonly optionalFallback: C['optionalFallback'];
};

/**
 * Compute the final value type from config — this is what handlers receive.
 *
 * Advanced type helper: this powers {@link InferFlag} and action-handler
 * inference. Most apps do not need to mention it explicitly.
 *
 * - `'optional'` + `'undefined'` fallback  → `T | undefined`
 * - `'optional'` + `'empty-array'` fallback → `T`
 * - `'required'`   → `T`
 * - `'defaulted'`  → `T`
 */
type ResolvedValue<C extends FlagConfig> = C['presence'] extends 'optional'
	? C['optionalFallback'] extends 'empty-array'
		? C['valueType']
		: C['valueType'] | undefined
	: C['valueType'];

/** Extract the resolved value type from a {@linkcode FlagBuilder}. */
type InferFlag<B> = B extends FlagBuilder<infer C extends FlagConfig> ? ResolvedValue<C> : never;

/** Extract resolved value types from a record of builders. */
type InferFlags<T extends Record<string, FlagBuilder<FlagConfig>>> = {
	[K in keyof T]: InferFlag<T[K]>;
};

// --- Runtime schema data

/** All flag kind discriminators as a runtime array. */
const FLAG_KINDS = ['string', 'number', 'boolean', 'enum', 'array', 'custom'] as const;

/** Discriminator for the kind of value a flag accepts. */
type FlagKind = (typeof FLAG_KINDS)[number];

/**
 * Custom parse function for `flag.custom()`.
 *
 * Receives `string` from CLI argv and env vars, or any JSON-representable
 * value from config files. Narrow inside the function as needed.
 */
type FlagParseFn<T> = (raw: unknown) => T;

/** Runtime descriptor for a flag alias. */
interface FlagAlias {
	/** Alias name without `-` / `--` prefix. */
	readonly name: string;
	/** Whether the alias is parser-only and hidden from user-facing surfaces. */
	readonly hidden: boolean;
}

/**
 * The runtime descriptor stored inside every {@linkcode FlagBuilder}. Consumers (parser,
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
	/** Short/long aliases (e.g. `[{ name: 'f', hidden: false }]` for `--force`). */
	readonly aliases: readonly FlagAlias[];
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
	 * @defaultValue `false`
	 */
	readonly propagate: boolean;
}

/**
 * Low-level overrides accepted by {@link createSchema}.
 *
 * `aliases` accepts both legacy string input and structured {@link FlagAlias}
 * objects so tests and internal fixtures can be migrated incrementally.
 */
type FlagSchemaOverrides = Omit<Partial<FlagSchema>, 'aliases'> & {
	readonly aliases?: readonly (string | FlagAlias)[];
};

/**
 * Normalise an alias input into a full {@link FlagAlias} object.
 *
 * @param alias - Raw alias name or structured alias object.
 * @returns Normalised alias record.
 */
function normalizeFlagAlias(alias: string | FlagAlias): FlagAlias {
	if (typeof alias === 'string') {
		return { name: alias, hidden: false };
	}

	return {
		name: alias.name,
		hidden: alias.hidden,
	};
}

/**
 * Normalise alias input into immutable alias records.
 *
 * @param aliases - Alias input values.
 * @returns Normalised alias objects.
 */
function normalizeFlagAliases(aliases: readonly (string | FlagAlias)[]): readonly FlagAlias[] {
	return aliases.map(normalizeFlagAlias);
}

/**
 * List alias names for a flag schema.
 *
 * @param schema - Flag schema whose aliases should be listed.
 * @param options - Visibility and length filtering.
 * @returns Alias names in registration order.
 */
function getFlagAliasNames(
	schema: FlagSchema,
	options?: {
		readonly includeHidden?: boolean;
		readonly kind?: 'all' | 'short' | 'long';
	},
): readonly string[] {
	const includeHidden = options?.includeHidden ?? false;
	const kind = options?.kind ?? 'all';

	return schema.aliases
		.filter((alias) => includeHidden || !alias.hidden)
		.filter((alias) => {
			if (kind === 'short') return alias.name.length === 1;
			if (kind === 'long') return alias.name.length > 1;
			return true;
		})
		.map((alias) => alias.name);
}

/**
 * Create a raw {@link FlagSchema} object with sensible defaults.
 *
 * Most consumers should prefer the higher-level {@link flag} factory,
 * which returns an immutable {@link FlagBuilder} with type inference and
 * safe modifier chaining. `createSchema()` is the low-level escape hatch
 * for advanced schema composition, tests, or custom factories that need to
 * work directly with the runtime descriptor.
 *
 * `overrides` are shallow-merged on top of the default shape, so callers are
 * responsible for keeping the resulting schema internally consistent.
 *
 * @param kind - Discriminator for the value type this flag accepts.
 * @param overrides - Partial {@link FlagSchema} fields merged onto defaults.
 * @returns A fully populated {@link FlagSchema}.
 *
 * @example
 * ```ts
 * const schema = createSchema('enum', {
 *   enumValues: ['us', 'eu', 'ap'],
 *   description: 'Deployment region',
 * });
 * ```
 */
function createSchema(kind: FlagKind, overrides?: FlagSchemaOverrides): FlagSchema {
	const aliases =
		overrides?.aliases !== undefined ? normalizeFlagAliases(overrides.aliases) : ([] as const);
	const { aliases: _ignoredAliases, ...rest } = overrides ?? {};

	return {
		kind,
		presence: 'optional',
		defaultValue: undefined,
		envVar: undefined,
		configPath: undefined,
		description: undefined,
		enumValues: undefined,
		elementSchema: undefined,
		prompt: undefined,
		parseFn: undefined,
		deprecated: undefined,
		propagate: false,
		...rest,
		aliases,
	};
}

// --- FlagBuilder — immutable builder with type-level tracking

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
	 * produces no runtime property). Used by {@linkcode InferFlag} / {@linkcode InferFlags}.
	 */
	declare readonly _config: C;

	/**
	 * Create a flag builder from a pre-built schema descriptor.
	 *
	 * @param schema - Runtime descriptor seeding this builder's state.
	 */
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
	 *
	 * @param value - Fallback value used when no source provides one.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.number().default(8080).describe('Port to listen on')
	 *
	 * // $ mycli serve            → port = 8080
	 * // $ mycli serve --port 443 → port = 443
	 * ```
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
	 *
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.string().required().describe('Deploy target')
	 *
	 * // $ mycli deploy
	 * // #   → Error: Missing required flag --target
	 * // $ mycli deploy --target staging
	 * // #   → target = 'staging'
	 * ```
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
	 *
	 * @param name - Single-char short alias or alternative long name.
	 * @param options - Optional alias metadata. Hidden aliases remain parseable
	 *   but are omitted from help, completions, and suggestions.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.boolean().alias('v').describe('Enable verbose output')
	 *
	 * // $ mycli build -v         → verbose = true
	 * // $ mycli build --verbose  → verbose = true
	 * ```
	 */
	alias(name: string, options?: { hidden?: boolean }): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			aliases: [
				...this.schema.aliases,
				{
					name,
					hidden: options?.hidden ?? false,
				},
			],
		});
	}

	/**
	 * Bind to an environment variable (resolved in v0.2+).
	 *
	 * @param varName - Environment variable name (e.g. `'PORT'`).
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.string().env('API_KEY').describe('Service API key')
	 *
	 * // $ API_KEY=sk-123 mycli request   → apiKey = 'sk-123'
	 * // $ mycli request --api-key sk-456 → apiKey = 'sk-456' (CLI wins)
	 * ```
	 */
	env(varName: string): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			envVar: varName,
		});
	}

	/**
	 * Bind to a dotted config path (resolved in v0.2+).
	 *
	 * @param path - Dotted config key (e.g. `'deploy.region'`).
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.string().config('deploy.region').default('us-east-1')
	 * // Config file: { "deploy": { "region": "eu-west-1" } }
	 * // $ mycli deploy
	 * // #   → region = 'eu-west-1' (from config)
	 * // $ mycli deploy --region ap-south-1
	 * // #   → CLI flag wins
	 * ```
	 */
	config(path: string): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			configPath: path,
		});
	}

	/**
	 * Human-readable description shown in help output.
	 *
	 * @param description - Text displayed next to the flag in `--help`.
	 * @returns The builder (for chaining).
	 */
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
	 *
	 * @param config - {@link PromptConfig} describing the interactive prompt.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.string().prompt({ kind: 'input', message: 'Enter value:' })
	 *
	 * // $ mycli init              → prompts "Enter value:" interactively
	 * // $ mycli init --name foo   → skips prompt, uses CLI value
	 * ```
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
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.string().deprecated('Use --target instead')
	 *
	 * // $ mycli deploy --dest staging
	 * // ⚠ --dest is deprecated: Use --target instead
	 * ```
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
	 *
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.boolean().alias('v').propagate().describe('Enable verbose output')
	 *
	 * // $ mycli --verbose deploy staging
	 * // #   → verbose = true in deploy handler
	 * // $ mycli deploy --verbose staging
	 * // #   → same, inherited from parent
	 * ```
	 */
	propagate(): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			propagate: true,
		});
	}
}

// --- Factory namespace

/**
 * Factory that creates {@link FlagBuilder} instances seeded with the correct
 * {@link FlagKind} and initial type-level config.
 */
interface FlagFactory {
	/**
	 * String-valued flag.
	 *
	 * @returns A {@link FlagBuilder} for `string` values.
	 */
	string(): FlagBuilder<{
		readonly valueType: string;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}>;

	/**
	 * Number-valued flag.
	 *
	 * @returns A {@link FlagBuilder} for `number` values.
	 */
	number(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}>;

	/**
	 * Boolean flag. Implicitly defaults to `false` — the only flag kind where
	 * the absence of a value is still meaningful (not `undefined`).
	 *
	 * @returns A {@link FlagBuilder} for `boolean` values (defaulted to `false`).
	 */
	boolean(): FlagBuilder<{
		readonly valueType: boolean;
		readonly presence: 'defaulted';
		readonly optionalFallback: 'undefined';
	}>;

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
	 *
	 * @param values - Non-empty tuple of allowed string literals.
	 * @returns A {@link FlagBuilder} whose value type is the union of `values`.
	 */
	enum<const T extends readonly [string, ...string[]]>(
		values: T,
	): FlagBuilder<{
		readonly valueType: T[number];
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}>;

	/**
	 * Array flag — collects multiple values of the same element type.
	 *
	 * @example
	 * ```ts
	 * flag.array(flag.string())
	 * // inferred type: string[]
	 * ```
	 *
	 * @param element - {@link FlagBuilder} describing the element type.
	 * @returns A {@link FlagBuilder} for arrays of the element type.
	 */
	array<E extends FlagConfig>(
		element: FlagBuilder<E>,
	): FlagBuilder<{
		readonly valueType: E['valueType'][];
		readonly presence: 'optional';
		readonly optionalFallback: 'empty-array';
	}>;

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
	 *
	 * @param parseFn - Converts the raw input into a value of type `T`.
	 * @returns A {@link FlagBuilder} whose value type is inferred from `parseFn`.
	 */
	custom<T>(parseFn: FlagParseFn<T>): FlagBuilder<{
		readonly valueType: T;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}>;
}

/**
 * Flag schema factory. Call `flag.<kind>()` to create an immutable
 * {@link FlagBuilder} with full type inference and safe modifier chaining.
 */
const flag: FlagFactory = {
	string(): FlagBuilder<{
		readonly valueType: string;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}> {
		return new FlagBuilder(createSchema('string'));
	},

	number(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}> {
		return new FlagBuilder(createSchema('number'));
	},

	boolean(): FlagBuilder<{
		readonly valueType: boolean;
		readonly presence: 'defaulted';
		readonly optionalFallback: 'undefined';
	}> {
		return new FlagBuilder(
			createSchema('boolean', {
				presence: 'defaulted',
				defaultValue: false,
			}),
		);
	},

	enum<const T extends readonly [string, ...string[]]>(
		values: T,
	): FlagBuilder<{
		readonly valueType: T[number];
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}> {
		return new FlagBuilder(createSchema('enum', { enumValues: values }));
	},

	array<E extends FlagConfig>(
		element: FlagBuilder<E>,
	): FlagBuilder<{
		readonly valueType: E['valueType'][];
		readonly presence: 'optional';
		readonly optionalFallback: 'empty-array';
	}> {
		return new FlagBuilder(createSchema('array', { elementSchema: element.schema }));
	},

	custom<T>(parseFn: FlagParseFn<T>): FlagBuilder<{
		readonly valueType: T;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
	}> {
		return new FlagBuilder(createSchema('custom', { parseFn: parseFn as FlagParseFn<unknown> }));
	},
};

// --- Exports

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
export { PROMPT_KINDS } from './prompt.ts';
export type {
	FlagAlias,
	FlagConfig,
	FlagFactory,
	FlagKind,
	OptionalFallback,
	FlagParseFn,
	FlagPresence,
	FlagSchema,
	FlagSchemaOverrides,
	InferFlag,
	InferFlags,
	ResolvedValue,
	WithPresence,
};
export {
	createSchema,
	FLAG_KINDS,
	FLAG_PRESENCES,
	FlagBuilder,
	flag,
	getFlagAliasNames,
	normalizeFlagAlias,
	normalizeFlagAliases,
};
