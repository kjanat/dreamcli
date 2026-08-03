/**
 * Positional argument schema builder with full type inference.
 *
 * Each factory (`arg.string()`, `arg.number()`, `arg.enum()`, `arg.custom()`,
 * `arg.url()`, `arg.path()`, `arg.date()`, `arg.duration()`, `arg.bytes()`)
 * returns an immutable {@linkcode ArgBuilder} whose generic parameter tracks the
 * value type, presence state, and variadic flag through the fluent chain.
 *
 * @module dreamcli/core/schema/arg
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { schemaBrand } from './brand.ts';
import { assertNumberConstraints, type NumberConstraints } from './number-constraints.ts';
import type { InputPromptConfig, PromptConfig, SelectPromptConfig } from './prompt.ts';
import { type InferStandardOutput, isStandardSchemaV1, type StandardSchemaV1 } from './standard.ts';
import type { StdinBinding, StdinOptions } from './stdin.ts';
import { normalizeStdinBinding } from './stdin.ts';
import { assertStringConstraints, type StringConstraints } from './string-constraints.ts';
import {
	bytesValue,
	dateValue,
	durationValue,
	numberValue,
	pathValue,
	standardValue,
	stringParsedValue,
	stringValue,
	urlValue,
	valueDefinitionFields,
} from './value.ts';
import type {
	DateFlagOptions,
	PathChecks,
	PathFlagOptions,
	UrlFlagOptions,
} from './value-parsers.ts';

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
	/** The runtime kind discriminator, mirroring {@link ArgKind}. */
	readonly argKind: ArgKind;
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
	readonly argKind: C['argKind'];
};

/**
 * Advanced type helper used by {@linkcode ArgBuilder.variadic | ArgBuilder.variadic()}.
 * Most consumers rely on inference and never reference this directly.
 */
type WithVariadic<C extends ArgConfig> = {
	readonly valueType: C['valueType'];
	readonly presence: C['presence'];
	readonly variadic: true;
	readonly argKind: C['argKind'];
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

/**
 * Maps an {@linkcode ArgKind} to the prompt config types compatible with it,
 * mirroring the flag table for the four kinds args have.
 *
 * - `'string'` → {@link InputPromptConfig} | {@link SelectPromptConfig}
 * - `'number'` → {@link InputPromptConfig}
 * - `'enum'`   → {@link SelectPromptConfig} | {@link InputPromptConfig}
 * - `'custom'` → all prompt kinds ({@link PromptConfig})
 */
type PromptConfigByArgKind = {
	readonly string: InputPromptConfig | SelectPromptConfig;
	readonly number: InputPromptConfig;
	readonly enum: SelectPromptConfig | InputPromptConfig;
	readonly custom: PromptConfig;
};

/** Prompt configuration compatible with the kind carried by an {@link ArgConfig}. */
type AllowedArgPromptConfig<C extends ArgConfig> = PromptConfigByArgKind[C['argKind']];

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
 * The value type produced by `arg.custom()` for a given argument: the return
 * type of a parse function, or the output type of a Standard Schema validator.
 */
type CustomArgValue<A> =
	A extends ArgParseFn<infer T> ? T : A extends StandardSchemaV1 ? InferStandardOutput<A> : never;

/**
 * The runtime descriptor stored inside every {@linkcode ArgBuilder}. Consumers (parser,
 * help generator) read this to understand the arg's shape without touching
 * generics.
 */
interface ArgSchema<K extends ArgKind = ArgKind> {
	/** Type-only seal produced by {@link createArgSchema}. */
	readonly [schemaBrand]: 'arg';
	/** What kind of value this arg accepts. */
	readonly kind: K;
	/** Current presence state. */
	readonly presence: ArgPresence;
	/** Whether this arg consumes all remaining positionals. */
	readonly variadic: boolean;
	/**
	 * Stdin binding set by `.stdin()` (`undefined` when the arg never reads
	 * stdin). See {@link StdinBinding}.
	 */
	readonly stdin: StdinBinding | undefined;
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
	/**
	 * Dotted config path for config resolution (e.g. `'deploy.region'`).
	 *
	 * @see {@link ArgBuilder.config} for the builder method.
	 */
	readonly configPath: string | undefined;
	/**
	 * Interactive prompt configuration.
	 *
	 * @see {@link ArgBuilder.prompt} for the builder method.
	 */
	readonly prompt: PromptConfig | undefined;
	/** Allowed literal values when `kind === 'enum'`. */
	readonly enumValues: readonly string[] | undefined;
	/**
	 * Numeric constraints when `kind === 'number'` (`undefined` otherwise).
	 *
	 * Enforced at the parse and resolution boundaries. `finite` defaults to
	 * `true`, so `Infinity` is rejected even when no constraints object is set.
	 */
	readonly numberConstraints: NumberConstraints | undefined;
	/**
	 * String constraints when `kind === 'string'` (`undefined` otherwise).
	 *
	 * Enforced at the parse and resolution boundaries, in fixed order:
	 * nonEmpty → minLength → maxLength → pattern. A `defaultValue` reaches
	 * neither boundary and is not checked.
	 */
	readonly stringConstraints: StringConstraints | undefined;
	/**
	 * Filesystem checks for path-valued args (set by `arg.path()`).
	 *
	 * Validated after resolution through the runtime adapter, so CLI, stdin,
	 * env, and defaulted values are all checked. Only meaningful when
	 * `kind === 'string'`.
	 */
	readonly pathChecks: PathChecks | undefined;
	/**
	 * Help placeholder label (e.g. `'url'`).
	 *
	 * Set by the sugar factories (`arg.url()`, `arg.date()`, …) so tooling
	 * reading the schema knows the expected value shape. Help renders a
	 * positional by its own name, so this does not change the usage line.
	 */
	readonly valueHint: string | undefined;
	/** Custom parse function (only when `kind === 'custom'`). */
	readonly parseFn: ArgParseFn<unknown> | undefined;
	/**
	 * Standard Schema v1 validator applied to the resolved value.
	 *
	 * When set, the value from any source (CLI, env, stdin, default) is
	 * validated after resolution via `~standard.validate`. Sync and async
	 * validators are both awaited; issues surface as a `CONSTRAINT_VIOLATED`
	 * {@link ValidationError}. Only meaningful when `kind === 'custom'`.
	 */
	readonly standard: StandardSchemaV1 | undefined;
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

/** Every {@link ArgSchema} field except the brand and the kind discriminator. */
type ArgSchemaFields = Omit<ArgSchema, typeof schemaBrand | 'kind'>;

/** {@link ArgSchemaFields} with every field optional and undefined-accepting. */
type ArgSchemaFieldOverrides = {
	readonly [K in keyof ArgSchemaFields]?: K extends 'stdin'
		? StdinOptions | undefined
		: ArgSchemaFields[K] | undefined;
};

/** Definition fields accepted by every arg kind. */
interface ArgDefinitionBase {
	/**
	 * Presence state.
	 * @defaultValue `'required'`
	 */
	readonly presence?: ArgPresence | undefined;
	/**
	 * Whether this arg consumes all remaining positionals.
	 * @defaultValue `false`
	 */
	readonly variadic?: boolean | undefined;
	/**
	 * Stdin binding. See {@link StdinOptions}.
	 * @defaultValue `undefined`
	 */
	readonly stdin?: StdinOptions | undefined;
	/**
	 * Runtime default value.
	 * @defaultValue `undefined`
	 */
	readonly defaultValue?: unknown;
	/**
	 * Human-readable description for help text.
	 * @defaultValue `undefined`
	 */
	readonly description?: string | undefined;
	/**
	 * Environment variable name for env resolution.
	 * @defaultValue `undefined`
	 */
	readonly envVar?: string | undefined;
	/**
	 * Dotted config path for config resolution (e.g. `'deploy.region'`).
	 * @defaultValue `undefined`
	 */
	readonly configPath?: string | undefined;
	/**
	 * Interactive prompt configuration.
	 * @defaultValue `undefined`
	 */
	readonly prompt?: PromptConfig | undefined;
	/**
	 * Help placeholder label (`'url'`, `'path'`, …).
	 * @defaultValue `undefined`
	 */
	readonly valueHint?: string | undefined;
	/**
	 * Deprecation marker. `true` deprecates without a message, a string carries
	 * the migration guidance.
	 * @defaultValue `undefined`
	 */
	readonly deprecated?: string | true | undefined;
}

/** Definition of a `string` arg. */
interface StringArgDefinition extends ArgDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'string';
	/**
	 * String constraints enforced at the parse and resolution boundaries.
	 * @defaultValue `undefined`
	 */
	readonly stringConstraints?: StringConstraints | undefined;
	/**
	 * Filesystem checks applied after resolution.
	 * @defaultValue `undefined`
	 */
	readonly pathChecks?: PathChecks | undefined;
}

/** Definition of a `number` arg. */
interface NumberArgDefinition extends ArgDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'number';
	/**
	 * Numeric constraints enforced at the parse and resolution boundaries.
	 * @defaultValue `undefined`
	 */
	readonly numberConstraints?: NumberConstraints | undefined;
}

/** Definition of an `enum` arg. */
interface EnumArgDefinition extends ArgDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'enum';
	/** Allowed literal values. */
	readonly enumValues: readonly string[];
}

/** Definition of a `custom` arg. */
interface CustomArgDefinition extends ArgDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'custom';
	/**
	 * Parse function applied to the raw value.
	 * @defaultValue `undefined`
	 */
	readonly parseFn?: ArgParseFn<unknown> | undefined;
	/**
	 * Standard Schema v1 validator applied to the resolved value.
	 * @defaultValue `undefined`
	 */
	readonly standard?: StandardSchemaV1 | undefined;
}

/** Maps each {@link ArgKind} to its definition shape. */
interface ArgDefinitionByKind {
	/** Definition shape for `string` args. */
	readonly string: StringArgDefinition;
	/** Definition shape for `number` args. */
	readonly number: NumberArgDefinition;
	/** Definition shape for `enum` args. */
	readonly enum: EnumArgDefinition;
	/** Definition shape for `custom` args. */
	readonly custom: CustomArgDefinition;
}

/** Definition of an arg of kind `K`, including the kind discriminator. */
type ArgDefinition<K extends ArgKind = ArgKind> = ArgDefinitionByKind[K];

/** Definition of an arg of kind `K` with the kind discriminator removed. */
type ArgDefinitionOverrides<K extends ArgKind = ArgKind> = Omit<ArgDefinitionByKind[K], 'kind'>;

/** Positional factory arguments, requiring fields that the selected kind requires. */
type ArgDefinitionArguments<K extends ArgKind> = K extends 'enum'
	? [overrides: ArgDefinitionOverrides<K>]
	: [overrides?: ArgDefinitionOverrides<K>];

/**
 * Fields that are only meaningful on one {@link ArgKind}, mapped to that kind.
 */
const KIND_SPECIFIC_ARG_FIELDS: readonly (readonly [keyof ArgSchemaFields, ArgKind])[] = [
	['enumValues', 'enum'],
	['numberConstraints', 'number'],
	['stringConstraints', 'string'],
	['pathChecks', 'string'],
	['parseFn', 'custom'],
	['standard', 'custom'],
];

/**
 * Reject a definition that carries a field belonging to another {@link ArgKind}.
 *
 * A field set to `undefined` counts as absent, so re-feeding a built
 * {@link ArgSchema} back through {@link createArgSchema} stays valid.
 *
 * @param kind - Declared kind of the definition.
 * @param fields - Definition fields excluding the kind discriminator.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` on a kind mismatch.
 */
function assertValidArgDefinition(kind: ArgKind, fields: ArgSchemaFieldOverrides): void {
	for (const [field, requiredKind] of KIND_SPECIFIC_ARG_FIELDS) {
		if (kind === requiredKind) continue;
		if (fields[field] === undefined) continue;
		throw new CLIError(
			`Arg schema field '${field}' requires kind '${requiredKind}', received kind '${kind}'`,
			{
				code: 'INVALID_SCHEMA',
				details: { kind, field, requiredKind },
				suggest: `Drop '${field}' or declare the arg as kind '${requiredKind}'`,
			},
		);
	}

	if (kind === 'enum' && fields.enumValues === undefined) {
		throw new CLIError("Arg schema kind 'enum' requires field 'enumValues'", {
			code: 'INVALID_SCHEMA',
			details: { kind, field: 'enumValues' },
			suggest: "Pass the allowed values in 'enumValues'",
		});
	}
}

/**
 * Merge definition fields onto the {@link ArgSchema} defaults.
 *
 * A field set to `undefined` falls back to its default for the fields
 * {@link ArgSchema} declares as non-nullable.
 *
 * @param kind - Discriminator for the value type this arg accepts.
 * @param overrides - Definition fields shallow-merged onto the defaults.
 * @returns A fully populated {@link ArgSchema}.
 */
function buildArgSchema<K extends ArgKind>(
	kind: K,
	overrides?: ArgSchemaFieldOverrides,
): ArgSchema<K> {
	const { presence, variadic, stdin, ...rest } = overrides ?? {};
	return {
		kind,
		presence: presence ?? 'required',
		variadic: variadic ?? false,
		stdin: stdin === undefined ? undefined : normalizeStdinBinding(stdin),
		defaultValue: undefined,
		description: undefined,
		envVar: undefined,
		configPath: undefined,
		prompt: undefined,
		enumValues: undefined,
		numberConstraints: undefined,
		stringConstraints: undefined,
		pathChecks: undefined,
		valueHint: undefined,
		parseFn: undefined,
		standard: undefined,
		deprecated: undefined,
		...rest,
	} as ArgSchema<K>;
}

/**
 * Create a raw {@link ArgSchema} object with sensible defaults.
 *
 * Most consumers should prefer the higher-level {@link arg} factory, which
 * returns an immutable {@link ArgBuilder} with type inference and fluent
 * modifiers. `createArgSchema()` exists for advanced schema composition,
 * targeted tests, or custom builders that need the plain runtime descriptor.
 *
 * Fields are shallow-merged on top of the default shape, so callers are
 * responsible for preserving invariants such as variadic ordering.
 *
 * @param kind - Discriminator for the value type this arg accepts.
 * @param overrides - Definition fields for `kind`, shallow-merged onto defaults.
 * @returns A fully populated {@link ArgSchema}.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` when a field belongs to a
 *   different {@link ArgKind}.
 *
 * @example
 * ```ts
 * const schema = createArgSchema('custom', {
 *   description: 'Hex color',
 *   parseFn: (raw) => `#${raw}`,
 * });
 * ```
 */
function createArgSchema<K extends ArgKind>(
	kind: K,
	...args: ArgDefinitionArguments<K>
): ArgSchema<K>;
/**
 * Create a raw {@link ArgSchema} object from a single definition object.
 *
 * An already-built {@link ArgSchema} is accepted and re-normalized into a
 * deep-equal schema.
 *
 * @param definition - Kind discriminator plus the fields valid for that kind.
 * @returns A fully populated {@link ArgSchema}.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` when a field belongs to a
 *   different {@link ArgKind}.
 *
 * @example
 * ```ts
 * const schema = createArgSchema({
 *   kind: 'enum',
 *   enumValues: ['us', 'eu', 'ap'],
 *   description: 'Target region',
 * });
 * ```
 */
function createArgSchema<K extends ArgKind>(
	definition: ArgDefinition<K> | ArgSchema<K>,
): ArgSchema<K>;
function createArgSchema(
	kindOrDefinition: ArgKind | ArgDefinition | ArgSchema,
	overrides?: ArgSchemaFieldOverrides,
): ArgSchema {
	if (typeof kindOrDefinition === 'string') {
		assertValidArgDefinition(kindOrDefinition, overrides ?? {});
		return buildArgSchema(kindOrDefinition, overrides);
	}

	const { kind, ...fields } = kindOrDefinition;
	assertValidArgDefinition(kind, fields);
	return buildArgSchema(kind, fields);
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
	 * (CLI → stdin → env → config → prompt → default).
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
	 * Resolution order when extra sources are configured:
	 * CLI → stdin → env → config → prompt → **default**.
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
	 * Let this arg read its value from piped stdin.
	 *
	 * An explicit `-` in the arg's slot is CLI-sourced with bytes from stdin and
	 * keeps CLI precedence. An absent positional takes the stdin fallback stage,
	 * which sits between CLI and env, so an arg set in the environment still
	 * reads stdin and stdin wins. The whole buffer becomes the value, byte for
	 * byte for a string arg; every other kind drops the single line terminator a
	 * pipe appends before decoding.
	 *
	 * One command may declare a single exclusive stdin consumer; pass
	 * `{ consume: 'broadcast' }` on every input that should share the buffer.
	 *
	 * @param options - When to read stdin and how to share it.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().describe('Input text').stdin()
	 * // $ echo "hello" | mycli transform   → input = 'hello\n' (from stdin)
	 * // $ mycli transform -                → input reads stdin
	 * // $ mycli transform "hello"          → input = 'hello' (from CLI)
	 *
	 * arg.string().stdin({ when: 'dash' })
	 * // only an explicit `-` reads stdin
	 * ```
	 */
	stdin(options?: StdinOptions): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			stdin: normalizeStdinBinding(options),
		});
	}

	// -- Resolution source modifiers ------------------------------------------

	/**
	 * Bind to an environment variable.
	 *
	 * When the arg is not provided on the CLI or by stdin, the resolver checks
	 * this env var before config, prompt, and the default value. The env string
	 * is coerced to the arg's declared kind (passthrough for strings, parsed
	 * for numbers, run through `parseFn` for custom args).
	 *
	 * Resolution order when extra sources are configured:
	 * **CLI → stdin → env → config → prompt → default**.
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

	/**
	 * Bind to a dotted config path.
	 *
	 * The config value is read after CLI, stdin, and env, and is coerced to the
	 * arg's declared kind the same way a flag's config value is.
	 *
	 * @param path - Dotted config key (e.g. `'deploy.region'`).
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().config('deploy.region').default('us-east-1')
	 * // Config file: { "deploy": { "region": "eu-west-1" } }
	 * // $ mycli deploy             → region = 'eu-west-1'
	 * // $ mycli deploy ap-south-1  → CLI positional wins
	 * ```
	 */
	config(path: string): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			configPath: path,
		});
	}

	/**
	 * Attach interactive prompt configuration.
	 *
	 * When CLI, stdin, env, and config all produce nothing, the prompt engine
	 * uses this config to ask the user. In non-interactive contexts the prompt
	 * is skipped and resolution falls through to the default or the missing-arg
	 * error.
	 *
	 * @param config - {@link PromptConfig} describing the interactive prompt.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().prompt({ kind: 'input', message: 'Target:' })
	 * // $ mycli deploy             → prompts "Target:"
	 * // $ mycli deploy production  → skips the prompt
	 * ```
	 */
	prompt(config: AllowedArgPromptConfig<C>): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			prompt: config,
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

	// -- Numeric constraint modifiers ----------------------------------------
	//
	// Compile-time guarded via a `this` parameter so they are only callable on
	// number-kind builders. They merge onto the single `numberConstraints`
	// representation, overriding any value set by `arg.number({ … })`.

	/**
	 * Require an integer value. Composes with other numeric constraints.
	 *
	 * @param value - Whether to require an integer.
	 * @defaultValue `true`
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.number().int()         // rejects 3.7, accepts 3
	 * arg.number({ int: true }).int(false) // re-allows non-integers
	 * ```
	 */
	int(this: ArgBuilder<C & { readonly argKind: 'number' }>, value = true): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			numberConstraints: { ...this.schema.numberConstraints, int: value },
		});
	}

	/**
	 * Set an inclusive lower bound. Composes with other numeric constraints;
	 * a later call overrides an earlier `min` (including one from the options
	 * object).
	 *
	 * @param value - Inclusive minimum.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.number().min(0)              // rejects -1, accepts 0
	 * arg.number({ min: 0 }).min(5)    // effective min is 5
	 * ```
	 */
	min(this: ArgBuilder<C & { readonly argKind: 'number' }>, value: number): ArgBuilder<C> {
		const numberConstraints = { ...this.schema.numberConstraints, min: value };
		assertNumberConstraints(numberConstraints);
		return new ArgBuilder({ ...this.schema, numberConstraints });
	}

	/**
	 * Set an inclusive upper bound. Composes with other numeric constraints;
	 * a later call overrides an earlier `max`.
	 *
	 * @param value - Inclusive maximum.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.number().max(100)            // rejects 101, accepts 100
	 * ```
	 */
	max(this: ArgBuilder<C & { readonly argKind: 'number' }>, value: number): ArgBuilder<C> {
		const numberConstraints = { ...this.schema.numberConstraints, max: value };
		assertNumberConstraints(numberConstraints);
		return new ArgBuilder({ ...this.schema, numberConstraints });
	}

	/**
	 * Require (or, with `false`, allow) a finite value. Finiteness is enforced
	 * by default, so this is mainly used as `.finite(false)` to re-allow
	 * `Infinity` / `-Infinity`.
	 *
	 * @param allow - Whether to require a finite value.
	 * @defaultValue `true`
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.number().finite(false) // accepts Infinity
	 * ```
	 */
	finite(this: ArgBuilder<C & { readonly argKind: 'number' }>, allow = true): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			numberConstraints: { ...this.schema.numberConstraints, finite: allow },
		});
	}

	// -- String constraint modifiers -------------------------------------------
	//
	// Compile-time guarded via a `this` parameter so they are only callable on
	// string-kind builders. They merge onto the single `stringConstraints`
	// representation, overriding any value set by `arg.string({ … })`.

	/**
	 * Reject empty strings. Composes with other string constraints.
	 *
	 * @param value - Whether to reject empty strings.
	 * @defaultValue `true`
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().nonEmpty()   // rejects '', accepts 'x'
	 * ```
	 */
	nonEmpty(this: ArgBuilder<C & { readonly argKind: 'string' }>, value = true): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			stringConstraints: { ...this.schema.stringConstraints, nonEmpty: value },
		});
	}

	/**
	 * Set an inclusive minimum length (UTF-16 code units). Composes with other
	 * string constraints; a later call overrides an earlier `minLength`.
	 *
	 * @param value - Inclusive minimum length.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().minLength(3)   // rejects 'ab', accepts 'abc'
	 * ```
	 */
	minLength(this: ArgBuilder<C & { readonly argKind: 'string' }>, value: number): ArgBuilder<C> {
		const stringConstraints = { ...this.schema.stringConstraints, minLength: value };
		assertStringConstraints(stringConstraints);
		return new ArgBuilder({ ...this.schema, stringConstraints });
	}

	/**
	 * Set an inclusive maximum length (UTF-16 code units). Composes with other
	 * string constraints; a later call overrides an earlier `maxLength`.
	 *
	 * @param value - Inclusive maximum length.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().maxLength(8)   // rejects 9+ chars
	 * ```
	 */
	maxLength(this: ArgBuilder<C & { readonly argKind: 'string' }>, value: number): ArgBuilder<C> {
		const stringConstraints = { ...this.schema.stringConstraints, maxLength: value };
		assertStringConstraints(stringConstraints);
		return new ArgBuilder({ ...this.schema, stringConstraints });
	}

	/**
	 * Require the value to match a regular expression. Anchor with `^`/`$`
	 * for full-string matching. Composes with other string constraints.
	 *
	 * @param value - Pattern the value must match.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * arg.string().pattern(/^ghp_/)   // rejects 'abc', accepts 'ghp_x'
	 * ```
	 */
	pattern(this: ArgBuilder<C & { readonly argKind: 'string' }>, value: RegExp): ArgBuilder<C> {
		return new ArgBuilder({
			...this.schema,
			stringConstraints: { ...this.schema.stringConstraints, pattern: value },
		});
	}
}

// --- Factory namespace

/**
 * Arg factory functions — the public API for creating positional arguments.
 *
 * Each method returns an {@linkcode ArgBuilder} seeded with the correct {@linkcode ArgKind}
 * and initial type-level config. Chain modifiers (`.optional()`, `.env()`,
 * `.config()`, `.prompt()`, `.default()`, `.variadic()`, `.stdin()`,
 * `.describe()`, `.deprecated()`) to refine.
 *
 * All args are **required** by default. Resolution order when extra
 * sources are configured: **CLI → stdin → env → config → prompt → default**.
 *
 * @example Overview of common kinds with common modifier patterns
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
	 * String-valued positional argument, with optional string constraints.
	 * Required by default.
	 *
	 * Constraints are enforced at the parse and resolution boundaries, in
	 * fixed order: nonEmpty → minLength → maxLength → pattern. A `.default()`
	 * value reaches neither boundary and is not checked. They also compose via
	 * chained methods (`.nonEmpty()`, `.minLength()`, `.maxLength()`,
	 * `.pattern()`), which override values set here.
	 *
	 * @param constraints - Optional string constraints.
	 * @defaultValue `undefined` (no constraints)
	 * @returns A required string {@link ArgBuilder}.
	 *
	 * @example
	 * ```ts
	 * arg.string()                        // required string
	 * arg.string().optional()             // string | undefined
	 * arg.string().env('TARGET')          // falls back to $TARGET
	 * arg.string().default('production')  // always present
	 * arg.string({ nonEmpty: true })      // rejects ''
	 * arg.string({ pattern: /^ghp_/ })    // token shapes
	 *
	 * // In a command:
	 * command('deploy')
	 *   .arg('target', arg.string().env('DEPLOY_TARGET').describe('Deploy target'))
	 * ```
	 */
	string(constraints?: StringConstraints): ArgBuilder<{
		readonly valueType: string;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'string';
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
	 * Constraints are enforced at the parse and resolution boundaries and also
	 * compose via chained methods (`.int()`, `.min()`, `.max()`, `.finite()`),
	 * which override values set here. The resolved value type stays `number`.
	 *
	 * @param constraints - Optional numeric constraints. `finite` defaults to
	 *   `true`, so `Infinity` / `-Infinity` are rejected unless `finite: false`.
	 * @defaultValue `undefined` (finite-only, no bounds, non-integer allowed)
	 * @returns A required number {@link ArgBuilder}.
	 */
	number(constraints?: NumberConstraints): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'number';
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
		readonly argKind: 'enum';
	}>;

	/**
	 * Custom positional argument validated by a Standard Schema v1 validator
	 * (zod, valibot, arktype, …). The resolved value from any source is
	 * validated after resolution; the arg's value type is the validator's
	 * output type.
	 *
	 * Sync and async validators are both supported. Validation issues surface
	 * as a `CONSTRAINT_VIOLATED` error naming the argument.
	 *
	 * @example
	 * ```ts
	 * import { z } from 'zod';
	 * arg.custom(z.string().uuid())
	 * // inferred type: string
	 * ```
	 *
	 * @param schema - A Standard Schema v1 validator.
	 * @returns A required custom {@link ArgBuilder} typed to the validator's output.
	 */
	custom<S extends StandardSchemaV1>(
		schema: S,
	): ArgBuilder<{
		readonly valueType: InferStandardOutput<S>;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
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
		readonly argKind: 'custom';
	}>;

	/**
	 * URL-valued positional argument. Parses into a `URL`; invalid URLs are
	 * rejected with an `INVALID_VALUE` error naming the argument.
	 *
	 * @param options - Optional protocol allowlist (without trailing colon).
	 * @returns A required `URL` {@link ArgBuilder}.
	 *
	 * @example
	 * ```ts
	 * arg.url()                            // any URL
	 * arg.url({ protocols: ['https'] })    // https only
	 *
	 * // In a command:
	 * command('fetch')
	 *   .arg('endpoint', arg.url().env('API_URL').describe('Service endpoint'))
	 * ```
	 */
	url(options?: UrlFlagOptions): ArgBuilder<{
		readonly valueType: URL;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}>;

	/**
	 * Path-valued positional argument. The value stays a `string`; optional
	 * filesystem checks run **after resolution** through the runtime adapter,
	 * so CLI, stdin, env, and defaulted values are all validated.
	 *
	 * A variadic path arg checks every value it collects. Help renders a
	 * positional by its own name, so the `'path'` value hint on the schema does
	 * not reach the usage line.
	 *
	 * @param options - Optional existence/type checks. `type` implies
	 *   existence unless `mustExist` is explicitly `false`.
	 * @returns A required path-string {@link ArgBuilder}.
	 *
	 * @example
	 * ```ts
	 * arg.path()                          // any string
	 * arg.path({ mustExist: true })       // rejects missing paths
	 * arg.path({ type: 'directory' })     // must exist and be a directory
	 * arg.path({ type: 'directory', create: true })
	 *                                     // created recursively when missing
	 * ```
	 */
	path(options?: PathFlagOptions): ArgBuilder<{
		readonly valueType: string;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'string';
	}>;

	/**
	 * Date-valued positional argument. Accepts strict ISO-8601 (`2026-07-10`,
	 * `2026-07-10T14:30:00Z`) and parses into a `Date`. Lenient `Date.parse`
	 * inputs (`'0'`, `'March 5'`) and calendar-invalid dates (`2026-02-31`)
	 * are rejected.
	 *
	 * Returns `Date` (not `Temporal`) because the supported runtimes do not
	 * all ship Temporal yet; use `arg.custom()` with `Temporal.PlainDate.from`
	 * where the target runtime has it.
	 *
	 * @param options - Optional inclusive `min`/`max` date bounds.
	 * @returns A required `Date` {@link ArgBuilder}.
	 *
	 * @example
	 * ```ts
	 * arg.date()
	 * arg.date({ min: new Date('2020-01-01') })
	 * ```
	 */
	date(options?: DateFlagOptions): ArgBuilder<{
		readonly valueType: Date;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}>;

	/**
	 * Duration positional argument. Accepts `'30s'`, `'5m'`, `'1.5h'`,
	 * `'250ms'`, `'2d'`, compounds like `'1h30m'`, or a bare millisecond
	 * count, and resolves to **milliseconds**.
	 *
	 * @returns A required duration {@link ArgBuilder} in milliseconds.
	 *
	 * @example
	 * ```ts
	 * arg.duration().default(30_000)   // `mycli wait 45s` → 45000
	 * ```
	 */
	duration(): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}>;

	/**
	 * Byte-size positional argument. Accepts `'512mb'`, `'1.5gb'`, `'64kb'`,
	 * `'100b'` or a bare byte count, and resolves to **bytes**. Units are
	 * binary (`1kb` = 1024) and case-insensitive.
	 *
	 * @returns A required size {@link ArgBuilder} in bytes.
	 *
	 * @example
	 * ```ts
	 * arg.bytes().default(10 * 1024 ** 2)   // `mycli split 512kb` → 524288
	 * ```
	 */
	bytes(): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}>;
}

/**
 * Positional argument schema factory.
 *
 * Entry point for defining args on a command. Use `arg.<kind>()` to create
 * an {@linkcode ArgBuilder}, then chain modifiers and pass the result to
 * `command().arg(name, builder)`.
 *
 * Four base kinds are available:
 * - `arg.string()` — raw string (most common)
 * - `arg.number()` — parsed to number, errors on NaN
 * - `arg.enum(values)` — constrained to listed literals
 * - `arg.custom(fn)` — arbitrary parse function, infers return type
 *
 * Five sugar factories build on them, mirroring their flag counterparts:
 * - `arg.url()` parses to `URL`, with an optional protocol allowlist
 * - `arg.path()` keeps the string and adds optional filesystem checks
 * - `arg.date()` parses strict ISO-8601 to `Date`
 * - `arg.duration()` resolves `'1h30m'` and friends to milliseconds
 * - `arg.bytes()` resolves `'512mb'` and friends to bytes
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
	string(constraints?: StringConstraints): ArgBuilder<{
		readonly valueType: string;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'string';
	}> {
		if (constraints !== undefined) {
			assertStringConstraints(constraints);
		}
		return new ArgBuilder(
			createArgSchema('string', valueDefinitionFields(stringValue(constraints))),
		);
	},

	number(constraints?: NumberConstraints): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'number';
	}> {
		if (constraints !== undefined) {
			assertNumberConstraints(constraints);
		}
		return new ArgBuilder(
			createArgSchema('number', valueDefinitionFields(numberValue(constraints))),
		);
	},

	enum<const T extends readonly [string, ...string[]]>(
		values: T,
	): ArgBuilder<{
		readonly valueType: T[number];
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'enum';
	}> {
		return new ArgBuilder(createArgSchema('enum', { enumValues: values }));
	},

	custom<A extends ArgParseFn<unknown> | StandardSchemaV1>(
		parseFnOrSchema: A,
	): ArgBuilder<{
		readonly valueType: CustomArgValue<A>;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}> {
		if (isStandardSchemaV1(parseFnOrSchema)) {
			return new ArgBuilder(
				createArgSchema('custom', valueDefinitionFields(standardValue(parseFnOrSchema))),
			);
		}
		return new ArgBuilder(
			createArgSchema('custom', valueDefinitionFields(stringParsedValue(parseFnOrSchema))),
		);
	},

	url(options?: UrlFlagOptions): ArgBuilder<{
		readonly valueType: URL;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}> {
		return new ArgBuilder(createArgSchema('custom', valueDefinitionFields(urlValue(options))));
	},

	path(options?: PathFlagOptions): ArgBuilder<{
		readonly valueType: string;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'string';
	}> {
		return new ArgBuilder(createArgSchema('string', valueDefinitionFields(pathValue(options))));
	},

	date(options?: DateFlagOptions): ArgBuilder<{
		readonly valueType: Date;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}> {
		return new ArgBuilder(createArgSchema('custom', valueDefinitionFields(dateValue(options))));
	},

	duration(): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}> {
		return new ArgBuilder(createArgSchema('custom', valueDefinitionFields(durationValue())));
	},

	bytes(): ArgBuilder<{
		readonly valueType: number;
		readonly presence: 'required';
		readonly variadic: false;
		readonly argKind: 'custom';
	}> {
		return new ArgBuilder(createArgSchema('custom', valueDefinitionFields(bytesValue())));
	},
};

// --- Exports

export type { StdinBinding, StdinConsume, StdinOptions, StdinWhen } from './stdin.ts';
export type {
	AllowedArgPromptConfig,
	ArgConfig,
	ArgDefinition,
	ArgDefinitionBase,
	ArgDefinitionByKind,
	ArgDefinitionOverrides,
	ArgFactory,
	ArgKind,
	ArgParseFn,
	ArgPresence,
	ArgSchema,
	CustomArgDefinition,
	EnumArgDefinition,
	InferArg,
	InferArgs,
	NumberArgDefinition,
	PromptConfigByArgKind,
	ResolvedArgValue,
	StringArgDefinition,
	WithArgPresence,
	WithVariadic,
};
export { ARG_KINDS, ARG_PRESENCES, ArgBuilder, arg, createArgSchema };
