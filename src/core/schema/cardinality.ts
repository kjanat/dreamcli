/**
 * The cardinality axis shared by the `flag` and `arg` factories.
 *
 * A {@link Cardinality} says how many values an input carries and how they
 * combine: one value, many values, key/value entries, or an occurrence count.
 * `flag.array()`, `flag.keyValue()`, `flag.count()`, `arg.keyValue()`, and
 * `.variadic()` all normalize onto it, and the parse and resolve pipelines
 * dispatch on {@link flagCardinality} / {@link argCardinality} rather than on
 * the kind discriminator.
 *
 * Splitting is per source. {@link SplitBinding} carries one {@link SplitPolicy}
 * for CLI tokens, one for environment values, and one for the stdin buffer, so
 * a CLI separator no longer decides how an env var or a pipe decodes.
 *
 * @module dreamcli/core/schema/cardinality
 * @internal
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { ArgSchema } from './arg.ts';
import type { FlagSchema } from './flag.ts';
import type { StandardSchemaV1 } from './standard.ts';
import type { ValueFailure, ValueSchema } from './value.ts';
import { describeValueFailure, validateDecodedValue } from './value.ts';

// --- Splitting

/** All split formats as a runtime array. */
const SPLIT_FORMATS = ['whole', 'delimiter', 'lines', 'json'] as const;

/** How one source's text decodes into collection elements. */
type SplitFormat = (typeof SPLIT_FORMATS)[number];

/**
 * How one source's text decodes into collection elements.
 *
 * - `'whole'`: the source value is a single element
 * - `'delimiter'`: split on a literal delimiter, dropping empty segments
 * - `'lines'`: split on `\n`, `\r\n`, or `\r`
 * - `'json'`: parse the text as JSON
 */
type SplitPolicy =
	| { readonly format: 'whole' }
	| { readonly format: 'delimiter'; readonly delimiter: string }
	| { readonly format: 'lines' }
	| { readonly format: 'json' };

/**
 * A split policy, a format name, or a literal delimiter.
 *
 * The strings `'whole'`, `'lines'`, and `'json'` name their format; every other
 * string is the delimiter to split on, so `','` is the comma policy.
 */
type SplitSetting = string | SplitPolicy;

/**
 * Per-source split settings accepted by `.split()`.
 *
 * Config values are native arrays and objects; a config string decodes under
 * the `env` policy.
 */
interface SplitOptions {
	/**
	 * How each CLI token splits. Accepts `'whole'` and a delimiter.
	 * @defaultValue `'whole'`, or the delimiter set by `.separator()`
	 */
	readonly cli?: SplitSetting | undefined;
	/**
	 * How an environment value splits. Accepts `'whole'`, `'json'`, and a delimiter.
	 * @defaultValue `{ format: 'delimiter', delimiter: ',' }`
	 */
	readonly env?: SplitSetting | undefined;
	/**
	 * How the stdin buffer splits. Accepts every format.
	 * @defaultValue `'lines'`
	 */
	readonly stdin?: SplitSetting | undefined;
}

/**
 * The non-CLI split policies a schema stores.
 *
 * The CLI delimiter lives on the `separator` field both schemas already carry,
 * so `.separator(',')` and `.split({ cli: ',' })` write the same place.
 */
interface SourceSplitBinding {
	/** Environment split policy, or `undefined` for the default. */
	readonly env: SplitPolicy | undefined;
	/** Stdin split policy, or `undefined` for the default. */
	readonly stdin: SplitPolicy | undefined;
}

/** The resolved split policy of every source. */
interface SplitBinding {
	/** How each CLI token splits. */
	readonly cli: SplitPolicy;
	/** How an environment value splits. */
	readonly env: SplitPolicy;
	/** How the stdin buffer splits. */
	readonly stdin: SplitPolicy;
}

/** The whole-value policy, shared by every source that declares none. */
const WHOLE: SplitPolicy = { format: 'whole' };

/** The line policy stdin collections take by default. */
const LINES: SplitPolicy = { format: 'lines' };

/** The comma policy environment collections take by default. */
const ENV_DEFAULT: SplitPolicy = { format: 'delimiter', delimiter: ',' };

/** The JSON policy, named by the bare string `'json'`. */
const JSON_POLICY: SplitPolicy = { format: 'json' };

/** The formats a bare string names, none of which carry a delimiter. */
const NAMED_SPLIT_POLICIES: Readonly<Record<string, SplitPolicy>> = {
	whole: WHOLE,
	lines: LINES,
	json: JSON_POLICY,
};

/** Which formats each source accepts. */
const ALLOWED_SPLIT_FORMATS: Readonly<Record<keyof SplitOptions, readonly SplitFormat[]>> = {
	cli: ['whole', 'delimiter'],
	env: ['whole', 'delimiter', 'json'],
	stdin: ['whole', 'delimiter', 'lines', 'json'],
};

/**
 * Read a bare string as the format it names, or as the delimiter to split on.
 *
 * @param setting - The string a caller passed for one source.
 * @returns The policy the string stands for.
 */
function splitPolicyFromString(setting: string): SplitPolicy {
	// Own-key read: a setting spelling an Object.prototype member would
	// otherwise resolve to that inherited method.
	return Object.hasOwn(NAMED_SPLIT_POLICIES, setting)
		? (NAMED_SPLIT_POLICIES[setting] ?? WHOLE)
		: { format: 'delimiter', delimiter: setting };
}

/**
 * Normalize one source's split setting.
 *
 * @param source - Which source the setting belongs to.
 * @param setting - The policy, a format name, or a delimiter.
 * @returns The normalized policy.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` on a format the source does
 *   not accept, or an empty delimiter.
 */
function normalizeSplitPolicy(source: keyof SplitOptions, setting: SplitSetting): SplitPolicy {
	const policy: SplitPolicy =
		typeof setting === 'string' ? splitPolicyFromString(setting) : setting;
	const allowed = ALLOWED_SPLIT_FORMATS[source];

	if (!allowed.includes(policy.format)) {
		throw new CLIError(`Split format '${String(policy.format)}' is not available for ${source}`, {
			code: 'INVALID_SCHEMA',
			details: { source, format: policy.format, allowed: [...allowed] },
			suggest: `Use one of: ${allowed.filter((format) => format !== 'delimiter').join(', ')}, or a delimiter string`,
		});
	}

	if (policy.format === 'delimiter' && policy.delimiter.length === 0) {
		throw new CLIError(`Split delimiter for ${source} must not be empty`, {
			code: 'INVALID_SCHEMA',
			details: { source, format: policy.format },
			suggest: "Pass a non-empty delimiter, for example ','",
		});
	}

	return policy;
}

/** One source's split setting, split into the CLI carrier and the rest. */
interface NormalizedSplitOptions {
	/** The CLI delimiter, or `undefined` when CLI tokens stay whole. */
	readonly separator: string | undefined;
	/** Whether the options named the CLI source at all. */
	readonly setsSeparator: boolean;
	/** The stored non-CLI policies. */
	readonly split: SourceSplitBinding | undefined;
}

/**
 * Normalize `.split()` options into the fields a schema stores.
 *
 * A source the options leave out keeps the policy already stored, so successive
 * `.split()` calls each set one source instead of clearing the others.
 *
 * @param options - Per-source split settings.
 * @param stored - The binding already on the schema, when there is one.
 * @returns The CLI delimiter and the stored non-CLI binding.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` on a format a source does not
 *   accept, or an empty delimiter.
 */
function normalizeSplitOptions(
	options: SplitOptions,
	stored?: SourceSplitBinding | undefined,
): NormalizedSplitOptions {
	const cli = options.cli === undefined ? undefined : normalizeSplitPolicy('cli', options.cli);
	const env = options.env === undefined ? stored?.env : normalizeSplitPolicy('env', options.env);
	const stdin =
		options.stdin === undefined ? stored?.stdin : normalizeSplitPolicy('stdin', options.stdin);

	return {
		separator: cli !== undefined && cli.format === 'delimiter' ? cli.delimiter : undefined,
		setsSeparator: cli !== undefined,
		split: env === undefined && stdin === undefined ? undefined : { env, stdin },
	};
}

/**
 * Resolve the split policy of every source from the stored fields.
 *
 * @param separator - The CLI delimiter carrier.
 * @param split - The stored non-CLI policies.
 * @returns One policy per source, defaults filled in.
 */
function splitBindingOf(
	separator: string | undefined,
	split: SourceSplitBinding | undefined,
): SplitBinding {
	return {
		cli: separator === undefined ? WHOLE : { format: 'delimiter', delimiter: separator },
		env: split?.env ?? ENV_DEFAULT,
		stdin: split?.stdin ?? LINES,
	};
}

// --- Cardinality

/** All duplicate-key policies as a runtime array. */
const DUPLICATE_KEYS = ['first', 'last', 'error'] as const;

/**
 * How a repeated key combines when entries aggregate.
 *
 * - `'last'`: the later occurrence wins
 * - `'first'`: the earlier occurrence wins
 * - `'error'`: a repeat is a validation failure
 *
 * @defaultValue `'last'`
 */
type DuplicateKeys = (typeof DUPLICATE_KEYS)[number];

/**
 * How many values an input carries and how they combine.
 *
 * `'one'` is a single value; `'many'` an ordered array; `'entries'` a key/value
 * record; `'count'` the number of CLI occurrences.
 */
type Cardinality =
	| { readonly kind: 'one' }
	| { readonly kind: 'many'; readonly unique: boolean; readonly splitting: SplitBinding }
	| {
			readonly kind: 'entries';
			readonly duplicateKeys: DuplicateKeys;
			readonly splitting: SplitBinding;
	  }
	| { readonly kind: 'count' };

/** The single-value cardinality, shared by every scalar input. */
const ONE: Cardinality = { kind: 'one' };

/** The occurrence-count cardinality. */
const COUNT: Cardinality = { kind: 'count' };

/**
 * Project a flag schema onto its cardinality axis.
 *
 * @param schema - The flag schema to read.
 * @returns How the flag's values combine.
 */
function flagCardinality(schema: FlagSchema): Cardinality {
	switch (schema.kind) {
		case 'array':
			return {
				kind: 'many',
				unique: schema.unique,
				splitting: splitBindingOf(schema.separator, schema.split),
			};
		case 'keyValue':
			return {
				kind: 'entries',
				duplicateKeys: schema.duplicateKeys,
				splitting: splitBindingOf(schema.separator, schema.split),
			};
		case 'count':
			return COUNT;
		case 'string':
		case 'number':
		case 'boolean':
		case 'enum':
		case 'custom':
			return ONE;
	}
}

/**
 * Project an arg schema onto its cardinality axis.
 *
 * A `keyValue` arg aggregates entries whether or not it is variadic: the
 * non-variadic form reads one `k=v` token, the variadic form the whole tail.
 *
 * @param schema - The arg schema to read.
 * @returns How the arg's values combine.
 */
function argCardinality(schema: ArgSchema): Cardinality {
	if (schema.kind === 'keyValue') {
		return {
			kind: 'entries',
			duplicateKeys: schema.duplicateKeys,
			splitting: splitBindingOf(schema.separator, schema.split),
		};
	}
	if (schema.variadic) {
		return {
			kind: 'many',
			unique: schema.unique,
			splitting: splitBindingOf(schema.separator, schema.split),
		};
	}
	return ONE;
}

/** Whether a cardinality aggregates several values. */
function isCollection(
	cardinality: Cardinality,
): cardinality is Extract<Cardinality, { readonly kind: 'many' | 'entries' }> {
	return cardinality.kind === 'many' || cardinality.kind === 'entries';
}

// --- Source decoding

/** Why a source's text could not be split into elements. */
type SplitFailure =
	| { readonly kind: 'json'; readonly error: unknown }
	| { readonly kind: 'json-shape'; readonly expected: 'array' | 'object' }
	| { readonly kind: 'pair'; readonly raw: string };

/** Elements read out of one source, or why the text was unreadable. */
type SplitResult<T> =
	| { readonly ok: true; readonly parts: readonly T[] }
	| { readonly ok: false; readonly failure: SplitFailure };

/**
 * Split text into the elements of a `many` collection.
 *
 * @param policy - The source's split policy.
 * @param text - The raw source text.
 * @returns The elements, or why the text was unreadable.
 */
function splitManyText(policy: SplitPolicy, text: string): SplitResult<unknown> {
	switch (policy.format) {
		case 'whole':
			return { ok: true, parts: text.length === 0 ? [] : [text] };
		case 'delimiter':
			return { ok: true, parts: splitDelimited(text, policy.delimiter) };
		case 'lines':
			return { ok: true, parts: splitLines(text) };
		case 'json': {
			const parsed = parseJson(text);
			if (!parsed.ok) return parsed;
			if (!Array.isArray(parsed.value)) {
				return { ok: false, failure: { kind: 'json-shape', expected: 'array' } };
			}
			return { ok: true, parts: parsed.value };
		}
	}
}

/**
 * Split text into the pairs of an `entries` collection.
 *
 * Delimited and line-separated text carries `KEY=VALUE` segments split at the
 * first `=`; JSON text carries an object.
 *
 * @param policy - The source's split policy.
 * @param text - The raw source text.
 * @returns The pairs, or why the text was unreadable.
 */
function splitEntriesText(
	policy: SplitPolicy,
	text: string,
): SplitResult<readonly [string, unknown]> {
	if (policy.format === 'json') {
		const parsed = parseJson(text);
		if (!parsed.ok) return parsed;
		const record = parsed.value;
		if (typeof record !== 'object' || record === null || Array.isArray(record)) {
			return { ok: false, failure: { kind: 'json-shape', expected: 'object' } };
		}
		return { ok: true, parts: Object.entries(record) };
	}

	const segments =
		policy.format === 'whole'
			? text.length === 0
				? []
				: [text]
			: policy.format === 'lines'
				? splitLines(text)
				: splitDelimited(text, policy.delimiter);

	const pairs: (readonly [string, unknown])[] = [];
	for (const segment of segments) {
		const pair = splitEntryPair(segment);
		if (pair === undefined) {
			return { ok: false, failure: { kind: 'pair', raw: segment } };
		}
		pairs.push(pair);
	}
	return { ok: true, parts: pairs };
}

/**
 * Split one `KEY=VALUE` token at the first `=`.
 *
 * @param raw - The token to split.
 * @returns The pair, or `undefined` when the token has no `=` or an empty key.
 */
function splitEntryPair(raw: string): readonly [string, string] | undefined {
	const equals = raw.indexOf('=');
	if (equals <= 0) return undefined;
	return [raw.slice(0, equals), raw.slice(equals + 1)];
}

/** Split on a literal delimiter, dropping empty segments. */
function splitDelimited(text: string, delimiter: string): readonly string[] {
	return text.split(delimiter).filter((part) => part.length > 0);
}

/**
 * Split text on line terminators.
 *
 * A final terminator frames the last line rather than starting an empty one, so
 * the single empty element it produces is removed and genuine blank lines
 * survive: `'a\nb\n'` gives `['a', 'b']` and `'a\nb\n\n'` gives `['a', 'b', '']`.
 *
 * @param text - The raw source text.
 * @returns One element per line.
 */
function splitLines(text: string): readonly string[] {
	if (text.length === 0) return [];
	const parts = text.split(/\r\n|\n|\r/);
	if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
	return parts;
}

/** Parse JSON text, reporting the thrown error rather than throwing it. */
function parseJson(
	text: string,
):
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly failure: SplitFailure } {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (error) {
		return { ok: false, failure: { kind: 'json', error } };
	}
}

// --- Aggregation

/** Deduplicate a resolved array, preserving first-seen order. */
function dedupe(values: readonly unknown[]): readonly unknown[] {
	return [...new Set(values)];
}

/** The record entries folded to, or the key a duplicate policy rejected. */
type FoldResult =
	| { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
	| { readonly ok: false; readonly duplicateKey: string };

/**
 * Fold ordered pairs into a record under a duplicate-key policy.
 *
 * `Object.fromEntries` defines own data properties, so a `'__proto__'` key is
 * stored verbatim instead of reaching the prototype setter.
 *
 * @param pairs - The pairs in occurrence order.
 * @param duplicateKeys - What a repeated key means.
 * @returns The record, or the key that repeated under `'error'`.
 */
function foldEntries(
	pairs: readonly (readonly [string, unknown])[],
	duplicateKeys: DuplicateKeys,
): FoldResult {
	const kept = new Map<string, unknown>();
	for (const [key, value] of pairs) {
		if (kept.has(key)) {
			if (duplicateKeys === 'error') return { ok: false, duplicateKey: key };
			if (duplicateKeys === 'first') continue;
		}
		kept.set(key, value);
	}
	return { ok: true, value: Object.fromEntries(kept) };
}

// --- Declared defaults

/** Why a declared default value is not a value the input could hold. */
type DefaultViolation =
	| { readonly kind: 'shape'; readonly expected: 'array' | 'object' | 'count' }
	| {
			readonly kind: 'element';
			readonly at: string | undefined;
			readonly value: unknown;
			readonly failure: ValueFailure;
	  }
	| {
			readonly kind: 'standard';
			readonly at: string | undefined;
			readonly value: unknown;
			readonly issues: readonly string[];
	  };

/**
 * Validate a declared default against the value and cardinality axes.
 *
 * A default is already the typed value, so it is validated rather than decoded.
 * Only synchronous verdicts are reachable here: a Standard Schema validator
 * that returns a promise is left to the resolution-time pass, as are filesystem
 * checks.
 *
 * @param element - The value axis of each element (of the value itself for `'one'`).
 * @param cardinality - How the input's values combine.
 * @param aggregate - Standard Schema validator applied to the completed collection.
 * @param value - The declared default.
 * @returns The violation, or `undefined` when the default is valid so far.
 */
function validateDefault(
	element: ValueSchema,
	cardinality: Cardinality,
	aggregate: StandardSchemaV1 | undefined,
	value: unknown,
): DefaultViolation | undefined {
	switch (cardinality.kind) {
		case 'one':
			return validateDefaultElement(element, undefined, value);
		case 'count':
			return typeof value === 'number' && Number.isInteger(value) && value >= 0
				? undefined
				: { kind: 'shape', expected: 'count' };
		case 'many': {
			if (!Array.isArray(value)) return { kind: 'shape', expected: 'array' };
			for (const [index, entry] of value.entries()) {
				const violation = validateDefaultElement(element, String(index), entry);
				if (violation !== undefined) return violation;
			}
			return validateDefaultStandard(aggregate, undefined, value);
		}
		case 'entries': {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				return { kind: 'shape', expected: 'object' };
			}
			for (const [key, entry] of Object.entries(value)) {
				const violation = validateDefaultElement(element, key, entry);
				if (violation !== undefined) return violation;
			}
			return validateDefaultStandard(aggregate, undefined, value);
		}
	}
}

/** Apply the element constraints and the element validator to one default entry. */
function validateDefaultElement(
	element: ValueSchema,
	at: string | undefined,
	value: unknown,
): DefaultViolation | undefined {
	const failure = validateDecodedValue(element, value);
	if (failure !== undefined) return { kind: 'element', at, value, failure };
	return validateDefaultStandard(element.standard, at, value);
}

/** Apply a validator whose verdict is available synchronously. */
function validateDefaultStandard(
	validator: StandardSchemaV1 | undefined,
	at: string | undefined,
	value: unknown,
): DefaultViolation | undefined {
	if (validator === undefined) return undefined;
	const result = validator['~standard'].validate(value);
	if (result instanceof Promise) return undefined;
	if (result.issues === undefined) return undefined;
	return { kind: 'standard', at, value, issues: result.issues.map((issue) => issue.message) };
}

/**
 * Build the construction-time error for a default value that cannot hold.
 *
 * @param subject - How the input is spelled, `--tag` or `<files>`.
 * @param details - Structured identification of the input.
 * @param violation - What the default failed.
 * @returns The error to throw.
 */
function defaultViolationError(
	subject: string,
	details: Readonly<Record<string, unknown>>,
	violation: DefaultViolation,
): CLIError {
	const at = 'at' in violation && violation.at !== undefined ? ` at ${violation.at}` : '';
	const reason = describeDefaultViolation(violation);
	return new CLIError(`Default value for ${subject}${at} is invalid: ${reason}`, {
		code: 'INVALID_DEFAULT',
		details: {
			...details,
			...(at === '' ? {} : { at: 'at' in violation ? violation.at : undefined }),
			reason,
		},
		suggest: `Change the default so it satisfies what ${subject} accepts`,
	});
}

/** State the reason a default was rejected. */
function describeDefaultViolation(violation: DefaultViolation): string {
	switch (violation.kind) {
		case 'shape':
			return violation.expected === 'count'
				? 'expected a non-negative integer'
				: `expected an ${violation.expected}`;
		case 'element':
			return describeValueFailure(violation.failure);
		case 'standard':
			return violation.issues.join('; ');
	}
}

export type {
	Cardinality,
	DefaultViolation,
	DuplicateKeys,
	FoldResult,
	NormalizedSplitOptions,
	SourceSplitBinding,
	SplitBinding,
	SplitFailure,
	SplitFormat,
	SplitOptions,
	SplitPolicy,
	SplitResult,
	SplitSetting,
};
export {
	argCardinality,
	DUPLICATE_KEYS,
	dedupe,
	defaultViolationError,
	flagCardinality,
	foldEntries,
	isCollection,
	normalizeSplitOptions,
	normalizeSplitPolicy,
	SPLIT_FORMATS,
	splitBindingOf,
	splitEntriesText,
	splitEntryPair,
	splitLines,
	splitManyText,
	validateDefault,
};
