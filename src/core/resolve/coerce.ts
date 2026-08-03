/**
 * Internal resolver coercion helpers.
 *
 * @module dreamcli/core/resolve/coerce
 * @internal
 */

import type { ValidationErrorCode } from '#internals/core/errors/index.ts';
import { ValidationError } from '#internals/core/errors/index.ts';
import type { Occurrence } from '#internals/core/parse/occurrences.ts';
import {
	entryPairsOf,
	liftOccurrences,
	occurrenceValue,
	readAggregated,
} from '#internals/core/parse/occurrences.ts';
import type {
	Cardinality,
	SplitBinding,
	SplitFailure,
	SplitPolicy,
} from '#internals/core/schema/cardinality.ts';
import {
	argCardinality,
	flagCardinality,
	foldEntries,
	splitEntriesText,
	splitManyText,
} from '#internals/core/schema/cardinality.ts';
import type {
	ArgSchema,
	FlagSchema,
	StringConstraintViolation,
} from '#internals/core/schema/index.ts';
import {
	describeNumberConstraintViolation,
	describeStringConstraintViolation,
	stringConstraintDetails,
} from '#internals/core/schema/index.ts';
import { stdinReadsOnDash } from '#internals/core/schema/stdin.ts';
import type {
	ValueFailure,
	ValueInput,
	ValueSchema,
	ValueTypeName,
} from '#internals/core/schema/value.ts';
import { argValueSchema, decodeValue, flagValueSchema } from '#internals/core/schema/value.ts';
import type { ArgDiagnosticSource, FlagDiagnosticSource } from './contracts.ts';

type CoerceSource = FlagDiagnosticSource;

/** Discriminated result of a value coercion attempt — success with the coerced value, or failure with a structured validation error. */
type CoerceResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError };

function sourceLabel(source: CoerceSource): string {
	switch (source.kind) {
		case 'stdin':
			return 'from stdin';
		case 'env':
			return `from env ${source.envVar}`;
		case 'config':
			return `from config ${source.configPath}`;
		case 'prompt':
			return 'from prompt';
	}
}

function sourceDetails(source: CoerceSource): Record<string, unknown> {
	switch (source.kind) {
		case 'stdin':
			return { source: 'stdin' };
		case 'env':
			return { envVar: source.envVar };
		case 'config':
			return { configPath: source.configPath };
		case 'prompt':
			return { source: 'prompt' };
	}
}

/** Where the caller must change the value, phrased for the source that produced it. */
function suggestBySource(
	source: CoerceSource,
	parts: {
		readonly stdin: string;
		readonly env: (envVar: string) => string;
		readonly config: (configPath: string) => string;
		readonly prompt: string;
	},
): string {
	switch (source.kind) {
		case 'stdin':
			return parts.stdin;
		case 'env':
			return parts.env(source.envVar);
		case 'config':
			return parts.config(source.configPath);
		case 'prompt':
			return parts.prompt;
	}
}

function coercionError(
	flagName: string,
	source: CoerceSource,
	code: ValidationErrorCode,
	expected: string,
	raw: unknown,
	messageSuffix: string,
	suggest: string,
	extraDetails?: Record<string, unknown>,
): ValidationError {
	return new ValidationError(`${messageSuffix} ${sourceLabel(source)} for flag --${flagName}`, {
		code,
		details: { flag: flagName, ...sourceDetails(source), value: raw, expected, ...extraDetails },
		suggest,
	});
}

/**
 * Coerce a raw value from stdin/env/config/prompt into what a flag declares.
 *
 * The cardinality axis decides how many values the source carries and how they
 * combine; the value axis decides what each one means.
 */
function coerceValue(
	flagName: string,
	source: CoerceSource,
	raw: unknown,
	schema: FlagSchema,
): CoerceResult {
	const cardinality = flagCardinality(schema);
	if (cardinality.kind === 'count') {
		return coerceCount(flagName, source, raw);
	}
	if (cardinality.kind === 'one') {
		return coerceValueSchema(flagName, source, raw, flagValueSchema(schema));
	}
	return coerceCollection(
		cardinality,
		source,
		raw,
		(element) => coerceValueSchema(flagName, source, element, flagValueSchema(schema)),
		flagCollectionErrors(flagName, source),
	);
}

/** Read a raw value as a non-negative integer occurrence count. */
function coerceCount(flagName: string, source: CoerceSource, raw: unknown): CoerceResult {
	// Number('') is 0, which would silently accept an empty env var as a zero count.
	const value = typeof raw === 'string' ? (raw.trim() === '' ? Number.NaN : Number(raw)) : raw;
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
		return { ok: true, value };
	}
	return {
		ok: false,
		error: coercionError(
			flagName,
			source,
			'TYPE_MISMATCH',
			'count',
			raw,
			typeof raw === 'string' ? `Invalid count value '${raw}'` : 'Invalid count value',
			suggestBySource(source, {
				stdin: `Pipe a non-negative integer to stdin for --${flagName}`,
				env: (envVar) => `Set ${envVar} to a non-negative integer`,
				config: (configPath) => `Set ${configPath} to a non-negative integer in your config`,
				prompt: `Enter a non-negative integer for --${flagName}`,
			}),
		),
	};
}

// --- Collection coercion

/** What a collection failure looks like before a surface words it. */
type CollectionFault =
	| { readonly kind: 'shape' }
	| { readonly kind: 'pair'; readonly segment: string }
	| { readonly kind: 'json'; readonly error: unknown }
	| { readonly kind: 'json-shape'; readonly expected: 'array' | 'object' }
	| { readonly kind: 'duplicate-key'; readonly key: string };

/** How one surface words the faults a collection can produce. */
type CollectionErrors = (fault: CollectionFault, raw: unknown) => ValidationError;

/**
 * Read a source value as a collection and aggregate it.
 *
 * @param cardinality - The `many` or `entries` axis being filled.
 * @param source - Which stage produced the value.
 * @param raw - The value that stage produced.
 * @param decodeElement - Decodes one element through the value axis.
 * @param errors - Words a fault for the surface being resolved.
 * @returns The aggregated array or record, or the first failure.
 */
function coerceCollection(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	source: CoerceSource,
	raw: unknown,
	decodeElement: (element: unknown) => CoerceResult,
	errors: CollectionErrors,
): CoerceResult {
	if (cardinality.kind === 'many') {
		const parts = readManyParts(source, raw, cardinality.splitting);
		if (!parts.ok) return { ok: false, error: errors(parts.fault, raw) };
		const coerced: unknown[] = [];
		for (const part of parts.parts) {
			const result = decodeElement(part);
			if (!result.ok) return result;
			coerced.push(result.value);
		}
		return { ok: true, value: coerced };
	}

	const pairs = readEntryPairs(source, raw, cardinality.splitting);
	if (!pairs.ok) return { ok: false, error: errors(pairs.fault, raw) };
	const coerced: (readonly [string, unknown])[] = [];
	for (const [key, value] of pairs.pairs) {
		const result = decodeElement(value);
		if (!result.ok) return result;
		coerced.push([key, result.value]);
	}
	const folded = foldEntries(coerced, cardinality.duplicateKeys);
	if (!folded.ok) {
		return { ok: false, error: errors({ kind: 'duplicate-key', key: folded.duplicateKey }, raw) };
	}
	return { ok: true, value: folded.value };
}

/** Elements read off a source, or the fault that stopped the read. */
type PartsResult =
	| { readonly ok: true; readonly parts: readonly unknown[] }
	| { readonly ok: false; readonly fault: CollectionFault };

/** Pairs read off a source, or the fault that stopped the read. */
type PairsResult =
	| { readonly ok: true; readonly pairs: readonly (readonly [string, unknown])[] }
	| { readonly ok: false; readonly fault: CollectionFault };

/**
 * Which split policy a source decodes text under.
 *
 * A config or prompt value is native when it is an array or an object; a string
 * from either decodes under the env policy, which is the delimited form a user
 * would have typed.
 */
function policyFor(source: CoerceSource, splitting: SplitBinding): SplitPolicy {
	return source.kind === 'stdin' ? splitting.stdin : splitting.env;
}

/** Turn a split failure into the fault the surface words. */
function splitFault(failure: SplitFailure): CollectionFault {
	switch (failure.kind) {
		case 'json':
			return { kind: 'json', error: failure.error };
		case 'json-shape':
			return { kind: 'json-shape', expected: failure.expected };
		case 'pair':
			return { kind: 'pair', segment: failure.raw };
	}
}

/** Read the elements a source carries for a `many` collection. */
function readManyParts(source: CoerceSource, raw: unknown, splitting: SplitBinding): PartsResult {
	if (Array.isArray(raw)) return { ok: true, parts: raw };
	if (typeof raw !== 'string') return { ok: false, fault: { kind: 'shape' } };

	const split = splitManyText(policyFor(source, splitting), raw);
	if (!split.ok) return { ok: false, fault: splitFault(split.failure) };
	return {
		ok: true,
		parts: source.kind === 'prompt' ? split.parts.map(trimStringPart) : split.parts,
	};
}

/** Read the pairs a source carries for an `entries` collection. */
function readEntryPairs(source: CoerceSource, raw: unknown, splitting: SplitBinding): PairsResult {
	if (isPairList(raw)) return { ok: true, pairs: raw };
	if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
		return { ok: true, pairs: Object.entries(raw) };
	}
	if (typeof raw !== 'string') return { ok: false, fault: { kind: 'shape' } };

	const split = splitEntriesText(policyFor(source, splitting), raw);
	if (!split.ok) return { ok: false, fault: splitFault(split.failure) };
	return { ok: true, pairs: split.parts };
}

/** Whether a value is an ordered list of key/value pairs. */
function isPairList(value: unknown): value is readonly (readonly [string, unknown])[] {
	return (
		Array.isArray(value) &&
		value.every(
			(entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string',
		)
	);
}

/** Trim a prompt-sourced element, leaving a non-string element untouched. */
function trimStringPart(part: unknown): unknown {
	return typeof part === 'string' ? part.trim() : part;
}

/** Word a collection fault for a flag. */
function flagCollectionErrors(flagName: string, source: CoerceSource): CollectionErrors {
	return (fault, raw) => {
		switch (fault.kind) {
			case 'shape':
				return coercionError(
					flagName,
					source,
					'TYPE_MISMATCH',
					'array',
					raw,
					'Invalid array value',
					suggestBySource(source, {
						stdin: `Pipe one value per line to stdin for --${flagName}`,
						env: (envVar) => `Set ${envVar} to comma-separated values`,
						config: (configPath) => `Set ${configPath} to an array in your config`,
						prompt: `Provide valid values for --${flagName}`,
					}),
				);
			case 'pair':
				return coercionError(
					flagName,
					source,
					'TYPE_MISMATCH',
					'key=value',
					raw,
					`Invalid key-value pair '${fault.segment}'`,
					suggestBySource(source, {
						stdin: `Pipe KEY=VALUE pairs to stdin for --${flagName}`,
						env: (envVar) => `Set ${envVar} to comma-separated KEY=VALUE pairs`,
						config: (configPath) => `Set ${configPath} to an object with string values`,
						prompt: `Use KEY=VALUE for --${flagName}`,
					}),
				);
			case 'json':
				return coercionError(
					flagName,
					source,
					'TYPE_MISMATCH',
					'json',
					raw,
					`Invalid JSON value: ${jsonErrorMessage(fault.error)}`,
					`Provide valid JSON for --${flagName}`,
				);
			case 'json-shape':
				return coercionError(
					flagName,
					source,
					'TYPE_MISMATCH',
					fault.expected,
					raw,
					`Invalid JSON value, expected an ${fault.expected}`,
					`Provide a JSON ${fault.expected} for --${flagName}`,
				);
			case 'duplicate-key':
				return new ValidationError(
					`Duplicate key '${fault.key}' ${sourceLabel(source)} for flag --${flagName}`,
					{
						code: 'CONSTRAINT_VIOLATED',
						details: { flag: flagName, ...sourceDetails(source), key: fault.key },
						suggest: `Set '${fault.key}' once for --${flagName}`,
					},
				);
		}
	};
}

/** Word a collection fault for a positional, without echoing the value. */
function argCollectionErrors(argName: string, source: ArgStringSource): CollectionErrors {
	return (fault) => {
		switch (fault.kind) {
			case 'shape':
				return new ValidationError(
					`Invalid value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`,
					{
						code: 'TYPE_MISMATCH',
						details: { arg: argName, ...argSourceDetails(source), expected: 'array' },
						suggest: `Provide values for <${argName}>`,
					},
				);
			case 'pair':
				return new ValidationError(
					`Invalid key-value pair '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`,
					{
						code: 'TYPE_MISMATCH',
						details: { arg: argName, ...argSourceDetails(source), expected: 'key=value' },
						suggest: `Use KEY=VALUE for <${argName}>`,
					},
				);
			case 'json':
				return new ValidationError(
					`Invalid JSON value ${argSourceLabel(source)} for argument <${argName}>`,
					{
						code: 'TYPE_MISMATCH',
						details: { arg: argName, ...argSourceDetails(source), expected: 'json' },
						suggest: `Provide valid JSON for <${argName}>`,
					},
				);
			case 'json-shape':
				return new ValidationError(
					`Invalid JSON value ${argSourceLabel(source)} for argument <${argName}>, expected an ${fault.expected}`,
					{
						code: 'TYPE_MISMATCH',
						details: { arg: argName, ...argSourceDetails(source), expected: fault.expected },
						suggest: `Provide a JSON ${fault.expected} for <${argName}>`,
					},
				);
			case 'duplicate-key':
				return new ValidationError(
					`Duplicate key '${fault.key}' ${argSourceLabel(source)} for argument <${argName}>`,
					{
						code: 'CONSTRAINT_VIOLATED',
						details: { arg: argName, ...argSourceDetails(source), key: fault.key },
						suggest: `Set '${fault.key}' once for <${argName}>`,
					},
				);
		}
	};
}

/** Name what JSON parsing rejected, without echoing the text. */
function jsonErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Decode a raw env/config/prompt value through the shared value layer and name
 * the flag or arg that carried it on failure.
 *
 * The value layer decides what the value means; every message, code, detail
 * field, and suggestion below belongs to this surface.
 */
function coerceValueSchema(
	name: string,
	source: CoerceSource,
	raw: unknown,
	value: ValueSchema,
): CoerceResult {
	const decoded = decodeValue(value, raw, valueInputOf(source));
	if (decoded.ok) {
		return { ok: true, value: decoded.value };
	}
	return { ok: false, error: valueCoercionError(name, source, raw, decoded.failure) };
}

/**
 * Which value-layer input surface a resolver source speaks for.
 *
 * The stage names and the value-layer input names are the same set by
 * construction, so this is the identity.
 */
function valueInputOf(source: CoerceSource): ValueInput {
	return source.kind;
}

/** Turn a value-layer failure into the resolver's validation error. */
function valueCoercionError(
	name: string,
	source: CoerceSource,
	raw: unknown,
	failure: ValueFailure,
): ValidationError {
	switch (failure.kind) {
		case 'type':
			return typeCoercionError(name, source, raw, failure.expected);

		case 'enum': {
			const allowed = failure.enumValues ?? [];
			return new ValidationError(
				`Invalid value '${String(raw)}' ${sourceLabel(source)} for flag --${name}. Allowed: ${allowed.join(', ')}`,
				{
					code: 'INVALID_ENUM',
					details: { flag: name, ...sourceDetails(source), value: raw, allowed },
					suggest: suggestBySource(source, {
						stdin: `Pipe one of: ${allowed.join(', ')}`,
						env: (envVar) => `Set ${envVar} to one of: ${allowed.join(', ')}`,
						config: (configPath) => `Set ${configPath} to one of: ${allowed.join(', ')}`,
						prompt: `Select one of: ${allowed.join(', ')}`,
					}),
				},
			);
		}

		case 'string-constraint':
			return new ValidationError(
				`Invalid value '${failure.value}' ${sourceLabel(source)} for flag --${name}: ${describeStringConstraintViolation(failure.violation)}`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						flag: name,
						...sourceDetails(source),
						value: failure.value,
						expected: 'string',
						...stringConstraintDetails(failure.violation),
					},
					suggest: suggestBySource(source, {
						stdin: `Pipe a valid string to stdin for --${name}`,
						env: (envVar) => `Set ${envVar} to a valid string`,
						config: (configPath) => `Set ${configPath} to a valid string in your config`,
						prompt: `Enter a valid value for --${name}`,
					}),
				},
			);

		case 'number-constraint':
			return new ValidationError(
				`Invalid number value '${String(raw)}' ${sourceLabel(source)} for flag --${name}: ${describeNumberConstraintViolation(failure.violation)}`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						flag: name,
						...sourceDetails(source),
						value: raw,
						expected: 'number',
						constraint: failure.violation.kind,
						...('bound' in failure.violation ? { bound: failure.violation.bound } : {}),
					},
					suggest: suggestBySource(source, {
						stdin: `Pipe a valid number to stdin for --${name}`,
						env: (envVar) => `Set ${envVar} to a valid number`,
						config: (configPath) => `Set ${configPath} to a valid number in your config`,
						prompt: `Enter a valid number for --${name}`,
					}),
				},
			);

		case 'thrown': {
			const message =
				failure.error instanceof Error ? failure.error.message : String(failure.error);
			const sourceRef = suggestBySource(source, {
				stdin: 'stdin value',
				env: (envVar) => `env ${envVar}`,
				config: (configPath) => `config ${configPath}`,
				prompt: 'prompt value',
			});
			return new ValidationError(`Failed to parse ${sourceRef} for flag --${name}: ${message}`, {
				code: 'TYPE_MISMATCH',
				details: { flag: name, ...sourceDetails(source), value: raw, expected: 'custom' },
				suggest: suggestBySource(source, {
					stdin: `Pipe a valid value to stdin for --${name}`,
					env: (envVar) => `Set ${envVar} to a valid value for --${name}`,
					config: (configPath) => `Set ${configPath} to a valid value for --${name} in your config`,
					prompt: `Enter a valid value for --${name}`,
				}),
			});
		}
	}
}

/** Build the error for a raw value the codec could not read as its primitive. */
function typeCoercionError(
	name: string,
	source: CoerceSource,
	raw: unknown,
	expected: ValueTypeName,
): ValidationError {
	if (expected === 'string') {
		return coercionError(
			name,
			source,
			'TYPE_MISMATCH',
			'string',
			raw,
			'Invalid string value',
			suggestBySource(source, {
				stdin: `Pipe a valid string to stdin for --${name}`,
				env: (envVar) => `Set ${envVar} to a valid string`,
				config: (configPath) => `Set ${configPath} to a string in your config`,
				prompt: `Enter a valid string for --${name}`,
			}),
		);
	}

	if (expected === 'number') {
		return coercionError(
			name,
			source,
			'TYPE_MISMATCH',
			'number',
			raw,
			invalidNumberSuffix(raw),
			suggestBySource(source, {
				stdin: `Pipe a valid number to stdin for --${name}`,
				env: (envVar) => `Set ${envVar} to a valid number`,
				config: (configPath) => `Set ${configPath} to a valid number in your config`,
				prompt: `Enter a valid number for --${name}`,
			}),
		);
	}

	return coercionError(
		name,
		source,
		'TYPE_MISMATCH',
		'boolean',
		raw,
		typeof raw === 'string' ? `Invalid boolean value '${raw}'` : 'Invalid boolean value',
		suggestBySource(source, {
			stdin: `Pipe true/false, 1/0, or yes/no to stdin for --${name}`,
			env: (envVar) => `Set ${envVar} to true/false, 1/0, or yes/no`,
			config: (configPath) => `Set ${configPath} to true or false in your config`,
			prompt: `Answer yes or no for --${name}`,
		}),
	);
}

/** Name the offending number without quoting a `NaN` as if it were user text. */
function invalidNumberSuffix(raw: unknown): string {
	if (typeof raw === 'number' && Number.isNaN(raw)) return 'Invalid number value NaN';
	return typeof raw === 'string' ? `Invalid number value '${raw}'` : 'Invalid number value';
}

type ArgStringSource = ArgDiagnosticSource;

function argSourceLabel(source: ArgStringSource): string {
	return sourceLabel(source);
}

function argSourceDetails(source: ArgStringSource): Record<string, unknown> {
	return sourceDetails(source);
}

function buildArgCoercionSuggest(
	argName: string,
	source: ArgStringSource,
	expected: 'number' | 'string' | 'custom' | 'boolean',
): string {
	const subject = expected === 'custom' ? 'value' : expected;
	return suggestBySource(source, {
		stdin: `Pipe a valid ${subject} to stdin for <${argName}>`,
		env: (envVar) =>
			expected === 'custom'
				? `Set ${envVar} to a valid value for <${argName}>`
				: `Set ${envVar} to a valid ${expected}`,
		config: (configPath) => `Set ${configPath} to a valid ${subject} for <${argName}>`,
		prompt: `Enter a valid ${subject} for <${argName}>`,
	});
}

/**
 * Rebuild the human-readable reason for a string-constraint failure from the
 * error's own details.
 *
 * @param error - The coercion failure produced by {@link finalizeString}.
 * @returns The reason, or `undefined` when the failure was not a constraint
 *   violation.
 */
function stringConstraintReason(error: ValidationError): string | undefined {
	const violation = toStringConstraintViolation(error);
	return violation === undefined ? undefined : describeStringConstraintViolation(violation);
}

/** Narrow an error's details back into the violation {@link finalizeString} reported. */
function toStringConstraintViolation(
	error: ValidationError,
): StringConstraintViolation | undefined {
	if (error.code !== 'CONSTRAINT_VIOLATED') return undefined;
	const constraint = error.details?.constraint;
	if (constraint === 'nonEmpty') return { kind: 'nonEmpty' };
	const bound = error.details?.bound;
	if ((constraint === 'minLength' || constraint === 'maxLength') && typeof bound === 'number') {
		return { kind: constraint, bound };
	}
	const pattern = error.details?.pattern;
	if (constraint === 'pattern' && typeof pattern === 'string') {
		return { kind: 'pattern', pattern };
	}
	return undefined;
}

function redactArgCoercionMessage(
	argName: string,
	source: ArgStringSource,
	schema: ArgSchema,
	error: ValidationError,
): string {
	switch (schema.kind) {
		case 'number': {
			const base = `Invalid number value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`;
			// Only a constraint violation carries a schema-derived reason suffix
			// (e.g. `: must be >= 0`), which is safe to keep. Any other failure
			// (e.g. TYPE_MISMATCH) embeds the raw value in `error.message`, so
			// extracting a trailing suffix there could leak user input.
			if (error.code !== 'CONSTRAINT_VIOLATED') {
				return base;
			}
			const match = /: ([^:]+)$/.exec(error.message);
			const suffix = match?.[1];
			return suffix !== undefined ? `${base}: ${suffix}` : base;
		}
		case 'enum': {
			const allowed = Array.isArray(error.details?.allowed)
				? error.details.allowed.filter((value): value is string => typeof value === 'string')
				: [];
			return `Invalid value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>. Allowed: ${allowed.join(', ')}`;
		}
		case 'custom': {
			const match = /: ([^:]+)$/.exec(error.message);
			const suffix = match?.[1];
			return suffix !== undefined
				? `Invalid value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>: ${suffix}`
				: `Invalid value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`;
		}
		case 'string':
		case 'boolean':
		case 'keyValue': {
			const base = `Invalid value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`;
			const reason = schema.kind === 'string' ? stringConstraintReason(error) : undefined;
			return reason === undefined ? base : `${base}: ${reason}`;
		}
	}
}

function redactArgCoercionDetails(
	argName: string,
	source: ArgStringSource,
	schema: ArgSchema,
	error: ValidationError,
): Readonly<Record<string, unknown>> {
	const stringViolation = schema.kind === 'string' ? toStringConstraintViolation(error) : undefined;

	return {
		arg: argName,
		...argSourceDetails(source),
		...(schema.kind === 'number' || schema.kind === 'custom' || schema.kind === 'boolean'
			? { expected: schema.kind }
			: {}),
		...(stringViolation !== undefined
			? { expected: 'string', ...stringConstraintDetails(stringViolation) }
			: {}),
		...(schema.kind === 'number' && typeof error.details?.constraint === 'string'
			? { constraint: error.details.constraint }
			: {}),
		...(schema.kind === 'number' && typeof error.details?.bound === 'number'
			? { bound: error.details.bound }
			: {}),
		...(schema.kind === 'enum' && Array.isArray(error.details?.allowed)
			? {
					allowed: error.details.allowed.filter(
						(value): value is string => typeof value === 'string',
					),
				}
			: {}),
	};
}

function redactArgCoercionSuggest(
	argName: string,
	source: ArgStringSource,
	schema: ArgSchema,
	error: ValidationError,
): string | undefined {
	if (schema.kind === 'number' || schema.kind === 'custom' || schema.kind === 'boolean') {
		return buildArgCoercionSuggest(argName, source, schema.kind);
	}

	if (schema.kind === 'string') {
		return toStringConstraintViolation(error) === undefined
			? undefined
			: buildArgCoercionSuggest(argName, source, 'string');
	}

	if (schema.kind === 'enum') {
		const allowed = Array.isArray(error.details?.allowed)
			? error.details.allowed.filter((value): value is string => typeof value === 'string')
			: [];
		const allowedList = allowed.join(', ');
		return suggestBySource(source, {
			stdin: `Provide one of: ${allowedList}`,
			env: (envVar) => `Set ${envVar} to one of: ${allowedList}`,
			config: (configPath) => `Set ${configPath} to one of: ${allowedList}`,
			prompt: `Provide one of: ${allowedList}`,
		});
	}

	return undefined;
}

/**
 * Coerce a value from a non-CLI source into the type declared by an arg schema,
 * redacting the raw value in error diagnostics.
 *
 * Every source outside argv may carry a secret a user piped, exported, or
 * stored, so the arg surface reports the failure without echoing the value.
 *
 * @param argName - Name of the positional the value belongs to.
 * @param source - Which stage produced the value.
 * @param raw - The value that stage produced.
 * @param schema - Runtime descriptor of the arg.
 * @returns The coerced value, or a redacted {@link ValidationError}.
 */
function coerceArgValue(
	argName: string,
	source: ArgStringSource,
	raw: unknown,
	schema: ArgSchema,
): CoerceResult {
	const cardinality = argCardinality(schema);
	if (cardinality.kind === 'many' || cardinality.kind === 'entries') {
		return coerceCollection(
			cardinality,
			source,
			raw,
			(element) => coerceArgElement(argName, source, element, schema),
			argCollectionErrors(argName, source),
		);
	}
	return coerceArgElement(argName, source, raw, schema);
}

/**
 * Decode one arg value through the value layer, redacting the raw value in
 * diagnostics.
 */
function coerceArgElement(
	argName: string,
	source: ArgStringSource,
	raw: unknown,
	schema: ArgSchema,
): CoerceResult {
	const coerced = coerceValueSchema(argName, source, raw, argValueSchema(schema));
	if (coerced.ok) {
		return coerced;
	}

	const suggest = redactArgCoercionSuggest(argName, source, schema, coerced.error);
	const options =
		suggest === undefined
			? {
					code: coerced.error.code,
					details: redactArgCoercionDetails(argName, source, schema, coerced.error),
				}
			: {
					code: coerced.error.code,
					details: redactArgCoercionDetails(argName, source, schema, coerced.error),
					suggest,
				};

	return {
		ok: false,
		error: new ValidationError(
			redactArgCoercionMessage(argName, source, schema, coerced.error),
			options,
		),
	};
}

// --- CLI occurrence finishing

/** What finishing a CLI-sourced value produced. */
type CliFinish =
	| { readonly kind: 'value'; readonly value: unknown; readonly viaStdin: boolean }
	| { readonly kind: 'error'; readonly error: ValidationError }
	| { readonly kind: 'absent' };

/**
 * Finish the CLI value of a flag, splicing stdin into occurrence order.
 *
 * A scalar keeps what the parser produced. A collection carries its occurrences
 * in the order they were typed, and an occurrence of `-` stands for the whole
 * stdin source at that position: what the buffer decodes to is spliced in
 * there, so `--tag before --tag - --tag after` over `'a\nb\n'` resolves to
 * `['before', 'a', 'b', 'after']`.
 *
 * @param flagName - Canonical flag name.
 * @param schema - The flag being resolved.
 * @param value - What the parser produced for it.
 * @param stdinData - The pre-read stdin buffer, when one was read.
 * @returns The finished value, a failure, or absence when only `-` was given
 *   and nothing was piped.
 */
function finishCliFlagValue(
	flagName: string,
	schema: FlagSchema,
	value: unknown,
	stdinData: string | null | undefined,
): CliFinish {
	const cardinality = flagCardinality(schema);
	if (cardinality.kind !== 'many' && cardinality.kind !== 'entries') {
		return { kind: 'value', value, viaStdin: false };
	}
	return spliceCliCollection(
		cardinality,
		value,
		stdinData,
		schema.stdin !== undefined && stdinReadsOnDash(schema.stdin),
		(element) => coerceValueSchema(flagName, { kind: 'stdin' }, element, flagValueSchema(schema)),
		flagCollectionErrors(flagName, { kind: 'stdin' }),
	);
}

/**
 * Finish the CLI value of a positional, splicing stdin into occurrence order.
 *
 * @param argName - Positional arg name.
 * @param schema - The arg being resolved.
 * @param value - What the parser produced for it.
 * @param stdinData - The pre-read stdin buffer, when one was read.
 * @returns The finished value, a failure, or absence when only `-` was given
 *   and nothing was piped.
 */
function finishCliArgValue(
	argName: string,
	schema: ArgSchema,
	value: unknown,
	stdinData: string | null | undefined,
): CliFinish {
	const cardinality = argCardinality(schema);
	if (cardinality.kind !== 'many' && cardinality.kind !== 'entries') {
		return { kind: 'value', value, viaStdin: false };
	}
	return spliceCliCollection(
		cardinality,
		value,
		stdinData,
		schema.stdin !== undefined && stdinReadsOnDash(schema.stdin),
		(element) => coerceArgElement(argName, { kind: 'stdin' }, element, schema),
		argCollectionErrors(argName, { kind: 'stdin' }),
	);
}

/**
 * Replace every stdin sentinel among the occurrences with what stdin decodes to,
 * then aggregate what is left.
 *
 * A value the parser did not leave as an occurrence list is the aggregate a
 * caller built by hand, and it reaches the resolved value untouched.
 */
function spliceCliCollection(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	value: unknown,
	stdinData: string | null | undefined,
	readsOnDash: boolean,
	decodeElement: (element: unknown) => CoerceResult,
	errors: CollectionErrors,
): CliFinish {
	const occurrences = liftOccurrences(cardinality, value, readsOnDash);
	const aggregated = readAggregated(occurrences);
	if (aggregated !== undefined) {
		return { kind: 'value', value: aggregated.value, viaStdin: false };
	}

	const spliced: Occurrence[] = [];
	let sentinels = 0;
	let viaStdin = false;
	for (const occurrence of occurrences) {
		if (occurrence.kind !== 'stdin') {
			spliced.push(occurrence);
			continue;
		}
		sentinels += 1;
		if (typeof stdinData !== 'string') continue;
		const read = readStdinOccurrence(cardinality, stdinData, decodeElement, errors);
		if (read.kind !== 'value') return read;
		viaStdin = true;
		spliced.push(...read.occurrences);
	}

	if (sentinels === occurrences.length && sentinels > 0 && typeof stdinData !== 'string') {
		return { kind: 'absent' };
	}

	if (cardinality.kind === 'many') {
		return { kind: 'value', value: spliced.map(occurrenceValue), viaStdin };
	}

	const folded = foldEntries(entryPairsOf(spliced), cardinality.duplicateKeys);
	if (!folded.ok) {
		return {
			kind: 'error',
			error: errors({ kind: 'duplicate-key', key: folded.duplicateKey }, value),
		};
	}
	return { kind: 'value', value: folded.value, viaStdin };
}

/** Decode the stdin buffer into the occurrences one `-` stands for. */
function readStdinOccurrence(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	stdinData: string,
	decodeElement: (element: unknown) => CoerceResult,
	errors: CollectionErrors,
):
	| { readonly kind: 'value'; readonly occurrences: readonly Occurrence[] }
	| { readonly kind: 'error'; readonly error: ValidationError } {
	const source: CoerceSource = { kind: 'stdin' };

	if (cardinality.kind === 'many') {
		const parts = readManyParts(source, stdinData, cardinality.splitting);
		if (!parts.ok) return { kind: 'error', error: errors(parts.fault, stdinData) };
		const occurrences: Occurrence[] = [];
		for (const part of parts.parts) {
			const decoded = decodeElement(part);
			if (!decoded.ok) return { kind: 'error', error: decoded.error };
			occurrences.push({ kind: 'value', value: decoded.value });
		}
		return { kind: 'value', occurrences };
	}

	const pairs = readEntryPairs(source, stdinData, cardinality.splitting);
	if (!pairs.ok) return { kind: 'error', error: errors(pairs.fault, stdinData) };
	const occurrences: Occurrence[] = [];
	for (const [key, raw] of pairs.pairs) {
		const decoded = decodeElement(raw);
		if (!decoded.ok) return { kind: 'error', error: decoded.error };
		occurrences.push({ kind: 'entry', key, value: decoded.value });
	}
	return { kind: 'value', occurrences };
}

export type { CliFinish, CoerceResult };
export { coerceArgValue, coerceValue, finishCliArgValue, finishCliFlagValue };
