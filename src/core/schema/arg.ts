/**
 * Positional argument schema builder with full type inference.
 *
 * Each factory (`arg.string()`, `arg.number()`, `arg.custom()`) returns an
 * immutable `ArgBuilder` whose generic parameter tracks the value type,
 * presence state, and variadic flag through the fluent chain.
 *
 * @module dreamcli/core/schema/arg
 */

// ---------------------------------------------------------------------------
// Type-level configuration (phantom state tracked through the chain)
// ---------------------------------------------------------------------------

/**
 * Presence describes whether a positional arg is guaranteed to exist when the
 * action handler runs:
 *
 * - `'required'`  — must be supplied; error if missing (default)
 * - `'optional'`  — may be `undefined` if not supplied
 * - `'defaulted'` — always present (falls back to default value)
 */
type ArgPresence = 'required' | 'optional' | 'defaulted';

/**
 * Compile-time state carried through the builder chain.
 */
interface ArgConfig {
	/** The resolved value type (e.g. `string`, `number`, custom). */
	readonly valueType: unknown;
	/** Whether the arg is required, optional, or has a default. */
	readonly presence: ArgPresence;
	/** Whether this arg consumes remaining positionals. */
	readonly variadic: boolean;
}

// ---------------------------------------------------------------------------
// Type-level helpers
// ---------------------------------------------------------------------------

/** Replace the presence in a config. */
type WithArgPresence<C extends ArgConfig, P extends ArgPresence> = {
	readonly valueType: C['valueType'];
	readonly presence: P;
	readonly variadic: C['variadic'];
};

/** Replace the variadic flag in a config. */
type WithVariadic<C extends ArgConfig> = {
	readonly valueType: C['valueType'];
	readonly presence: C['presence'];
	readonly variadic: true;
};

/**
 * Compute the final value type from config — this is what handlers receive.
 *
 * Variadic args always produce an array. Non-variadic:
 * - `'optional'`  → `T | undefined`
 * - `'required'`  → `T`
 * - `'defaulted'` → `T`
 */
type ResolvedArgValue<C extends ArgConfig> = C['variadic'] extends true
	? C['valueType'][]
	: C['presence'] extends 'optional'
		? C['valueType'] | undefined
		: C['valueType'];

/** Extract the resolved value type from an `ArgBuilder`. */
type InferArg<B> = B extends ArgBuilder<infer C extends ArgConfig> ? ResolvedArgValue<C> : never;

/** Extract resolved value types from a record of builders. */
type InferArgs<T extends Record<string, ArgBuilder<ArgConfig>>> = {
	[K in keyof T]: InferArg<T[K]>;
};

// ---------------------------------------------------------------------------
// Runtime schema data
// ---------------------------------------------------------------------------

/** Discriminator for the kind of value an arg accepts. */
type ArgKind = 'string' | 'number' | 'custom';

/** Custom parse function for `arg.custom()`. */
type ArgParseFn<T> = (raw: string) => T;

/**
 * The runtime descriptor stored inside every `ArgBuilder`. Consumers (parser,
 * help generator) read this to understand the arg's shape without touching
 * generics.
 */
interface ArgSchema {
	/** What kind of value this arg accepts. */
	readonly kind: ArgKind;
	/** Current presence state. */
	readonly presence: ArgPresence;
	/** Whether this arg consumes all remaining positionals. */
	readonly variadic: boolean;
	/** Runtime default value (if any). */
	readonly defaultValue: unknown;
	/** Human-readable description for help text. */
	readonly description: string | undefined;
	/** Custom parse function (only when `kind === 'custom'`). */
	readonly parseFn: ArgParseFn<unknown> | undefined;
	/**
	 * Deprecation marker.
	 *
	 * - `undefined` — not deprecated (default)
	 * - `true` — deprecated with no migration message
	 * - `string` — deprecated with a reason/migration message
	 *
	 * When a deprecated arg is used, a warning is emitted to stderr.
	 * Help text shows `[deprecated]` or `[deprecated: <reason>]`.
	 */
	readonly deprecated: string | true | undefined;
}

/** Create base arg schema data with sensible defaults. */
function createArgSchema(kind: ArgKind, overrides?: Partial<ArgSchema>): ArgSchema {
	return {
		kind,
		presence: 'required',
		variadic: false,
		defaultValue: undefined,
		description: undefined,
		parseFn: undefined,
		deprecated: undefined,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// ArgBuilder — immutable builder with type-level tracking
// ---------------------------------------------------------------------------

/**
 * Immutable positional argument schema builder.
 *
 * The type parameter `C` is a phantom that tracks the value type, presence,
 * and variadic state through the fluent chain. Each modifier returns a **new**
 * builder — the original is never mutated.
 *
 * @example
 * ```ts
 * const target = arg.string().describe('Deploy target');
 * type Target = InferArg<typeof target>; // string
 *
 * const files = arg.string().variadic().describe('Input files');
 * type Files = InferArg<typeof files>; // string[]
 * ```
 */
class ArgBuilder<C extends ArgConfig> {
	/** @internal Runtime schema descriptor. */
	readonly schema: ArgSchema;

	/**
	 * @internal Type brand — exists only in the type system (`declare`
	 * produces no runtime property). Used by `InferArg` / `InferArgs`.
	 */
	declare readonly _config: C;

	constructor(schema: ArgSchema) {
		this.schema = schema;
	}

	// -- Presence modifiers --------------------------------------------------

	/**
	 * Mark the arg as required (this is the default for positional args).
	 * Produces an error if not supplied.
	 */
	required(): ArgBuilder<WithArgPresence<C, 'required'>> {
		return new ArgBuilder({
			...this.schema,
			presence: 'required',
		});
	}

	/**
	 * Mark the arg as optional. Handlers may see `undefined`.
	 */
	optional(): ArgBuilder<WithArgPresence<C, 'optional'>> {
		return new ArgBuilder({
			...this.schema,
			presence: 'optional',
		});
	}

	/**
	 * Provide a default value. The arg becomes "always present" — handlers
	 * will never see `undefined`.
	 *
	 * The generic constraint `V extends C['valueType']` ensures the default
	 * matches the arg's declared type.
	 */
	default<V extends C['valueType']>(value: V): ArgBuilder<WithArgPresence<C, 'defaulted'>> {
		return new ArgBuilder({
			...this.schema,
			presence: 'defaulted',
			defaultValue: value,
		});
	}

	// -- Variadic modifier ---------------------------------------------------

	/**
	 * Mark this arg as variadic — it consumes all remaining positional
	 * arguments. The inferred type becomes `T[]`.
	 *
	 * A variadic arg must be the last positional in a command.
	 */
	variadic(): ArgBuilder<WithVariadic<C>> {
		return new ArgBuilder({
			...this.schema,
			variadic: true,
		});
	}

	// -- Metadata modifiers --------------------------------------------------

	/** Human-readable description shown in help output. */
	describe(description: string): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			description,
		});
	}

	/**
	 * Mark this arg as deprecated.
	 *
	 * When used, a warning is emitted to stderr. Help text shows
	 * `[deprecated]` or `[deprecated: <reason>]`.
	 *
	 * Does not change the arg's type-level config — it's metadata only.
	 *
	 * @param message - Optional migration reason/guidance.
	 */
	deprecated(message?: string): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			deprecated: message ?? true,
		});
	}
}

// ---------------------------------------------------------------------------
// Factory namespace
// ---------------------------------------------------------------------------

/**
 * Arg factory functions.
 *
 * Each function creates an `ArgBuilder` seeded with the correct `ArgKind`
 * and initial type-level config.
 */
interface ArgFactory {
	/**
	 * String-valued positional argument. Required by default.
	 */
	string(): ArgBuilder<{
		readonly valueType: string;
		readonly presence: 'required';
		readonly variadic: false;
	}>;

	/**
	 * Number-valued positional argument. Required by default.
	 * The parser will coerce the raw string to a number and emit a
	 * `ParseError` if conversion fails.
	 */
	number(): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
	}>;

	/**
	 * Custom-parsed positional argument. Required by default.
	 *
	 * The parse function receives the raw string and must return a value of
	 * type `T`. Throw a `ParseError` to signal invalid input.
	 *
	 * @example
	 * ```ts
	 * arg.custom((raw) => Number.parseInt(raw, 16))
	 * // inferred type: number
	 * ```
	 */
	custom<T>(parseFn: ArgParseFn<T>): ArgBuilder<{
		readonly valueType: T;
		readonly presence: 'required';
		readonly variadic: false;
	}>;
}

/** Arg schema factory. Use `arg.<kind>()` to create a builder. */
const arg: ArgFactory = {
	string(): ArgBuilder<{
		readonly valueType: string;
		readonly presence: 'required';
		readonly variadic: false;
	}> {
		return new ArgBuilder(createArgSchema('string'));
	},

	number(): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
	}> {
		return new ArgBuilder(createArgSchema('number'));
	},

	custom<T>(parseFn: ArgParseFn<T>): ArgBuilder<{
		readonly valueType: T;
		readonly presence: 'required';
		readonly variadic: false;
	}> {
		return new ArgBuilder(createArgSchema('custom', { parseFn: parseFn as ArgParseFn<unknown> }));
	},
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { arg, ArgBuilder, createArgSchema };
export type {
	ArgConfig,
	ArgFactory,
	ArgKind,
	ArgParseFn,
	ArgPresence,
	ArgSchema,
	InferArg,
	InferArgs,
	ResolvedArgValue,
	WithArgPresence,
	WithVariadic,
};
