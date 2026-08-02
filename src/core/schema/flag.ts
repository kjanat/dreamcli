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

import { CLIError } from '#internals/core/errors/index.ts';
import type { schemaBrand } from './brand.ts';
import { assertNumberConstraints, type NumberConstraints } from './number-constraints.ts';
import type {
	ConfirmPromptConfig,
	InputPromptConfig,
	MultiselectPromptConfig,
	PromptConfig,
	SelectPromptConfig,
} from './prompt.ts';
import { type InferStandardOutput, isStandardSchemaV1, type StandardSchemaV1 } from './standard.ts';
import { assertStringConstraints, type StringConstraints } from './string-constraints.ts';
import {
	buildPathChecks,
	type DateFlagOptions,
	type PathChecks,
	type PathFlagOptions,
	parseBytesValue,
	parseDateValue,
	parseDurationValue,
	parseUrlValue,
	type UrlFlagOptions,
} from './value-parsers.ts';

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
 * an empty array `[]`, and key-value flags to an empty object `{}`.
 */
type OptionalFallback = 'undefined' | 'empty-array' | 'empty-object';

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
	/** The runtime kind discriminator, mirroring {@link FlagKind}. */
	readonly flagKind: FlagKind;
	/**
	 * Whether this builder may still be passed to `flag.array()` as the
	 * element schema.
	 *
	 * Factories producing element-meaningful kinds start `true`. Flag-level
	 * modifiers (`.alias()`, `.env()`, `.prompt()`, `.default()`, …) flip it
	 * to `false` — those settings describe the *flag*, are never read from an
	 * element schema, and would otherwise be silently ignored.
	 */
	readonly elementEligible: boolean;
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
	readonly flagKind: C['flagKind'];
	readonly elementEligible: false;
};

/**
 * Advanced type helper: marks a builder as no longer usable as an array
 * element (returned by flag-level modifiers whose settings elements ignore).
 */
type WithoutElementEligibility<C extends FlagConfig> = {
	readonly valueType: C['valueType'];
	readonly presence: C['presence'];
	readonly optionalFallback: C['optionalFallback'];
	readonly flagKind: C['flagKind'];
	readonly elementEligible: false;
};

/**
 * Compute the final value type from config — this is what handlers receive.
 *
 * Advanced type helper: this powers {@link InferFlag} and action-handler
 * inference. Most apps do not need to mention it explicitly.
 *
 * - `'optional'` + `'undefined'` fallback  → `T | undefined`
 * - `'optional'` + `'empty-array'` / `'empty-object'` fallback → `T`
 * - `'required'`   → `T`
 * - `'defaulted'`  → `T`
 */
type ResolvedValue<C extends FlagConfig> = C['presence'] extends 'optional'
	? C['optionalFallback'] extends 'undefined'
		? C['valueType'] | undefined
		: C['valueType']
	: C['valueType'];

/** Extract the resolved value type from a {@linkcode FlagBuilder}. */
type InferFlag<B> = B extends FlagBuilder<infer C extends FlagConfig> ? ResolvedValue<C> : never;

/** Extract resolved value types from a record of builders. */
type InferFlags<T extends Record<string, FlagBuilder<FlagConfig>>> = {
	[K in keyof T]: InferFlag<T[K]>;
};

/**
 * Maps a {@linkcode FlagConfig} to the prompt config types that are compatible
 * with the flag's kind. Prevents compile-time mismatches such as
 * `flag.enum([…]).prompt({ kind: 'multiselect' })`.
 *
 * - `'boolean'` → {@link ConfirmPromptConfig}
 * - `'string'`  → {@link InputPromptConfig} | {@link SelectPromptConfig}
 * - `'number'`  → {@link InputPromptConfig}
 * - `'enum'`    → {@link SelectPromptConfig} | {@link InputPromptConfig}
 * - `'array'`   → {@link MultiselectPromptConfig}
 * - `'custom'`  → all prompt kinds ({@link PromptConfig})
 * - `'count'` / `'keyValue'` → `never` (not promptable)
 */
type PromptConfigByFlagKind = {
	readonly string: InputPromptConfig | SelectPromptConfig;
	readonly number: InputPromptConfig;
	readonly boolean: ConfirmPromptConfig;
	readonly enum: SelectPromptConfig | InputPromptConfig;
	readonly array: MultiselectPromptConfig;
	readonly custom: PromptConfig;
	readonly count: never;
	readonly keyValue: never;
};

/** Prompt configuration compatible with the kind carried by a {@link FlagConfig}. */
type AllowedPromptConfig<C extends FlagConfig> = PromptConfigByFlagKind[C['flagKind']];

// --- Runtime schema data

/** All flag kind discriminators as a runtime array. */
const FLAG_KINDS = [
	'string',
	'number',
	'boolean',
	'enum',
	'array',
	'custom',
	'count',
	'keyValue',
] as const;

/** Discriminator for the kind of value a flag accepts. */
type FlagKind = (typeof FLAG_KINDS)[number];

/**
 * Custom parse function for `flag.custom()`.
 *
 * Receives `string` from CLI argv and env vars, or any JSON-representable
 * value from config files. Narrow inside the function as needed.
 */
type FlagParseFn<T> = (raw: unknown) => T;

/**
 * The value type produced by `flag.custom()` for a given argument: the return
 * type of a parse function, or the output type of a Standard Schema validator.
 */
type CustomFlagValue<A> =
	A extends FlagParseFn<infer T> ? T : A extends StandardSchemaV1 ? InferStandardOutput<A> : never;

/** Runtime descriptor for a flag alias. */
interface FlagAlias {
	/** Alias name without `-` / `--` prefix. */
	readonly name: string;
	/** Whether the alias is parser-only and hidden from user-facing surfaces. */
	readonly hidden: boolean;
}

/**
 * Negation settings for a boolean flag (set by `.negatable()`).
 *
 * The negated spelling and the positive form are two spellings of ONE
 * logical flag: they share duplicate policy, and the last CLI occurrence
 * wins across both. The negated spelling is presence-only — `--no-foo=x`
 * is rejected.
 */
interface FlagNegation {
	/**
	 * Explicit negated spelling without the `--` prefix (e.g. `'no-sandbox'`).
	 * `undefined` synthesizes `no-<flagName>` wherever the flag name is known.
	 */
	readonly alias: string | undefined;
	/** Hide the negated spelling from help, completions, and suggestions. */
	readonly hidden: boolean;
}

/**
 * How repeated CLI occurrences of a singleton flag combine.
 *
 * - `'last'`  — last occurrence wins (matches historic behavior)
 * - `'first'` — first occurrence wins; later ones parse but are ignored
 * - `'error'` — a second occurrence is a `ParseError` (`DUPLICATE_FLAG`)
 *
 * Applies to CLI token occurrences only — env/config/prompt/default
 * resolution keeps its precedence semantics and never raises duplicates.
 * Occurrences are counted per *logical* flag: aliases and the negated
 * spelling all count toward the same flag.
 *
 * @defaultValue `'last'`
 */
type DuplicatePolicy = 'last' | 'first' | 'error';

/**
 * The runtime descriptor stored inside every {@linkcode FlagBuilder}. Consumers (parser,
 * help generator, resolution chain) read this to understand the flag's shape
 * without touching generics.
 */
interface FlagSchema<K extends FlagKind = FlagKind> {
	/** Type-only seal produced by {@link createFlagSchema}. */
	readonly [schemaBrand]: 'flag';
	/** What kind of value this flag accepts. */
	readonly kind: K;
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
	 * nonEmpty → minLength → maxLength → pattern.
	 */
	readonly stringConstraints: StringConstraints | undefined;
	/** Element schema when `kind === 'array'`. */
	readonly elementSchema: FlagSchema | undefined;
	/**
	 * Value separator when `kind === 'array'` (`undefined` otherwise).
	 *
	 * When set, each CLI occurrence is split on this separator before element
	 * coercion, so `--tag a,b --tag c` yields `['a', 'b', 'c']`. Env and
	 * config string values use this separator too (default `','`).
	 */
	readonly separator: string | undefined;
	/**
	 * Deduplicate resolved array values when `kind === 'array'`.
	 *
	 * Applied after all sources resolve, preserving first-seen order.
	 * Uses `SameValueZero` semantics (like `Set`).
	 */
	readonly unique: boolean;
	/**
	 * Filesystem checks for path-valued flags (set by `flag.path()`).
	 *
	 * Validated after resolution through the runtime adapter.
	 */
	readonly pathChecks: PathChecks | undefined;
	/**
	 * Help placeholder label (e.g. `'url'` renders as `<url>`).
	 *
	 * Set by the sugar factories (`flag.url()`, `flag.date()`, …) so help
	 * output names the expected value shape; `undefined` falls back to the
	 * kind-derived hint.
	 */
	readonly valueHint: string | undefined;
	/** Interactive prompt configuration for v0.3+ resolution. */
	readonly prompt: PromptConfig | undefined;
	/** Custom parse function (only when `kind === 'custom'`). */
	readonly parseFn: FlagParseFn<unknown> | undefined;
	/**
	 * Standard Schema v1 validator applied to the resolved value.
	 *
	 * When set, the value from any source (CLI, env, config, prompt, default)
	 * is validated after resolution via `~standard.validate`. Sync and async
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
	/**
	 * Negation settings when `kind === 'boolean'` and `.negatable()` was
	 * called (`undefined` otherwise). See {@link FlagNegation}.
	 */
	readonly negation: FlagNegation | undefined;
	/**
	 * Duplicate policy for repeated CLI occurrences. See {@link DuplicatePolicy}.
	 *
	 * @defaultValue `'last'`
	 */
	readonly duplicates: DuplicatePolicy;
}

/** Every {@link FlagSchema} field except the brand and the kind discriminator. */
type FlagSchemaFields = Omit<FlagSchema, typeof schemaBrand | 'kind'>;

/**
 * {@link FlagSchemaFields} with every field optional and undefined-accepting.
 *
 * `aliases` widens to the alias shapes a caller may supply.
 */
type FlagSchemaFieldOverrides = {
	readonly [K in keyof FlagSchemaFields]?: K extends 'aliases'
		? readonly (string | FlagAlias)[] | undefined
		: FlagSchemaFields[K] | undefined;
};

/**
 * {@link FlagSchemaFieldOverrides} with `elementSchema` widened to the shapes a
 * definition may supply.
 */
type FlagDefinitionFields = Omit<FlagSchemaFieldOverrides, 'elementSchema'> & {
	readonly elementSchema?: FlagDefinition | FlagSchema | undefined;
};

/** Definition fields accepted by every flag kind. */
interface FlagDefinitionBase {
	/**
	 * Presence state.
	 * @defaultValue `'optional'`
	 */
	readonly presence?: FlagPresence | undefined;
	/**
	 * Runtime default value.
	 * @defaultValue `undefined`
	 */
	readonly defaultValue?: unknown;
	/**
	 * Short/long aliases as bare names or {@link FlagAlias} records.
	 * @defaultValue `[]`
	 */
	readonly aliases?: readonly (string | FlagAlias)[] | undefined;
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
	 * Human-readable description for help text.
	 * @defaultValue `undefined`
	 */
	readonly description?: string | undefined;
	/**
	 * Help placeholder label (`'url'` renders as `<url>`).
	 * @defaultValue `undefined`
	 */
	readonly valueHint?: string | undefined;
	/**
	 * Interactive prompt configuration.
	 * @defaultValue `undefined`
	 */
	readonly prompt?: PromptConfig | undefined;
	/**
	 * Deprecation marker. `true` deprecates without a message, a string carries
	 * the migration guidance.
	 * @defaultValue `undefined`
	 */
	readonly deprecated?: string | true | undefined;
	/**
	 * Whether the flag propagates to descendant commands.
	 * @defaultValue `false`
	 */
	readonly propagate?: boolean | undefined;
	/**
	 * How repeated CLI occurrences combine. See {@link DuplicatePolicy}.
	 * @defaultValue `'last'`
	 */
	readonly duplicates?: DuplicatePolicy | undefined;
}

/** Definition of a `string` flag. */
interface StringFlagDefinition extends FlagDefinitionBase {
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

/** Definition of a `number` flag. */
interface NumberFlagDefinition extends FlagDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'number';
	/**
	 * Numeric constraints enforced at the parse and resolution boundaries.
	 * @defaultValue `undefined`
	 */
	readonly numberConstraints?: NumberConstraints | undefined;
}

/** Definition of a `boolean` flag. */
interface BooleanFlagDefinition extends FlagDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'boolean';
	/**
	 * Negated-spelling settings. See {@link FlagNegation}.
	 * @defaultValue `undefined`
	 */
	readonly negation?: FlagNegation | undefined;
}

/** Definition of an `enum` flag. */
interface EnumFlagDefinition extends FlagDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'enum';
	/** Allowed literal values. */
	readonly enumValues: readonly string[];
}

/** Definition of an `array` flag. */
interface ArrayFlagDefinition extends FlagDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'array';
	/**
	 * Element definition or an already-built element schema.
	 * @defaultValue `undefined`
	 */
	readonly elementSchema?: FlagDefinition | FlagSchema | undefined;
	/**
	 * Value separator each CLI occurrence is split on.
	 * @defaultValue `undefined`
	 */
	readonly separator?: string | undefined;
	/**
	 * Deduplicate the resolved array, preserving first-seen order.
	 * @defaultValue `false`
	 */
	readonly unique?: boolean | undefined;
}

/** Definition of a `custom` flag. */
interface CustomFlagDefinition extends FlagDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'custom';
	/**
	 * Parse function applied to the raw value.
	 * @defaultValue `undefined`
	 */
	readonly parseFn?: FlagParseFn<unknown> | undefined;
	/**
	 * Standard Schema v1 validator applied to the resolved value.
	 * @defaultValue `undefined`
	 */
	readonly standard?: StandardSchemaV1 | undefined;
}

/** Definition of a `count` flag. */
interface CountFlagDefinition extends FlagDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'count';
}

/** Definition of a `keyValue` flag. */
interface KeyValueFlagDefinition extends FlagDefinitionBase {
	/** Kind discriminator. */
	readonly kind: 'keyValue';
}

/** Maps each {@link FlagKind} to its definition shape. */
interface FlagDefinitionByKind {
	/** Definition shape for `string` flags. */
	readonly string: StringFlagDefinition;
	/** Definition shape for `number` flags. */
	readonly number: NumberFlagDefinition;
	/** Definition shape for `boolean` flags. */
	readonly boolean: BooleanFlagDefinition;
	/** Definition shape for `enum` flags. */
	readonly enum: EnumFlagDefinition;
	/** Definition shape for `array` flags. */
	readonly array: ArrayFlagDefinition;
	/** Definition shape for `custom` flags. */
	readonly custom: CustomFlagDefinition;
	/** Definition shape for `count` flags. */
	readonly count: CountFlagDefinition;
	/** Definition shape for `keyValue` flags. */
	readonly keyValue: KeyValueFlagDefinition;
}

/** Definition of a flag of kind `K`, including the kind discriminator. */
type FlagDefinition<K extends FlagKind = FlagKind> = FlagDefinitionByKind[K];

/** Definition of a flag of kind `K` with the kind discriminator removed. */
type FlagDefinitionOverrides<K extends FlagKind = FlagKind> = Omit<FlagDefinitionByKind[K], 'kind'>;

/** Positional factory arguments, requiring fields that the selected kind requires. */
type FlagDefinitionArguments<K extends FlagKind> = K extends 'enum'
	? [overrides: FlagDefinitionOverrides<K>]
	: [overrides?: FlagDefinitionOverrides<K>];

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
 * Effective negated spelling for a flag, or `undefined` when not negatable.
 *
 * The builder cannot know its flag name, so a default (`no-<name>`) is
 * synthesized here — everywhere the canonical name is known (parser, help,
 * completions, collision validation).
 *
 * @param name - Canonical flag name.
 * @param schema - Flag schema (read for {@link FlagNegation}).
 * @returns The negated spelling without the `--` prefix.
 */
function getFlagNegatedName(name: string, schema: FlagSchema): string | undefined {
	if (schema.negation === undefined) return undefined;
	return schema.negation.alias ?? `no-${name}`;
}

/** Every runtime key carried by a normalized {@link FlagSchema}. */
const NORMALIZED_FLAG_SCHEMA_KEYS: readonly (keyof FlagSchema)[] = [
	'kind',
	'presence',
	'defaultValue',
	'aliases',
	'envVar',
	'configPath',
	'description',
	'enumValues',
	'numberConstraints',
	'stringConstraints',
	'elementSchema',
	'separator',
	'unique',
	'pathChecks',
	'valueHint',
	'prompt',
	'parseFn',
	'standard',
	'deprecated',
	'propagate',
	'negation',
	'duplicates',
];

/**
 * Whether an element input already carries every normalized schema key.
 *
 * @param element - Element definition or schema.
 * @returns `true` when the value is already a built {@link FlagSchema}.
 */
function isNormalizedFlagSchema(element: FlagDefinition | FlagSchema): element is FlagSchema {
	return NORMALIZED_FLAG_SCHEMA_KEYS.every((key) => key in element);
}

/**
 * Normalise an array flag's element input into a built {@link FlagSchema}.
 *
 * An already-built schema is returned unchanged, so repeated normalization
 * preserves element identity.
 *
 * @param element - Element definition or schema.
 * @returns The element as a fully populated {@link FlagSchema}.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` when a field belongs to a
 *   different {@link FlagKind}.
 */
function normalizeFlagElementSchema(element: FlagDefinition | FlagSchema): FlagSchema {
	if (isNormalizedFlagSchema(element)) return element;

	const { kind, ...fields } = element;
	assertValidFlagDefinition(kind, fields);
	return buildFlagSchema(kind, normalizeFlagDefinitionFields(fields));
}

/**
 * Resolve a definition's nested `elementSchema` into a built {@link FlagSchema}.
 *
 * @param fields - Definition fields excluding the kind discriminator.
 * @returns The same fields with `elementSchema` normalized.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` when a nested element field
 *   belongs to a different {@link FlagKind}.
 */
function normalizeFlagDefinitionFields(fields: FlagDefinitionFields): FlagSchemaFieldOverrides {
	const { elementSchema, ...rest } = fields;
	if (elementSchema === undefined) return rest;
	return { ...rest, elementSchema: normalizeFlagElementSchema(elementSchema) };
}

/**
 * Fields that are only meaningful on one {@link FlagKind}, mapped to that kind.
 */
const KIND_SPECIFIC_FLAG_FIELDS: readonly (readonly [keyof FlagSchemaFields, FlagKind])[] = [
	['enumValues', 'enum'],
	['numberConstraints', 'number'],
	['stringConstraints', 'string'],
	['pathChecks', 'string'],
	['elementSchema', 'array'],
	['separator', 'array'],
	['parseFn', 'custom'],
	['standard', 'custom'],
	['negation', 'boolean'],
];

/**
 * Reject a definition that carries a field belonging to another {@link FlagKind}.
 *
 * A field set to `undefined` counts as absent, and `unique` counts as absent
 * when `false`, so re-feeding a built {@link FlagSchema} back through
 * {@link createFlagSchema} stays valid.
 *
 * @param kind - Declared kind of the definition.
 * @param fields - Definition fields excluding the kind discriminator.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` on a kind mismatch.
 */
function assertValidFlagDefinition(kind: FlagKind, fields: FlagDefinitionFields): void {
	for (const [field, requiredKind] of KIND_SPECIFIC_FLAG_FIELDS) {
		if (kind === requiredKind) continue;
		if (fields[field] === undefined) continue;
		throw invalidFlagFieldError(kind, field, requiredKind);
	}

	if (kind !== 'array' && fields.unique === true) {
		throw invalidFlagFieldError(kind, 'unique', 'array');
	}

	if (kind === 'enum' && fields.enumValues === undefined) {
		throw new CLIError("Flag schema kind 'enum' requires field 'enumValues'", {
			code: 'INVALID_SCHEMA',
			details: { kind, field: 'enumValues' },
			suggest: "Pass the allowed values in 'enumValues'",
		});
	}

	if (
		(kind === 'array' || kind === 'count' || kind === 'keyValue') &&
		fields.duplicates !== undefined &&
		fields.duplicates !== 'last'
	) {
		throw new CLIError(`Flag schema field 'duplicates' is not supported on kind '${kind}'`, {
			code: 'INVALID_SCHEMA',
			details: { kind, field: 'duplicates' },
			suggest: `Drop 'duplicates'; kind '${kind}' accumulates every occurrence`,
		});
	}
}

/**
 * Build the `'INVALID_SCHEMA'` error for a field used on the wrong kind.
 *
 * @param kind - Declared kind of the definition.
 * @param field - Offending field name.
 * @param requiredKind - Kind the field belongs to.
 * @returns The error to throw.
 */
function invalidFlagFieldError(
	kind: FlagKind,
	field: keyof FlagSchemaFields,
	requiredKind: FlagKind,
): CLIError {
	return new CLIError(
		`Flag schema field '${field}' requires kind '${requiredKind}', received kind '${kind}'`,
		{
			code: 'INVALID_SCHEMA',
			details: { kind, field, requiredKind },
			suggest: `Drop '${field}' or declare the flag as kind '${requiredKind}'`,
		},
	);
}

/**
 * Merge already-normalized schema fields onto the {@link FlagSchema} defaults.
 *
 * A field set to `undefined` falls back to its default for the fields
 * {@link FlagSchema} declares as non-nullable.
 *
 * @param kind - Discriminator for the value type this flag accepts.
 * @param overrides - Schema fields shallow-merged onto the defaults.
 * @returns A fully populated {@link FlagSchema}.
 */
function buildFlagSchema<K extends FlagKind>(
	kind: K,
	overrides?: FlagSchemaFieldOverrides,
): FlagSchema<K> {
	const aliases =
		overrides?.aliases !== undefined ? normalizeFlagAliases(overrides.aliases) : ([] as const);
	const {
		aliases: _ignoredAliases,
		presence,
		unique,
		propagate,
		duplicates,
		...rest
	} = overrides ?? {};

	return {
		kind,
		presence: presence ?? 'optional',
		defaultValue: undefined,
		envVar: undefined,
		configPath: undefined,
		description: undefined,
		enumValues: undefined,
		numberConstraints: undefined,
		stringConstraints: undefined,
		elementSchema: undefined,
		separator: undefined,
		unique: unique ?? false,
		pathChecks: undefined,
		valueHint: undefined,
		prompt: undefined,
		parseFn: undefined,
		standard: undefined,
		deprecated: undefined,
		propagate: propagate ?? false,
		negation: undefined,
		duplicates: duplicates ?? 'last',
		...rest,
		aliases,
	} as FlagSchema<K>;
}

/**
 * Create a raw {@link FlagSchema} object with sensible defaults.
 *
 * Most consumers should prefer the higher-level {@link flag} factory, which
 * returns an immutable {@link FlagBuilder} with type inference and safe
 * modifier chaining. `createFlagSchema()` is the low-level escape hatch for
 * advanced schema composition, tests, or custom factories that need the plain
 * runtime descriptor.
 *
 * Fields are shallow-merged on top of the default shape, so callers are
 * responsible for keeping the resulting schema internally consistent.
 *
 * @param kind - Discriminator for the value type this flag accepts.
 * @param overrides - Definition fields for `kind`, shallow-merged onto defaults.
 * @returns A fully populated {@link FlagSchema}.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` when a field belongs to a
 *   different {@link FlagKind}.
 *
 * @example
 * ```ts
 * const schema = createFlagSchema('enum', {
 *   enumValues: ['us', 'eu', 'ap'],
 *   description: 'Deployment region',
 * });
 * ```
 */
function createFlagSchema<K extends FlagKind>(
	kind: K,
	...args: FlagDefinitionArguments<K>
): FlagSchema<K>;
/**
 * Create a raw {@link FlagSchema} object from a single definition object.
 *
 * An already-built {@link FlagSchema} is accepted and re-normalized into a
 * deep-equal schema.
 *
 * @param definition - Kind discriminator plus the fields valid for that kind.
 * @returns A fully populated {@link FlagSchema}.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` when a field belongs to a
 *   different {@link FlagKind}.
 *
 * @example
 * ```ts
 * const schema = createFlagSchema({
 *   kind: 'array',
 *   elementSchema: { kind: 'string' },
 *   separator: ',',
 * });
 * ```
 */
function createFlagSchema<K extends FlagKind>(
	definition: FlagDefinition<K> | FlagSchema<K>,
): FlagSchema<K>;
function createFlagSchema(
	kindOrDefinition: FlagKind | FlagDefinition | FlagSchema,
	overrides?: FlagDefinitionFields,
): FlagSchema {
	if (typeof kindOrDefinition === 'string') {
		const fields = overrides ?? {};
		assertValidFlagDefinition(kindOrDefinition, fields);
		return buildFlagSchema(kindOrDefinition, normalizeFlagDefinitionFields(fields));
	}

	const { kind, ...fields } = kindOrDefinition;
	assertValidFlagDefinition(kind, fields);
	return buildFlagSchema(kind, normalizeFlagDefinitionFields(fields));
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
	alias(name: string, options?: { hidden?: boolean }): FlagBuilder<WithoutElementEligibility<C>> {
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
	env(varName: string): FlagBuilder<WithoutElementEligibility<C>> {
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
	config(path: string): FlagBuilder<WithoutElementEligibility<C>> {
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
	describe(description: string): FlagBuilder<WithoutElementEligibility<C>> {
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
	prompt(config: AllowedPromptConfig<C>): FlagBuilder<WithoutElementEligibility<C>> {
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
	deprecated(message?: string): FlagBuilder<WithoutElementEligibility<C>> {
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
	propagate(): FlagBuilder<WithoutElementEligibility<C>> {
		return new FlagBuilder({
			...this.schema,
			propagate: true,
		});
	}

	// -- Numeric constraint modifiers ----------------------------------------
	//
	// Compile-time guarded via a `this` parameter so they are only callable on
	// number-kind builders. They merge onto the single `numberConstraints`
	// representation, overriding any value set by `flag.number({ … })`.

	/**
	 * Require an integer value. Composes with other numeric constraints.
	 *
	 * @param value - Whether to require an integer.
	 * @defaultValue `true`
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.number().int()         // rejects 3.7, accepts 3
	 * flag.number({ int: true }).int(false) // re-allows non-integers
	 * ```
	 */
	int(this: FlagBuilder<C & { readonly flagKind: 'number' }>, value = true): FlagBuilder<C> {
		return new FlagBuilder({
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
	 * flag.number().min(0)              // rejects -1, accepts 0
	 * flag.number({ min: 0 }).min(5)    // effective min is 5
	 * ```
	 */
	min(this: FlagBuilder<C & { readonly flagKind: 'number' }>, value: number): FlagBuilder<C> {
		const numberConstraints = { ...this.schema.numberConstraints, min: value };
		assertNumberConstraints(numberConstraints);
		return new FlagBuilder({ ...this.schema, numberConstraints });
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
	 * flag.number().max(100)            // rejects 101, accepts 100
	 * ```
	 */
	max(this: FlagBuilder<C & { readonly flagKind: 'number' }>, value: number): FlagBuilder<C> {
		const numberConstraints = { ...this.schema.numberConstraints, max: value };
		assertNumberConstraints(numberConstraints);
		return new FlagBuilder({ ...this.schema, numberConstraints });
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
	 * flag.number().finite(false) // accepts Infinity
	 * ```
	 */
	finite(this: FlagBuilder<C & { readonly flagKind: 'number' }>, allow = true): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			numberConstraints: { ...this.schema.numberConstraints, finite: allow },
		});
	}

	// -- String constraint modifiers -------------------------------------------
	//
	// Compile-time guarded via a `this` parameter so they are only callable on
	// string-kind builders. They merge onto the single `stringConstraints`
	// representation, overriding any value set by `flag.string({ … })`.

	/**
	 * Reject empty strings. Composes with other string constraints.
	 *
	 * @param value - Whether to reject empty strings.
	 * @defaultValue `true`
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.string().nonEmpty()   // rejects '', accepts 'x'
	 * ```
	 */
	nonEmpty(this: FlagBuilder<C & { readonly flagKind: 'string' }>, value = true): FlagBuilder<C> {
		return new FlagBuilder({
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
	 * flag.string().minLength(3)   // rejects 'ab', accepts 'abc'
	 * ```
	 */
	minLength(this: FlagBuilder<C & { readonly flagKind: 'string' }>, value: number): FlagBuilder<C> {
		const stringConstraints = { ...this.schema.stringConstraints, minLength: value };
		assertStringConstraints(stringConstraints);
		return new FlagBuilder({ ...this.schema, stringConstraints });
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
	 * flag.string().maxLength(8)   // rejects 9+ chars
	 * ```
	 */
	maxLength(this: FlagBuilder<C & { readonly flagKind: 'string' }>, value: number): FlagBuilder<C> {
		const stringConstraints = { ...this.schema.stringConstraints, maxLength: value };
		assertStringConstraints(stringConstraints);
		return new FlagBuilder({ ...this.schema, stringConstraints });
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
	 * flag.string().pattern(/^ghp_/)   // rejects 'abc', accepts 'ghp_x'
	 * ```
	 */
	pattern(this: FlagBuilder<C & { readonly flagKind: 'string' }>, value: RegExp): FlagBuilder<C> {
		return new FlagBuilder({
			...this.schema,
			stringConstraints: { ...this.schema.stringConstraints, pattern: value },
		});
	}

	// -- Array modifiers -------------------------------------------------------

	/**
	 * Split each CLI occurrence on a separator before element coercion, so
	 * `--tag a,b --tag c` resolves to `['a', 'b', 'c']`. Elements are coerced
	 * (and rejected) individually with the element schema's own error format.
	 *
	 * Env and config string values are split on the same separator (their
	 * default split is `','` even without this modifier).
	 *
	 * @param value - Separator string (e.g. `','`).
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.array(flag.enum(['us', 'eu', 'ap'])).separator(',')
	 * // --region us,eu --region ap → ['us', 'eu', 'ap']
	 * ```
	 */
	separator(this: FlagBuilder<C & { readonly flagKind: 'array' }>, value: string): FlagBuilder<C> {
		if (value.length === 0) {
			throw new RangeError('array separator must not be empty');
		}
		return new FlagBuilder({ ...this.schema, separator: value });
	}

	/**
	 * Deduplicate the resolved array, preserving first-seen order. Applied
	 * after all sources resolve, using `SameValueZero` semantics (like `Set`).
	 *
	 * @param value - Whether to deduplicate.
	 * @defaultValue `true`
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.array(flag.string()).separator(',').unique()
	 * // --tag a,a --tag a → ['a']
	 * ```
	 */
	unique(this: FlagBuilder<C & { readonly flagKind: 'array' }>, value = true): FlagBuilder<C> {
		return new FlagBuilder({ ...this.schema, unique: value });
	}

	// -- Boolean modifiers -----------------------------------------------------

	/**
	 * Accept a negated spelling (`--no-<name>`) that sets the flag to `false`.
	 *
	 * Both spellings are ONE logical flag: the last CLI occurrence wins across
	 * them, and they share the duplicate policy. The negated spelling is
	 * presence-only — `--no-<name>=true` is rejected. Help renders the flag as
	 * `--[no-]<name>` (or lists a custom alias); env/config/prompt/default
	 * resolution is unaffected.
	 *
	 * @param options - Optional custom spelling (`alias`, without `--`) and
	 *   `hidden` to keep the negated spelling parseable but unadvertised.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.boolean().default(true).negatable()
	 * // $ mycli build --no-sandbox → sandbox = false
	 * // $ mycli build --sandbox    → sandbox = true
	 * ```
	 */
	negatable(
		this: FlagBuilder<C & { readonly flagKind: 'boolean' }>,
		options?: { alias?: string; hidden?: boolean },
	): FlagBuilder<WithoutElementEligibility<C>> {
		return new FlagBuilder({
			...this.schema,
			negation: { alias: options?.alias, hidden: options?.hidden ?? false },
		});
	}

	// -- Occurrence modifiers --------------------------------------------------

	/**
	 * Set how repeated CLI occurrences of this flag combine.
	 *
	 * Counted per logical flag — aliases and the negated spelling all count
	 * toward the same flag. CLI tokens only: env/config/prompt/default
	 * resolution keeps its precedence semantics. Not available on `array`,
	 * `count`, or `keyValue` flags, which inherently accumulate.
	 *
	 * @param policy - `'last'` (default), `'first'`, or `'error'`.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * flag.enum(['session', 'same-dir', 'worktree']).duplicates('error')
	 * // $ mycli run --spawn session --spawn worktree
	 * // #   → Error: Flag --spawn may only be specified once
	 * ```
	 */
	duplicates(
		this: FlagBuilder<
			C & { readonly flagKind: 'boolean' | 'string' | 'number' | 'enum' | 'custom' }
		>,
		policy: DuplicatePolicy,
	): FlagBuilder<WithoutElementEligibility<C>> {
		return new FlagBuilder({ ...this.schema, duplicates: policy });
	}
}

// --- Factory namespace

/**
 * Factory that creates {@link FlagBuilder} instances seeded with the correct
 * {@link FlagKind} and initial type-level config.
 */
interface FlagFactory {
	/**
	 * String-valued flag, with optional string constraints.
	 *
	 * Constraints are enforced at the parse and resolution boundaries, in
	 * fixed order: nonEmpty → minLength → maxLength → pattern. They also
	 * compose via chained methods (`.nonEmpty()`, `.minLength()`,
	 * `.maxLength()`, `.pattern()`), which override values set here.
	 *
	 * @param constraints - Optional string constraints.
	 * @defaultValue `undefined` (no constraints)
	 * @returns A {@link FlagBuilder} for `string` values.
	 *
	 * @example
	 * ```ts
	 * flag.string()                              // any string
	 * flag.string({ nonEmpty: true })            // rejects ''
	 * flag.string({ pattern: /^ghp_/ })          // token shapes
	 * ```
	 */
	string(constraints?: StringConstraints): FlagBuilder<{
		readonly valueType: string;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'string';
		readonly elementEligible: true;
	}>;

	/**
	 * Number-valued flag, with optional numeric constraints.
	 *
	 * Constraints are enforced at the parse and resolution boundaries. The
	 * resolved value type stays `number` — constraints are runtime + schema, not
	 * type-level. Bounds are inclusive.
	 *
	 * Constraints also compose via chained methods (`.int()`, `.min()`,
	 * `.max()`, `.finite()`), which override values set here.
	 *
	 * @param constraints - Optional numeric constraints. `finite` defaults to
	 *   `true`, so `Infinity` / `-Infinity` are rejected unless `finite: false`.
	 * @defaultValue `undefined` (finite-only, no bounds, non-integer allowed)
	 * @returns A {@link FlagBuilder} for `number` values.
	 *
	 * @example
	 * ```ts
	 * flag.number()                       // finite numbers only
	 * flag.number({ int: true, min: 0 })  // non-negative integers
	 * flag.number({ finite: false })      // also accepts Infinity
	 * ```
	 */
	number(constraints?: NumberConstraints): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'number';
		readonly elementEligible: true;
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
		readonly flagKind: 'boolean';
		readonly elementEligible: true;
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
		readonly flagKind: 'enum';
		readonly elementEligible: true;
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
	array<E extends FlagConfig & { readonly elementEligible: true }>(
		element: FlagBuilder<E>,
	): FlagBuilder<{
		readonly valueType: E['valueType'][];
		readonly presence: 'optional';
		readonly optionalFallback: 'empty-array';
		readonly flagKind: 'array';
		readonly elementEligible: false;
	}>;

	/**
	 * Custom flag validated by a Standard Schema v1 validator (zod, valibot,
	 * arktype, …). The resolved value from any source is validated after
	 * resolution; the flag's value type is the validator's output type.
	 *
	 * Sync and async validators are both supported. Validation issues surface
	 * as a `CONSTRAINT_VIOLATED` error naming the flag.
	 *
	 * @example
	 * ```ts
	 * import { z } from 'zod';
	 * flag.custom(z.string().url())
	 * // inferred type: string | undefined
	 * ```
	 *
	 * @param schema - A Standard Schema v1 validator.
	 * @returns A {@link FlagBuilder} whose value type is the validator's output.
	 */
	custom<S extends StandardSchemaV1>(
		schema: S,
	): FlagBuilder<{
		readonly valueType: InferStandardOutput<S>;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
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
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}>;

	/**
	 * URL-valued flag. Parses into a `URL`; invalid URLs are rejected with an
	 * `INVALID_VALUE` error naming the flag.
	 *
	 * @param options - Optional protocol allowlist (without trailing colon).
	 * @returns A {@link FlagBuilder} for `URL` values.
	 *
	 * @example
	 * ```ts
	 * flag.url()                            // any URL
	 * flag.url({ protocols: ['https'] })    // https only
	 * ```
	 */
	url(options?: UrlFlagOptions): FlagBuilder<{
		readonly valueType: URL;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}>;

	/**
	 * Path-valued flag. The value stays a `string`; optional filesystem
	 * checks run **after resolution** through the runtime adapter, so CLI,
	 * env, config, prompted, and defaulted values are all validated.
	 *
	 * @param options - Optional existence/type checks. `type` implies
	 *   existence unless `mustExist` is explicitly `false`.
	 * @returns A {@link FlagBuilder} for path strings.
	 *
	 * @example
	 * ```ts
	 * flag.path()                          // any string, help shows <path>
	 * flag.path({ mustExist: true })       // rejects missing paths
	 * flag.path({ type: 'directory' })     // must exist and be a directory
	 * flag.path({ type: 'directory', mustExist: false })
	 *                                      // missing passes; existing must be a directory
	 * flag.path({ type: 'directory', create: true })
	 *                                      // created recursively when missing
	 * ```
	 */
	path(options?: PathFlagOptions): FlagBuilder<{
		readonly valueType: string;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'string';
		readonly elementEligible: false;
	}>;

	/**
	 * Date-valued flag. Accepts strict ISO-8601 (`2026-07-10`,
	 * `2026-07-10T14:30:00Z`) and parses into a `Date`. Lenient `Date.parse`
	 * inputs (`'0'`, `'March 5'`) and calendar-invalid dates (`2026-02-31`)
	 * are rejected.
	 *
	 * Returns `Date` (not `Temporal`) because the supported runtimes do not
	 * all ship Temporal yet; use `flag.custom()` with `Temporal.PlainDate.from`
	 * where the target runtime has it.
	 *
	 * @param options - Optional inclusive `min`/`max` date bounds.
	 * @returns A {@link FlagBuilder} for `Date` values.
	 *
	 * @example
	 * ```ts
	 * flag.date()
	 * flag.date({ min: new Date('2020-01-01') })
	 * ```
	 */
	date(options?: DateFlagOptions): FlagBuilder<{
		readonly valueType: Date;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}>;

	/**
	 * Duration flag. Accepts `'30s'`, `'5m'`, `'1.5h'`, `'250ms'`, `'2d'`,
	 * compounds like `'1h30m'`, or a bare millisecond count, and resolves to
	 * **milliseconds**.
	 *
	 * @returns A {@link FlagBuilder} for duration values in milliseconds.
	 *
	 * @example
	 * ```ts
	 * flag.duration().default(30_000)   // --timeout 45s → 45000
	 * ```
	 */
	duration(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}>;

	/**
	 * Byte-size flag. Accepts `'512mb'`, `'1.5gb'`, `'64kb'`, `'100b'` or a
	 * bare byte count, and resolves to **bytes**. Units are binary
	 * (`1kb` = 1024) and case-insensitive.
	 *
	 * @returns A {@link FlagBuilder} for sizes in bytes.
	 *
	 * @example
	 * ```ts
	 * flag.bytes().default(10 * 1024 ** 2)   // --max-size 512kb → 524288
	 * ```
	 */
	bytes(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}>;

	/**
	 * Count flag — resolves to how many times the flag appears. `-vvv`,
	 * `-v -v -v`, and `--verbose --verbose --verbose` all yield `3`; absent
	 * yields `0`. An explicit value (`--verbose=2`, env, config) sets the
	 * count directly.
	 *
	 * Not promptable.
	 *
	 * @returns A {@link FlagBuilder} for occurrence counts (defaulted to `0`).
	 *
	 * @example
	 * ```ts
	 * flag.count().alias('v').describe('Increase verbosity')
	 * // $ mycli build -vv → verbose = 2
	 * ```
	 */
	count(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'defaulted';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'count';
		readonly elementEligible: false;
	}>;

	/**
	 * Key-value flag — repeated `KEY=VALUE` occurrences merge into a
	 * `Record<string, string>` (docker/kubectl `--env` style). The value is
	 * split at the **first** `=`, so `--env A=b=c` yields `{ A: 'b=c' }`.
	 * Later occurrences of the same key win. Absent resolves to `{}`.
	 *
	 * Env vars accept separator-joined pairs (`A=1,B=2`); config files accept
	 * a plain object. Not promptable.
	 *
	 * @returns A {@link FlagBuilder} for `Record<string, string>` values.
	 *
	 * @example
	 * ```ts
	 * flag.keyValue().alias('e').describe('Environment variables')
	 * // $ mycli run -e A=1 -e B=2 → env = { A: '1', B: '2' }
	 * ```
	 */
	keyValue(): FlagBuilder<{
		readonly valueType: Record<string, string>;
		readonly presence: 'optional';
		readonly optionalFallback: 'empty-object';
		readonly flagKind: 'keyValue';
		readonly elementEligible: false;
	}>;
}

/**
 * Flag schema factory. Call `flag.<kind>()` to create an immutable
 * {@link FlagBuilder} with full type inference and safe modifier chaining.
 */
const flag: FlagFactory = {
	string(constraints?: StringConstraints): FlagBuilder<{
		readonly valueType: string;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'string';
		readonly elementEligible: true;
	}> {
		if (constraints !== undefined) {
			assertStringConstraints(constraints);
		}
		return new FlagBuilder(
			createFlagSchema(
				'string',
				constraints !== undefined ? { stringConstraints: constraints } : {},
			),
		);
	},

	number(constraints?: NumberConstraints): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'number';
		readonly elementEligible: true;
	}> {
		if (constraints !== undefined) {
			assertNumberConstraints(constraints);
		}
		return new FlagBuilder(
			createFlagSchema(
				'number',
				constraints !== undefined ? { numberConstraints: constraints } : {},
			),
		);
	},

	boolean(): FlagBuilder<{
		readonly valueType: boolean;
		readonly presence: 'defaulted';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'boolean';
		readonly elementEligible: true;
	}> {
		return new FlagBuilder(
			createFlagSchema('boolean', {
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
		readonly flagKind: 'enum';
		readonly elementEligible: true;
	}> {
		return new FlagBuilder(createFlagSchema('enum', { enumValues: values }));
	},

	array<E extends FlagConfig & { readonly elementEligible: true }>(
		element: FlagBuilder<E>,
	): FlagBuilder<{
		readonly valueType: E['valueType'][];
		readonly presence: 'optional';
		readonly optionalFallback: 'empty-array';
		readonly flagKind: 'array';
		readonly elementEligible: false;
	}> {
		return new FlagBuilder(createFlagSchema('array', { elementSchema: element.schema }));
	},

	custom<A extends FlagParseFn<unknown> | StandardSchemaV1>(
		parseFnOrSchema: A,
	): FlagBuilder<{
		readonly valueType: CustomFlagValue<A>;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}> {
		if (isStandardSchemaV1(parseFnOrSchema)) {
			return new FlagBuilder(createFlagSchema('custom', { standard: parseFnOrSchema }));
		}
		return new FlagBuilder(createFlagSchema('custom', { parseFn: parseFnOrSchema }));
	},

	url(options?: UrlFlagOptions): FlagBuilder<{
		readonly valueType: URL;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}> {
		return new FlagBuilder(
			createFlagSchema('custom', {
				parseFn: (raw: unknown) => parseUrlValue(raw, options),
				valueHint: 'url',
			}),
		);
	},

	path(options?: PathFlagOptions): FlagBuilder<{
		readonly valueType: string;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'string';
		readonly elementEligible: false;
	}> {
		return new FlagBuilder(
			createFlagSchema('string', { pathChecks: buildPathChecks(options), valueHint: 'path' }),
		);
	},

	date(options?: DateFlagOptions): FlagBuilder<{
		readonly valueType: Date;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}> {
		return new FlagBuilder(
			createFlagSchema('custom', {
				parseFn: (raw: unknown) => parseDateValue(raw, options),
				valueHint: 'date',
			}),
		);
	},

	duration(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}> {
		return new FlagBuilder(
			createFlagSchema('custom', { parseFn: parseDurationValue, valueHint: 'duration' }),
		);
	},

	bytes(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'optional';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'custom';
		readonly elementEligible: true;
	}> {
		return new FlagBuilder(
			createFlagSchema('custom', { parseFn: parseBytesValue, valueHint: 'size' }),
		);
	},

	count(): FlagBuilder<{
		readonly valueType: number;
		readonly presence: 'defaulted';
		readonly optionalFallback: 'undefined';
		readonly flagKind: 'count';
		readonly elementEligible: false;
	}> {
		return new FlagBuilder(
			createFlagSchema('count', {
				presence: 'defaulted',
				defaultValue: 0,
			}),
		);
	},

	keyValue(): FlagBuilder<{
		readonly valueType: Record<string, string>;
		readonly presence: 'optional';
		readonly optionalFallback: 'empty-object';
		readonly flagKind: 'keyValue';
		readonly elementEligible: false;
	}> {
		return new FlagBuilder(createFlagSchema('keyValue', { valueHint: 'key=value' }));
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
export type { StringConstraints, StringConstraintViolation } from './string-constraints.ts';
export type {
	DateFlagOptions,
	PathChecks,
	PathFlagOptions,
	UrlFlagOptions,
} from './value-parsers.ts';
export type {
	AllowedPromptConfig,
	ArrayFlagDefinition,
	BooleanFlagDefinition,
	CountFlagDefinition,
	CustomFlagDefinition,
	DuplicatePolicy,
	EnumFlagDefinition,
	FlagAlias,
	FlagConfig,
	FlagDefinition,
	FlagDefinitionBase,
	FlagDefinitionByKind,
	FlagDefinitionOverrides,
	FlagFactory,
	FlagKind,
	FlagNegation,
	FlagParseFn,
	FlagPresence,
	FlagSchema,
	InferFlag,
	InferFlags,
	KeyValueFlagDefinition,
	NumberFlagDefinition,
	OptionalFallback,
	PromptConfigByFlagKind,
	ResolvedValue,
	StringFlagDefinition,
	WithoutElementEligibility,
	WithPresence,
};
export {
	createFlagSchema,
	FLAG_KINDS,
	FLAG_PRESENCES,
	FlagBuilder,
	flag,
	getFlagAliasNames,
	getFlagNegatedName,
	normalizeFlagAlias,
	normalizeFlagAliases,
};
