/**
 * Positional argument schema builder with full type inference.
 *
 * Each factory (`arg.string()`, `arg.number()`, `arg.enum()`, `arg.custom()`) returns an
 * immutable {@linkcode ArgBuilder} whose generic parameter tracks the value type,
 * presence state, and variadic flag through the fluent chain.
 *
 * @module dreamcli/core/schema/arg
 */

// --- Type-level configuration (phantom state tracked through the chain)

/** All arg presence states as a runtime array. */
const ARG_PRESENCES = ['required', 'optional', 'defaulted'] as const;

/**
 * Presence describes whether a positional arg is guaranteed to exist when the
 * action handler runs:
 *
 * - `'required'`  — must be supplied; error if missing (default)
 * - `'optional'`  — may be `undefined` if not supplied
 * - `'defaulted'` — always present (falls back to default value)
 */
type ArgPresence = (typeof ARG_PRESENCES)[number];

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

// --- Type-level helpers

/**
 * Advanced type helper used by {@linkcode ArgBuilder} modifiers to replace presence.
 * Most consumers rely on inference and never reference this directly.
 */
type WithArgPresence<C extends ArgConfig, P extends ArgPresence> = {
	readonly valueType: C['valueType'];
	readonly presence: P;
	readonly variadic: C['variadic'];
};

/**
 * Advanced type helper used by {@linkcode ArgBuilder.variadic | ArgBuilder.variadic()}.
 * Most consumers rely on inference and never reference this directly.
 */
type WithVariadic<C extends ArgConfig> = {
	readonly valueType: C['valueType'];
	readonly presence: C['presence'];
	readonly variadic: true;
};

/**
 * Compute the final value type from config — this is what handlers receive.
 *
 * Advanced type helper: this powers {@link InferArg} and action-handler
 * inference. Most apps do not need to mention it explicitly.
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

/** Extract the resolved value type from an {@linkcode ArgBuilder}. */
type InferArg<B> = B extends ArgBuilder<infer C extends ArgConfig> ? ResolvedArgValue<C> : never;

/** Extract resolved value types from a record of builders. */
type InferArgs<T extends Record<string, ArgBuilder<ArgConfig>>> = {
	[K in keyof T]: InferArg<T[K]>;
};

// --- Runtime schema data

/** All arg kind discriminators as a runtime array. */
const ARG_KINDS = ['string', 'number', 'enum', 'custom'] as const;

/** Discriminator for the kind of value an arg accepts. */
type ArgKind = (typeof ARG_KINDS)[number];

/** Custom parse function for `arg.custom()`. */
type ArgParseFn<T> = (raw: string) => T;

/**
 * The runtime descriptor stored inside every {@linkcode ArgBuilder}. Consumers (parser,
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
	/**
	 * Whether this arg may read from stdin during resolution.
	 * @defaultValue `false`
	 */
	readonly stdinMode: boolean;
	/** Runtime default value (if any). */
	readonly defaultValue: unknown;
	/** Human-readable description for help text. */
	readonly description: string | undefined;
	/**
	 * Environment variable name for env resolution.
	 *
	 * When set and the CLI value is absent, the resolver reads this env var
	 * and coerces the string to the arg's declared kind.
	 *
	 * @see {@link ArgBuilder.env} for the builder method.
	 */
	readonly envVar: string | undefined;
	/** Allowed literal values when `kind === 'enum'`. */
	readonly enumValues: readonly string[] | undefined;
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

/**
 * Create a raw {@link ArgSchema} object with sensible defaults.
 *
 * Most consumers should prefer the higher-level {@link arg} factory, which
 * returns an immutable {@link ArgBuilder} with type inference and fluent
 * modifiers. `createArgSchema()` exists for advanced schema composition,
 * targeted tests, or custom builders that need the plain runtime descriptor.
 *
 * `overrides` are shallow-merged on top of the default shape, so callers are
 * responsible for preserving invariants such as variadic ordering and
 * compatible `parseFn` / `kind` combinations.
 *
 * @param kind - Discriminator for the value type this arg accepts.
 * @param overrides - Partial schema fields shallow-merged onto defaults.
 * @returns A fully populated {@link ArgSchema}.
 *
 * @example
 * ```ts
 * const schema = createArgSchema('custom', {
 *   description: 'Hex color',
 *   parseFn: (raw) => `#${raw}`,
 * });
 * ```
 */
function createArgSchema(kind: ArgKind, overrides?: Partial<ArgSchema>): ArgSchema {
	return {
		kind,
		presence: 'required',
		variadic: false,
		stdinMode: false,
		defaultValue: undefined,
		description: undefined,
		envVar: undefined,
		enumValues: undefined,
		parseFn: undefined,
		deprecated: undefined,
		...overrides,
	};
}

// --- ArgBuilder — immutable builder with type-level tracking

/**
 * Immutable positional argument schema builder.
 *
 * The type parameter `C` is a phantom that tracks the value type, presence,
 * and variadic state through the fluent chain. Each modifier returns a **new**
 * builder — the original is never mutated.
 *
 * @example
 * ```ts
 * // Full command with multiple args and modifiers
 * import { command, arg } from '@kjanat/dreamcli';
 *
 * command('deploy')
 *   .arg('target', arg.string()
 *     .env('DEPLOY_TARGET')
 *     .describe('Deploy target'))
 *   .arg('port', arg.number()
 *     .env('PORT')
 *     .default(3000)
 *     .describe('Port number'))
 *   .arg('files', arg.string()
 *     .variadic()
 *     .optional()
 *     .describe('Extra config files'))
 *   .action(({ args }) => {
 *     args.target; // string  (required, from CLI or $DEPLOY_TARGET)
 *     args.port;   // number  (defaulted, from CLI, $PORT, or 3000)
 *     args.files;  // string[] (optional variadic)
 *   });
 * ```
 *
 * @example
 * ```ts
 * // Type inference
 * const target = arg.string();
 * type T = InferArg<typeof target>; // string
 *
 * const opt = arg.string().optional();
 * type O = InferArg<typeof opt>; // string | undefined
 *
 * const files = arg.string().variadic();
 * type F = InferArg<typeof files>; // string[]
 * ```
 */
class ArgBuilder<C extends ArgConfig> {
	/** @internal Runtime schema descriptor. */
	readonly schema: ArgSchema;

	/**
	 * @internal Type brand — exists only in the type system (`declare`
	 * produces no runtime property). Used by {@linkcode InferArg} / {@linkcode InferArgs}.
	 */
	declare readonly _config: C;

	/**
	 * Create an arg builder from a pre-built schema descriptor.
	 *
	 * @param schema - Runtime descriptor for this positional argument.
	 */
	constructor(schema: ArgSchema) {
		this.schema = schema;
	}

	// -- Presence modifiers --------------------------------------------------

	/**
	 * Mark the arg as required (this is the default for positional args).
	 * Produces an error if no value resolves from any configured source
	 * (CLI → stdin → env → default).
	 *
	 * @example
	 * ```ts
	 * arg.string().required() // explicit, same as default
	 *
	 * // In a command — omitting <target> causes a ValidationError:
	 * command('deploy')
	 *   .arg('target', arg.string().required().describe('Deploy target'))
	 * // $ mycli deploy
	 * // Error: Missing required argument <target>
	 * ```
	 *
	 * @returns The builder (for chaining).
	 */
	required(): ArgBuilder<WithArgPresence<C, 'required'>> {
		return new ArgBuilder({
			...this.schema,
			presence: 'required',
		});
	}

	/**
	 * Mark the arg as optional. Handlers receive `undefined` when absent.
	 *
	 * @example
	 * ```ts
	 * arg.string().optional()
	 *
	 * // In a command — handler receives `undefined` when omitted:
	 * command('greet')
	 *   .arg('name', arg.string().optional().describe('Who to greet'))
	 *   .action(({ args }) => {
	 *     args.name; // string | undefined
	 *   });
	 * // $ mycli greet        → args.name is undefined
	 * // $ mycli greet Alice  → args.name is 'Alice'
	 * ```
	 *
	 * @returns The builder (for chaining).
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
	 *
	 * Resolution order when extra sources are configured: CLI → stdin → env → **default**.
	 *
	 * @param value - Fallback used when no CLI value or env var resolves.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().default('production')
	 * arg.number().default(3000)
	 *
	 * // In a command — default kicks in when CLI and env are both absent:
	 * command('deploy')
	 *   .arg('env', arg.string()
	 *     .env('DEPLOY_ENV')
	 *     .default('staging')
	 *     .describe('Target environment'))
	 *   .action(({ args }) => {
	 *     args.env; // string (never undefined)
	 *   });
	 * // $ mycli deploy            → 'staging'  (default)
	 * // $ DEPLOY_ENV=prod mycli deploy → 'prod' (env)
	 * // $ mycli deploy production → 'production' (CLI)
	 * ```
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
	 *
	 * @example
	 * ```ts
	 * arg.string().variadic()
	 *
	 * // In a command — collects all remaining positionals:
	 * command('build')
	 *   .arg('entry', arg.string().describe('Main entry'))
	 *   .arg('extras', arg.string().variadic().optional().describe('Extra files'))
	 *   .action(({ args }) => {
	 *     args.entry;  // string
	 *     args.extras; // string[]
	 *   });
	 * // $ mycli build main.ts a.ts b.ts
	 * // → entry = 'main.ts', extras = ['a.ts', 'b.ts']
	 * ```
	 *
	 * @returns The builder (for chaining).
	 */
	variadic(): ArgBuilder<WithVariadic<C>> {
		return new ArgBuilder({
			...this.schema,
			variadic: true,
		});
	}

	/**
	 * Allow this arg to resolve from stdin when CLI input is missing.
	 *
	 * Resolution order becomes: CLI value -> stdin -> env -> default.
	 * Only one arg per command may enable stdin mode.
	 *
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().describe('Input text').stdin()
	 * // $ echo "hello" | mycli transform   → input = 'hello' (from stdin)
	 * // $ mycli transform "hello"          → input = 'hello' (from CLI)
	 * ```
	 */
	stdin(): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			stdinMode: true,
		});
	}

	// -- Resolution source modifiers ------------------------------------------

	/**
	 * Bind to an environment variable.
	 *
	 * When the arg is not provided on the CLI, the resolver checks this
	 * env var before falling back to the default value. The env string is
	 * coerced to the arg's declared kind (passthrough for strings, parsed
	 * for numbers, run through `parseFn` for custom args).
	 *
	 * Resolution order when extra sources are configured: **CLI → stdin → env → default**.
	 *
	 * Help output shows `[env: VAR]` next to the arg description.
	 *
	 * @param varName - Environment variable name (e.g. `'DEPLOY_TARGET'`).
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * command('deploy')
	 *   .arg('target', arg.string().env('DEPLOY_TARGET').describe('Deploy target'))
	 *   .arg('port', arg.number().env('PORT').default(3000))
	 *   .action(({ args }) => {
	 *     console.log(args.target); // from CLI, $DEPLOY_TARGET, or error
	 *     console.log(args.port);   // from CLI, $PORT, or 3000
	 *   });
	 * ```
	 */
	env(varName: string): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			envVar: varName,
		});
	}

	// -- Metadata modifiers --------------------------------------------------

	/**
	 * Human-readable description shown in help output.
	 *
	 * @param description - Text displayed next to the arg in `--help`.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().describe('Deploy target')
	 *
	 * // Help output:
	 * // Arguments:
	 * //   <target>  Deploy target
	 * ```
	 */
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
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().deprecated()                         // generic
	 * arg.string().deprecated('use --target flag instead') // with guidance
	 *
	 * // Help output:
	 * // Arguments:
	 * //   <target>  Deploy target [deprecated: use --target flag instead]
	 * ```
	 */
	deprecated(message?: string): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			deprecated: message ?? true,
		});
	}
}

// --- Factory namespace

/**
 * Arg factory functions — the public API for creating positional arguments.
 *
 * Each method returns an {@linkcode ArgBuilder} seeded with the correct {@linkcode ArgKind}
 * and initial type-level config. Chain modifiers (`.optional()`, `.env()`,
 * `.default()`, `.variadic()`, `.stdin()`, `.describe()`, `.deprecated()`) to refine.
 *
 * All args are **required** by default. Resolution order when extra
 * sources are configured: **CLI → stdin → env → default**.
 *
 * @example Overview — all three kinds with common modifier patterns
 * ```ts
 * command('process')
 *   // String arg with env fallback
 *   .arg('input', arg.string()
 *     .env('INPUT_FILE')
 *     .describe('Input file path'))
 *
 *   // Number arg with env + default
 *   .arg('concurrency', arg.number()
 *     .env('CONCURRENCY')
 *     .default(4)
 *     .describe('Worker threads'))
 *
 *   // Custom arg — hex color parser with env
 *   .arg('color', arg.custom((raw) => {
 *       if (!/^#?[0-9a-f]{6}$/i.test(raw)) throw new Error('bad hex');
 *       return raw.startsWith('#') ? raw : `#${raw}`;
 *     })
 *     .env('THEME_COLOR')
 *     .optional()
 *     .describe('Theme color (hex)'))
 *
 *   .action(({ args }) => {
 *     args.input;       // string       (required)
 *     args.concurrency; // number       (defaulted)
 *     args.color;       // string | undefined (optional custom)
 *   });
 * ```
 */
interface ArgFactory {
	/**
	 * String-valued positional argument. Required by default.
	 *
	 * @example
	 * ```ts
	 * arg.string()                        // required string
	 * arg.string().optional()             // string | undefined
	 * arg.string().env('TARGET')          // falls back to $TARGET
	 * arg.string().default('production')  // always present
	 *
	 * // In a command:
	 * command('deploy')
	 *   .arg('target', arg.string().env('DEPLOY_TARGET').describe('Deploy target'))
	 * ```
	 *
	 * @returns A required string {@link ArgBuilder}.
	 */
	string(): ArgBuilder<{
		readonly valueType: string;
		readonly presence: 'required';
		readonly variadic: false;
	}>;

	/**
	 * Number-valued positional argument. Required by default.
	 *
	 * The parser coerces the raw CLI string to a number and emits a
	 * `ParseError` if conversion fails. Env values are coerced the same way.
	 *
	 * @example
	 * ```ts
	 * arg.number()                  // required number
	 * arg.number().default(8080)    // defaults to 8080
	 * arg.number().env('PORT')      // falls back to $PORT (coerced)
	 *
	 * // In a command:
	 * command('serve')
	 *   .arg('port', arg.number().env('PORT').default(3000).describe('Port'))
	 * // $ mycli serve 8080    → 8080
	 * // $ PORT=9090 mycli serve → 9090
	 * // $ mycli serve          → 3000
	 * ```
	 *
	 * @returns A required number {@link ArgBuilder}.
	 */
	number(): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
	}>;

	/**
	 * Enum-valued positional argument. Required by default.
	 *
	 * Accepts only the listed string literals. The inferred type is the
	 * union of those literals (e.g. `'us' | 'eu' | 'ap'`), not `string`.
	 * Invalid values produce a `ParseError` listing allowed options.
	 *
	 * @param values - Non-empty tuple of allowed string values.
	 * @returns A required enum {@link ArgBuilder} typed to the union of `values`.
	 *
	 * @example
	 * ```ts
	 * arg.enum(['us', 'eu', 'ap'])              // required, 'us' | 'eu' | 'ap'
	 * arg.enum(['dev', 'prod']).default('dev')   // defaulted
	 * arg.enum(['json', 'csv']).optional()       // 'json' | 'csv' | undefined
	 *
	 * // In a command:
	 * command('deploy')
	 *   .arg('region', arg.enum(['us', 'eu', 'ap']).env('REGION').describe('Target region'))
	 * // $ mycli deploy us       → 'us'
	 * // $ mycli deploy invalid  → ParseError: Allowed: us, eu, ap
	 * ```
	 */
	enum<const T extends readonly [string, ...string[]]>(
		values: T,
	): ArgBuilder<{
		readonly valueType: T[number];
		readonly presence: 'required';
		readonly variadic: false;
	}>;

	/**
	 * Custom-parsed positional argument. Required by default.
	 *
	 * The parse function receives the raw string and must return a value of
	 * type `T`. Throw an `Error` (or `ParseError`) to signal invalid input.
	 * The same parse function is used for both CLI and env values.
	 *
	 * @param parseFn - Converts the raw CLI string to `T`.
	 * @returns A required custom {@link ArgBuilder} typed to the return of `parseFn`.
	 *
	 * @example
	 * ```ts
	 * arg.custom((raw) => Number.parseInt(raw, 16))
	 * // inferred type: number
	 *
	 * // In a command — parse hex color from CLI or $COLOR:
	 * command('theme')
	 *   .arg('color', arg.custom((raw) => {
	 *     if (!/^[0-9a-f]{6}$/i.test(raw)) throw new Error('Expected 6-digit hex');
	 *     return `#${raw}`;
	 *   }).env('COLOR').describe('Hex color code'))
	 * // $ mycli theme ff6600        → '#ff6600'
	 * // $ COLOR=aabbcc mycli theme  → '#aabbcc'
	 * ```
	 */
	custom<T>(parseFn: ArgParseFn<T>): ArgBuilder<{
		readonly valueType: T;
		readonly presence: 'required';
		readonly variadic: false;
	}>;
}

/**
 * Positional argument schema factory.
 *
 * Entry point for defining args on a command. Use `arg.<kind>()` to create
 * an {@linkcode ArgBuilder}, then chain modifiers and pass the result to
 * `command().arg(name, builder)`.
 *
 * Four kinds are available:
 * - `arg.string()` — raw string (most common)
 * - `arg.number()` — parsed to number, errors on NaN
 * - `arg.enum(values)` — constrained to listed literals
 * - `arg.custom(fn)` — arbitrary parse function, infers return type
 *
 * @example
 * ```ts
 * import { command, arg } from '@kjanat/dreamcli';
 *
 * command('deploy')
 *   .arg('target', arg.string().env('DEPLOY_TARGET').describe('Where to deploy'))
 *   .arg('port', arg.number().env('PORT').default(3000))
 *   .action(({ args }) => {
 *     console.log(`Deploying to ${args.target} on port ${args.port}`);
 *   });
 *
 * // $ mycli deploy production 8080    → target='production', port=8080
 * // $ DEPLOY_TARGET=staging mycli deploy → target='staging', port=3000
 * ```
 */
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

	enum<const T extends readonly [string, ...string[]]>(
		values: T,
	): ArgBuilder<{
		readonly valueType: T[number];
		readonly presence: 'required';
		readonly variadic: false;
	}> {
		return new ArgBuilder(createArgSchema('enum', { enumValues: values }));
	},

	custom<T>(parseFn: ArgParseFn<T>): ArgBuilder<{
		readonly valueType: T;
		readonly presence: 'required';
		readonly variadic: false;
	}> {
		return new ArgBuilder(createArgSchema('custom', { parseFn: parseFn as ArgParseFn<unknown> }));
	},
};

// --- Exports

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
export { ARG_KINDS, ARG_PRESENCES, ArgBuilder, arg, createArgSchema };
