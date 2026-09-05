/**
 * Internal resolver coercion helpers.
 *
 * @module dreamcli/core/resolve/coerce
 * @internal
 */

import type { DiagnosticValue } from '#internals/core/errors/diagnostic-value.ts';
import { diagnosticValue } from '#internals/core/errors/diagnostic-value.ts';
import type { ValidationErrorCode } from '#internals/core/errors/index.ts';
import { ValidationError } from '#internals/core/errors/index.ts';
import type { Occurrence } from '#internals/core/parse/occurrences.ts';
import {
	entryPairsOf,
	liftOccurrences,
	occurrenceValue,
	readAggregated,
} from '#internals/core/parse/occurrences.ts';
import type { Cardinality, SplitFailure, SplitPolicy } from '#internals/core/schema/cardinality.ts';
import {
	argCardinality,
	flagCardinality,
	foldEntries,
	isCollection,
	splitEntriesText,
	splitManyText,
} from '#internals/core/schema/cardinality.ts';
import type { ArgSchema, FlagSchema } from '#internals/core/schema/index.ts';
import { describeNumberConstraintViolation } from '#internals/core/schema/number-constraints.ts';
import type { DecodedSourceBinding, StdinSourceBinding } from '#internals/core/schema/source.ts';
import { stdinReadsOnDash } from '#internals/core/schema/stdin.ts';
import {
	describeStringConstraintViolation,
	stringConstraintDetails,
} from '#internals/core/schema/string-constraints.ts';
import type {
	ValueFailure,
	ValueInput,
	ValueSchema,
	ValueTypeName,
} from '#internals/core/schema/value.ts';
import {
	argValueSchema,
	decodeValue,
	flagValueSchema,
	keepsStdinTerminator,
	stripTerminator,
} from '#internals/core/schema/value.ts';
import type {
	ArgDiagnosticSource,
	FlagDiagnosticSource,
	ResolutionDiagnosticSource,
} from './contracts.ts';

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

/**
 * How a diagnostic identifies the stage that produced the value.
 *
 * `source` names the stage on every one of them, which is what separates a
 * failure to read a value from a source from a missing required input that
 * merely declares one.
 */
function sourceDetails(source: CoerceSource): Record<string, unknown> {
	switch (source.kind) {
		case 'stdin':
			return { source: 'stdin' };
		case 'env':
			return { source: 'env', envVar: source.envVar };
		case 'config':
			return { source: 'config', configPath: source.configPath };
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
	report: DiagnosticValue<unknown>,
	message: (text: string) => string,
	suggest: string,
	extraDetails?: Record<string, unknown>,
): ValidationError {
	return new ValidationError(
		`${message(report.text)} ${sourceLabel(source)} for flag --${flagName}`,
		{
			code,
			details: {
				flag: flagName,
				...sourceDetails(source),
				...(report.kind === 'visible' ? { value: report.value } : {}),
				expected,
				...extraDetails,
			},
			suggest,
		},
	);
}

/**
 * Which source a binding's diagnostics name.
 *
 * @param binding - The stage that produced the value.
 * @returns The diagnostic context for that stage.
 */
function diagnosticSourceOf(binding: DecodedSourceBinding): CoerceSource {
	switch (binding.stage) {
		case 'stdin':
			return { kind: 'stdin' };
		case 'env':
			return { kind: 'env', envVar: binding.envVar };
		case 'config':
			return { kind: 'config', configPath: binding.configPath };
		case 'prompt':
			return { kind: 'prompt' };
	}
}

/**
 * Coerce a raw value from stdin/env/config/prompt into what a flag declares.
 *
 * The cardinality axis decides how many values the source carries and how they
 * combine; the value axis decides what each one means; the binding decides how
 * the source's text splits and whether a single value is trimmed.
 */
function coerceValue(
	flagName: string,
	binding: DecodedSourceBinding,
	raw: unknown,
	schema: FlagSchema,
): CoerceResult {
	const source = diagnosticSourceOf(binding);
	const cardinality = flagCardinality(schema);
	if (cardinality.kind === 'count') {
		return coerceCount(flagName, source, raw, schema.sensitive);
	}
	if (cardinality.kind === 'one') {
		const value = flagValueSchema(schema);
		return coerceValueSchema(
			flagName,
			source,
			trimmedStdinValue(binding, raw, value),
			value,
			schema.sensitive,
		);
	}
	return coerceCollection(
		cardinality,
		source,
		binding.split,
		raw,
		(element) =>
			coerceValueSchema(flagName, source, element, flagValueSchema(schema), schema.sensitive),
		flagCollectionErrors(flagName, source, schema.sensitive),
		flagAggregationErrors(flagName, schema.sensitive),
	);
}

/**
 * Apply `.stdin({ trim: true })` to a single value read off the stream.
 *
 * Only the string codec keeps the terminator a pipe appends, and only a single
 * value carries one: a collection's terminators frame its elements and the
 * split policy consumes them. Every other codec drops it while decoding, so
 * trimming there would take a second terminator off the value.
 *
 * @param binding - The stage that produced the value.
 * @param raw - The value that stage produced.
 * @param value - The value axis about to decode it.
 * @returns The value to decode.
 */
function trimmedStdinValue(
	binding: DecodedSourceBinding,
	raw: unknown,
	value: ValueSchema,
): unknown {
	if (binding.stage !== 'stdin' || !binding.trim || typeof raw !== 'string') return raw;
	return keepsStdinTerminator(value) ? stripTerminator(raw) : raw;
}

/** Read a raw value as a non-negative integer occurrence count. */
function coerceCount(
	flagName: string,
	source: CoerceSource,
	raw: unknown,
	sensitive: boolean,
): CoerceResult {
	// Number('') is 0, which would silently accept an empty env var as a zero count.
	const value = typeof raw === 'string' ? (raw.trim() === '' ? Number.NaN : Number(raw)) : raw;
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
		return { ok: true, value };
	}
	const report = diagnosticValue(sensitive, raw);
	return {
		ok: false,
		error: coercionError(
			flagName,
			source,
			'TYPE_MISMATCH',
			'count',
			report,
			(text) => `Invalid count value '${text}'`,
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

/** What reading one source's value as a collection rejected. */
type CollectionFault =
	| { readonly kind: 'shape'; readonly expected: 'array' | 'object'; readonly raw: unknown }
	| { readonly kind: 'pair'; readonly segment: string }
	| { readonly kind: 'json'; readonly error: unknown; readonly raw: string }
	| { readonly kind: 'json-shape'; readonly expected: 'array' | 'object'; readonly raw: string };

/** How one surface words the faults reading a source can produce. */
type CollectionErrors = (fault: CollectionFault) => ValidationError;

/**
 * What combining a collection's decoded elements rejected.
 *
 * Elements reach aggregation from several sources at once, so each fault is
 * worded for the source of the element that caused it.
 */
type AggregationFault =
	| { readonly kind: 'duplicate-key'; readonly key: string }
	| { readonly kind: 'dash-without-stdin' }
	| { readonly kind: 'shape'; readonly expected: 'array' | 'object'; readonly raw: unknown };

/** How one surface words an aggregation fault for the source that carried it. */
type AggregationErrors = (
	fault: AggregationFault,
	source: ResolutionDiagnosticSource,
) => ValidationError;

/**
 * The clause naming where a value came from, empty for the tokens the user
 * typed.
 *
 * @param source - The source that carried the value.
 * @returns A trailing-spaced clause, or `''` for the CLI.
 */
function sourceClause(source: ResolutionDiagnosticSource): string {
	return source.kind === 'cli' ? '' : `${sourceLabel(source)} `;
}

/** The identification fields a source contributes to an aggregation error. */
function aggregationSourceDetails(source: ResolutionDiagnosticSource): Record<string, unknown> {
	return source.kind === 'cli' ? {} : sourceDetails(source);
}

/**
 * How a duplicate key is quoted, and whether `details` carries it.
 *
 * A key is half of a `KEY=VALUE` pair, so it follows the owning schema's
 * sensitivity policy like the pair itself does when splitting fails.
 *
 * @param source - The source that carried the repeating pair.
 * @param key - The key that repeated.
 * @returns The quoted key for the message, and the detail fields it contributes.
 */
function duplicateKeyReport(
	sensitive: boolean,
	key: string,
): {
	readonly quoted: string;
	readonly details: Record<string, unknown>;
	readonly subject: string;
} {
	const report = diagnosticValue(sensitive, key);
	return report.kind === 'visible'
		? { quoted: `'${report.text}'`, details: { key: report.value }, subject: `'${report.text}'` }
		: { quoted: `'${report.text}'`, details: {}, subject: 'the repeated key' };
}

/**
 * Read a source value as a collection and aggregate it.
 *
 * @param cardinality - The `many` or `entries` axis being filled.
 * @param source - Which stage produced the value.
 * @param policy - How that stage's text decodes into elements.
 * @param raw - The value that stage produced.
 * @param decodeElement - Decodes one element through the value axis.
 * @param errors - Words a read fault for the surface being resolved.
 * @param aggregationErrors - Words an aggregation fault for the same surface.
 * @returns The aggregated array or record, or the first failure.
 */
function coerceCollection(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	source: CoerceSource,
	policy: SplitPolicy,
	raw: unknown,
	decodeElement: (element: unknown) => CoerceResult,
	errors: CollectionErrors,
	aggregationErrors: AggregationErrors,
): CoerceResult {
	if (cardinality.kind === 'many') {
		const parts = readManyParts(source, raw, policy);
		if (!parts.ok) return { ok: false, error: errors(parts.fault) };
		const coerced: unknown[] = [];
		for (const part of parts.parts) {
			const result = decodeElement(part);
			if (!result.ok) return result;
			coerced.push(result.value);
		}
		return { ok: true, value: coerced };
	}

	const pairs = readEntryPairs(raw, policy);
	if (!pairs.ok) return { ok: false, error: errors(pairs.fault) };
	const coerced: (readonly [string, unknown])[] = [];
	for (const [key, value] of pairs.pairs) {
		const result = decodeElement(value);
		if (!result.ok) return result;
		coerced.push([key, result.value]);
	}
	const folded = foldEntries(coerced, cardinality.duplicateKeys);
	if (!folded.ok) {
		return {
			ok: false,
			error: aggregationErrors({ kind: 'duplicate-key', key: folded.duplicateKey }, source),
		};
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

/** Turn a split failure into the fault the surface words. */
function splitFault(failure: SplitFailure, raw: string): CollectionFault {
	switch (failure.kind) {
		case 'json':
			return { kind: 'json', error: failure.error, raw };
		case 'json-shape':
			return { kind: 'json-shape', expected: failure.expected, raw };
		case 'pair':
			return { kind: 'pair', segment: failure.raw };
	}
}

/** Read the elements a source carries for a `many` collection. */
function readManyParts(source: CoerceSource, raw: unknown, policy: SplitPolicy): PartsResult {
	if (Array.isArray(raw)) return { ok: true, parts: raw };
	if (typeof raw !== 'string') {
		return { ok: false, fault: { kind: 'shape', expected: 'array', raw } };
	}

	const split = splitManyText(policy, raw);
	if (!split.ok) return { ok: false, fault: splitFault(split.failure, raw) };
	return {
		ok: true,
		parts: source.kind === 'prompt' ? split.parts.map(trimStringPart) : split.parts,
	};
}

/** Read the pairs a source carries for an `entries` collection. */
function readEntryPairs(raw: unknown, policy: SplitPolicy): PairsResult {
	if (isPairList(raw)) return { ok: true, pairs: raw };
	if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
		return { ok: true, pairs: Object.entries(raw) };
	}
	if (typeof raw !== 'string') {
		return { ok: false, fault: { kind: 'shape', expected: 'object', raw } };
	}

	const split = splitEntriesText(policy, raw);
	if (!split.ok) return { ok: false, fault: splitFault(split.failure, raw) };
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

/** Read a thrown value as diagnostic text. */
function thrownMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Word a collection fault for a flag under its sensitivity policy. */
function flagCollectionErrors(
	flagName: string,
	source: CoerceSource,
	sensitive: boolean,
): CollectionErrors {
	return (fault) => {
		switch (fault.kind) {
			case 'shape': {
				const collectionLabel = fault.expected === 'array' ? 'values' : 'KEY=VALUE pairs';
				const report = diagnosticValue(sensitive, fault.raw);
				return coercionError(
					flagName,
					source,
					'TYPE_MISMATCH',
					fault.expected,
					report,
					(text) => `Invalid ${fault.expected} value '${text}'`,
					suggestBySource(source, {
						stdin: `Pipe ${collectionLabel} to stdin for --${flagName}`,
						env: (envVar) => `Set ${envVar} to comma-separated ${collectionLabel}`,
						config: (configPath) => `Set ${configPath} to an ${fault.expected} in your config`,
						prompt: `Provide valid ${collectionLabel} for --${flagName}`,
					}),
				);
			}
			case 'pair': {
				const report = diagnosticValue(sensitive, fault.segment);
				return new ValidationError(
					`Invalid key-value pair '${report.text}' ${sourceLabel(source)} for flag --${flagName}`,
					{
						code: 'TYPE_MISMATCH',
						details: {
							flag: flagName,
							...sourceDetails(source),
							...(report.kind === 'visible' ? { segment: report.value } : {}),
							expected: 'key=value',
						},
						suggest: suggestBySource(source, {
							stdin: `Pipe KEY=VALUE pairs to stdin for --${flagName}`,
							env: (envVar) => `Set ${envVar} to comma-separated KEY=VALUE pairs`,
							config: (configPath) => `Set ${configPath} to an object with string values`,
							prompt: `Use KEY=VALUE for --${flagName}`,
						}),
					},
				);
			}
			case 'json': {
				const report = diagnosticValue(sensitive, fault.raw);
				const cause = report.kind === 'visible' ? thrownMessage(fault.error) : undefined;
				return new ValidationError(
					`Invalid JSON value '${report.text}' ${sourceLabel(source)} for flag --${flagName}${cause === undefined ? '' : `: ${cause}`}`,
					{
						code: 'TYPE_MISMATCH',
						details: {
							flag: flagName,
							...sourceDetails(source),
							...(report.kind === 'visible'
								? { value: report.value, cause: thrownMessage(fault.error) }
								: {}),
							expected: 'json',
						},
						suggest: `Provide valid JSON for --${flagName}`,
					},
				);
			}
			case 'json-shape': {
				const report = diagnosticValue(sensitive, fault.raw);
				return new ValidationError(
					`Invalid JSON value '${report.text}' ${sourceLabel(source)} for flag --${flagName}, expected an ${fault.expected}`,
					{
						code: 'TYPE_MISMATCH',
						details: {
							flag: flagName,
							...sourceDetails(source),
							...(report.kind === 'visible' ? { value: report.value } : {}),
							expected: fault.expected,
						},
						suggest: `Provide a JSON ${fault.expected} for --${flagName}`,
					},
				);
			}
		}
	};
}

/** Word an aggregation fault for a flag, naming the source that carried it. */
function flagAggregationErrors(flagName: string, sensitive: boolean): AggregationErrors {
	return (fault, source) => {
		if (fault.kind === 'dash-without-stdin') {
			return new ValidationError(`No piped stdin for the '-' occurrence of flag --${flagName}`, {
				code: 'MISSING_STDIN',
				details: { flag: flagName, source: 'stdin' },
				suggest: `Pipe a value to stdin, or drop the '-' occurrence of --${flagName}`,
			});
		}
		if (fault.kind === 'shape') {
			const collectionLabel = fault.expected === 'array' ? 'values' : 'KEY=VALUE pairs';
			const report = diagnosticValue(sensitive, fault.raw);
			return new ValidationError(
				`Invalid ${fault.expected} value '${report.text}' ${sourceClause(source)}for flag --${flagName}`,
				{
					code: 'TYPE_MISMATCH',
					details: {
						flag: flagName,
						...aggregationSourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						expected: fault.expected,
					},
					suggest: `Provide ${collectionLabel} for --${flagName}`,
				},
			);
		}
		const report = duplicateKeyReport(sensitive, fault.key);
		return new ValidationError(
			`Duplicate key ${report.quoted} ${sourceClause(source)}for flag --${flagName}`,
			{
				code: 'CONSTRAINT_VIOLATED',
				details: { flag: flagName, ...aggregationSourceDetails(source), ...report.details },
				suggest: `Set ${report.subject} once for --${flagName}`,
			},
		);
	};
}

/** Word a collection fault for a positional under its sensitivity policy. */
function argCollectionErrors(
	argName: string,
	source: ArgStringSource,
	sensitive: boolean,
): CollectionErrors {
	return (fault) => {
		switch (fault.kind) {
			case 'shape': {
				const report = diagnosticValue(sensitive, fault.raw);
				return new ValidationError(
					`Invalid ${fault.expected} value '${report.text}' ${argSourceLabel(source)} for argument <${argName}>`,
					{
						code: 'TYPE_MISMATCH',
						details: {
							arg: argName,
							...argSourceDetails(source),
							...(report.kind === 'visible' ? { value: report.value } : {}),
							expected: fault.expected,
						},
						suggest:
							fault.expected === 'object'
								? `Use KEY=VALUE for <${argName}>`
								: `Provide values for <${argName}>`,
					},
				);
			}
			case 'pair': {
				const report = diagnosticValue(sensitive, fault.segment);
				return new ValidationError(
					`Invalid key-value pair '${report.text}' ${argSourceLabel(source)} for argument <${argName}>`,
					{
						code: 'TYPE_MISMATCH',
						details: {
							arg: argName,
							...argSourceDetails(source),
							...(report.kind === 'visible' ? { segment: report.value } : {}),
							expected: 'key=value',
						},
						suggest: `Use KEY=VALUE for <${argName}>`,
					},
				);
			}
			case 'json': {
				const report = diagnosticValue(sensitive, fault.raw);
				const cause = report.kind === 'visible' ? thrownMessage(fault.error) : undefined;
				return new ValidationError(
					`Invalid JSON value '${report.text}' ${argSourceLabel(source)} for argument <${argName}>${cause === undefined ? '' : `: ${cause}`}`,
					{
						code: 'TYPE_MISMATCH',
						details: {
							arg: argName,
							...argSourceDetails(source),
							...(report.kind === 'visible'
								? { value: report.value, cause: thrownMessage(fault.error) }
								: {}),
							expected: 'json',
						},
						suggest: `Provide valid JSON for <${argName}>`,
					},
				);
			}
			case 'json-shape': {
				const report = diagnosticValue(sensitive, fault.raw);
				return new ValidationError(
					`Invalid JSON value '${report.text}' ${argSourceLabel(source)} for argument <${argName}>, expected an ${fault.expected}`,
					{
						code: 'TYPE_MISMATCH',
						details: {
							arg: argName,
							...argSourceDetails(source),
							...(report.kind === 'visible' ? { value: report.value } : {}),
							expected: fault.expected,
						},
						suggest: `Provide a JSON ${fault.expected} for <${argName}>`,
					},
				);
			}
		}
	};
}

/** Word an aggregation fault for a positional, naming the source that carried it. */
function argAggregationErrors(argName: string, sensitive: boolean): AggregationErrors {
	return (fault, source) => {
		if (fault.kind === 'dash-without-stdin') {
			return new ValidationError(`No piped stdin for the '-' occurrence of argument <${argName}>`, {
				code: 'MISSING_STDIN',
				details: { arg: argName, source: 'stdin' },
				suggest: `Pipe a value to stdin, or drop the '-' from <${argName}>`,
			});
		}
		if (fault.kind === 'shape') {
			const report = diagnosticValue(sensitive, fault.raw);
			return new ValidationError(
				`Invalid ${fault.expected} value '${report.text}' ${sourceClause(source)}for argument <${argName}>`,
				{
					code: 'TYPE_MISMATCH',
					details: {
						arg: argName,
						...aggregationSourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						expected: fault.expected,
					},
					suggest: `Provide KEY=VALUE pairs for <${argName}>`,
				},
			);
		}
		const report = duplicateKeyReport(sensitive, fault.key);
		return new ValidationError(
			`Duplicate key ${report.quoted} ${sourceClause(source)}for argument <${argName}>`,
			{
				code: 'CONSTRAINT_VIOLATED',
				details: { arg: argName, ...aggregationSourceDetails(source), ...report.details },
				suggest: `Set ${report.subject} once for <${argName}>`,
			},
		);
	};
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
	sensitive: boolean,
): CoerceResult {
	const decoded = decodeValue(value, raw, valueInputOf(source));
	if (decoded.ok) {
		return { ok: true, value: decoded.value };
	}
	return { ok: false, error: valueCoercionError(name, source, raw, decoded.failure, sensitive) };
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
	sensitive: boolean,
): ValidationError {
	const report = diagnosticValue(sensitive, raw);
	switch (failure.kind) {
		case 'type':
			return typeCoercionError(name, source, failure.expected, report);

		case 'enum': {
			const allowed = failure.enumValues ?? [];
			return new ValidationError(
				`Invalid value '${report.text}' ${sourceLabel(source)} for flag --${name}. Allowed: ${allowed.join(', ')}`,
				{
					code: 'INVALID_ENUM',
					details: {
						flag: name,
						...sourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						allowed,
					},
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
				`Invalid value '${report.text}' ${sourceLabel(source)} for flag --${name}: ${describeStringConstraintViolation(failure.violation)}`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						flag: name,
						...sourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
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
				`Invalid number value '${report.text}' ${sourceLabel(source)} for flag --${name}: ${describeNumberConstraintViolation(failure.violation)}`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						flag: name,
						...sourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
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
			// Custom parser text is developer-authored and remains verbatim, even
			// when it chooses to interpolate the raw input itself.
			const message = thrownMessage(failure.error);
			const sourceRef = suggestBySource(source, {
				stdin: 'stdin',
				env: (envVar) => `env ${envVar}`,
				config: (configPath) => `config ${configPath}`,
				prompt: 'prompt',
			});
			return new ValidationError(
				`Failed to parse ${sourceRef} for flag --${name} value '${report.text}': ${message}`,
				{
					code: 'TYPE_MISMATCH',
					details: {
						flag: name,
						...sourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						expected: 'custom',
					},
					suggest: suggestBySource(source, {
						stdin: `Pipe a valid value to stdin for --${name}`,
						env: (envVar) => `Set ${envVar} to a valid value for --${name}`,
						config: (configPath) =>
							`Set ${configPath} to a valid value for --${name} in your config`,
						prompt: `Enter a valid value for --${name}`,
					}),
				},
			);
		}
	}
}

/** Build the error for a raw value the codec could not read as its primitive. */
function typeCoercionError(
	name: string,
	source: CoerceSource,
	expected: ValueTypeName,
	report: DiagnosticValue<unknown>,
): ValidationError {
	if (expected === 'string') {
		return coercionError(
			name,
			source,
			'TYPE_MISMATCH',
			'string',
			report,
			(text) => `Invalid string value '${text}'`,
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
			report,
			(text) => `Invalid number value '${text}'`,
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
		report,
		(text) => `Invalid boolean value '${text}'`,
		suggestBySource(source, {
			stdin: `Pipe true/false, 1/0, or yes/no to stdin for --${name}`,
			env: (envVar) => `Set ${envVar} to true/false, 1/0, or yes/no`,
			config: (configPath) => `Set ${configPath} to true or false in your config`,
			prompt: `Answer yes or no for --${name}`,
		}),
	);
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
	expected: 'number' | 'string' | 'custom',
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

/** The spellings the boolean codec reads, named for the source that carried one. */
function argBooleanSuggest(argName: string, source: ArgStringSource): string {
	return suggestBySource(source, {
		stdin: `Pipe true/false, 1/0, or yes/no to stdin for <${argName}>`,
		env: (envVar) => `Set ${envVar} to true/false, 1/0, or yes/no`,
		config: (configPath) => `Set ${configPath} to true or false in your config`,
		prompt: `Answer yes or no for <${argName}>`,
	});
}

/**
 * Turn a value-layer failure into the positional surface's validation error.
 *
 * The failure states the reason, so this surface words its own diagnostic from
 * it. Reading a reason back out of the message another surface wrote loses the
 * part of it that follows a colon.
 *
 * @param argName - Name of the positional the value belongs to.
 * @param source - The stage that carried the value.
 * @param failure - What the value layer rejected.
 * @returns The sensitivity-aware error for this surface.
 */
function argValueCoercionError(
	argName: string,
	source: ArgStringSource,
	raw: unknown,
	failure: ValueFailure,
	sensitive: boolean,
): ValidationError {
	const subject = `${argSourceLabel(source)} for argument <${argName}>`;
	const report = diagnosticValue(sensitive, raw);

	switch (failure.kind) {
		case 'type':
			return argTypeCoercionError(argName, source, failure.expected, report);

		case 'enum': {
			const allowed = failure.enumValues ?? [];
			const allowedList = allowed.join(', ');
			return new ValidationError(
				`Invalid value '${report.text}' ${subject}. Allowed: ${allowedList}`,
				{
					code: 'INVALID_ENUM',
					details: {
						arg: argName,
						...argSourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						allowed,
					},
					suggest: suggestBySource(source, {
						stdin: `Provide one of: ${allowedList}`,
						env: (envVar) => `Set ${envVar} to one of: ${allowedList}`,
						config: (configPath) => `Set ${configPath} to one of: ${allowedList}`,
						prompt: `Provide one of: ${allowedList}`,
					}),
				},
			);
		}

		case 'string-constraint':
			return new ValidationError(
				`Invalid value '${report.text}' ${subject}: ${describeStringConstraintViolation(failure.violation)}`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						arg: argName,
						...argSourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						expected: 'string',
						...stringConstraintDetails(failure.violation),
					},
					suggest: buildArgCoercionSuggest(argName, source, 'string'),
				},
			);

		case 'number-constraint':
			return new ValidationError(
				`Invalid number value '${report.text}' ${subject}: ${describeNumberConstraintViolation(failure.violation)}`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						arg: argName,
						...argSourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						expected: 'number',
						constraint: failure.violation.kind,
						...('bound' in failure.violation ? { bound: failure.violation.bound } : {}),
					},
					suggest: buildArgCoercionSuggest(argName, source, 'number'),
				},
			);

		case 'thrown': {
			// Custom parser text is developer-authored and remains verbatim.
			const message = thrownMessage(failure.error);
			const sourceRef = suggestBySource(source, {
				stdin: 'stdin',
				env: (envVar) => `env ${envVar}`,
				config: (configPath) => `config ${configPath}`,
				prompt: 'prompt',
			});
			return new ValidationError(
				`Failed to parse ${sourceRef} for argument <${argName}> value '${report.text}': ${message}`,
				{
					code: 'TYPE_MISMATCH',
					details: {
						arg: argName,
						...argSourceDetails(source),
						...(report.kind === 'visible' ? { value: report.value } : {}),
						expected: 'custom',
					},
					suggest: buildArgCoercionSuggest(argName, source, 'custom'),
				},
			);
		}
	}
}

/** Build the error for a raw value the codec could not read as its primitive. */
function argTypeCoercionError(
	argName: string,
	source: ArgStringSource,
	expected: ValueTypeName,
	report: DiagnosticValue<unknown>,
): ValidationError {
	const subject = `${argSourceLabel(source)} for argument <${argName}>`;
	const details = {
		arg: argName,
		...argSourceDetails(source),
		...(report.kind === 'visible' ? { value: report.value } : {}),
		expected,
	};

	if (expected === 'string') {
		return new ValidationError(`Invalid string value '${report.text}' ${subject}`, {
			code: 'TYPE_MISMATCH',
			details,
			suggest: buildArgCoercionSuggest(argName, source, 'string'),
		});
	}

	if (expected === 'number') {
		return new ValidationError(`Invalid number value '${report.text}' ${subject}`, {
			code: 'TYPE_MISMATCH',
			details,
			suggest: buildArgCoercionSuggest(argName, source, 'number'),
		});
	}

	return new ValidationError(`Invalid boolean value '${report.text}' ${subject}`, {
		code: 'TYPE_MISMATCH',
		details,
		suggest: argBooleanSuggest(argName, source),
	});
}

/**
 * Coerce a value from a non-CLI source into the type declared by an arg schema,
 * reporting the raw value unless the schema marks it sensitive.
 *
 * @param argName - Name of the positional the value belongs to.
 * @param binding - The stage that produced the value.
 * @param raw - The value that stage produced.
 * @param schema - Runtime descriptor of the arg.
 * @returns The coerced value, or a sensitivity-aware {@link ValidationError}.
 */
function coerceArgValue(
	argName: string,
	binding: DecodedSourceBinding,
	raw: unknown,
	schema: ArgSchema,
): CoerceResult {
	const source = diagnosticSourceOf(binding);
	const cardinality = argCardinality(schema);
	if (isCollection(cardinality)) {
		return coerceCollection(
			cardinality,
			source,
			binding.split,
			raw,
			(element) => coerceArgElement(argName, source, element, schema),
			argCollectionErrors(argName, source, schema.sensitive),
			argAggregationErrors(argName, schema.sensitive),
		);
	}
	return coerceArgElement(
		argName,
		source,
		trimmedStdinValue(binding, raw, argValueSchema(schema)),
		schema,
	);
}

/**
 * Decode one arg value through the value layer under the schema's sensitivity
 * policy.
 *
 * An entries arg projects onto the value of one entry, so the failure a decode
 * reports already describes the element rather than the record.
 */
function coerceArgElement(
	argName: string,
	source: ArgStringSource,
	raw: unknown,
	schema: ArgSchema,
): CoerceResult {
	const decoded = decodeValue(argValueSchema(schema), raw, valueInputOf(source));
	return decoded.ok
		? { ok: true, value: decoded.value }
		: {
				ok: false,
				error: argValueCoercionError(argName, source, raw, decoded.failure, schema.sensitive),
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
 * @param stdin - The flag's stdin source, when it declares one.
 * @returns The finished value, a failure, or absence when only `-` was given
 *   and nothing was piped.
 */
function finishCliFlagValue(
	flagName: string,
	schema: FlagSchema,
	value: unknown,
	stdinData: string | null | undefined,
	stdin: StdinSourceBinding | undefined,
): CliFinish {
	const cardinality = flagCardinality(schema);
	if (!isCollection(cardinality)) {
		return { kind: 'value', value, viaStdin: false };
	}
	return spliceCliCollection(
		cardinality,
		value,
		stdinData,
		stdin,
		(element) =>
			coerceValueSchema(
				flagName,
				{ kind: 'stdin' },
				element,
				flagValueSchema(schema),
				schema.sensitive,
			),
		flagCollectionErrors(flagName, { kind: 'stdin' }, schema.sensitive),
		flagAggregationErrors(flagName, schema.sensitive),
	);
}

/**
 * Finish the CLI value of a positional, splicing stdin into occurrence order.
 *
 * @param argName - Positional arg name.
 * @param schema - The arg being resolved.
 * @param value - What the parser produced for it.
 * @param stdinData - The pre-read stdin buffer, when one was read.
 * @param stdin - The arg's stdin source, when it declares one.
 * @returns The finished value, a failure, or absence when only `-` was given
 *   and nothing was piped.
 */
function finishCliArgValue(
	argName: string,
	schema: ArgSchema,
	value: unknown,
	stdinData: string | null | undefined,
	stdin: StdinSourceBinding | undefined,
): CliFinish {
	const cardinality = argCardinality(schema);
	if (!isCollection(cardinality)) {
		return { kind: 'value', value, viaStdin: false };
	}
	return spliceCliCollection(
		cardinality,
		value,
		stdinData,
		stdin,
		(element) => coerceArgElement(argName, { kind: 'stdin' }, element, schema),
		argCollectionErrors(argName, { kind: 'stdin' }, schema.sensitive),
		argAggregationErrors(argName, schema.sensitive),
	);
}

/** The tokens the user typed, as the source of an occurrence. */
const CLI_SOURCE: ResolutionDiagnosticSource = { kind: 'cli' };

/** The buffer a `-` stood for, as the source of an occurrence. */
const STDIN_SOURCE: ResolutionDiagnosticSource = { kind: 'stdin' };

/** One occurrence of a spliced collection, with where it came from. */
interface SourcedOccurrence {
	/** The occurrence itself. */
	readonly occurrence: Occurrence;
	/** The source that produced it. */
	readonly source: ResolutionDiagnosticSource;
}

/**
 * Replace every stdin sentinel among the occurrences with what stdin decodes to,
 * then aggregate what is left.
 *
 * A value the parser did not leave as an occurrence list is the aggregate a
 * caller built by hand, and it reaches the resolved value untouched. Each
 * occurrence keeps the source it came from, so an aggregation failure names
 * either the typed token or the pipe.
 */
function spliceCliCollection(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	value: unknown,
	stdinData: string | null | undefined,
	stdin: StdinSourceBinding | undefined,
	decodeElement: (element: unknown) => CoerceResult,
	errors: CollectionErrors,
	aggregationErrors: AggregationErrors,
): CliFinish {
	const occurrences = liftOccurrences(
		cardinality,
		value,
		stdin !== undefined && stdinReadsOnDash(stdin),
	);
	const aggregated = readAggregated(occurrences);
	if (aggregated !== undefined) {
		return { kind: 'value', value: aggregated.value, viaStdin: false };
	}

	const spliced: SourcedOccurrence[] = [];
	let sentinels = 0;
	let viaStdin = false;
	for (const occurrence of occurrences) {
		if (occurrence.kind !== 'stdin') {
			spliced.push({ occurrence, source: CLI_SOURCE });
			continue;
		}
		sentinels += 1;
		if (stdin === undefined || typeof stdinData !== 'string') continue;
		const read = readStdinOccurrence(cardinality, stdin.split, stdinData, decodeElement, errors);
		if (read.kind !== 'value') return read;
		viaStdin = true;
		for (const element of read.occurrences) {
			spliced.push({ occurrence: element, source: STDIN_SOURCE });
		}
	}

	if (sentinels > 0 && typeof stdinData !== 'string') {
		if (sentinels === occurrences.length) return { kind: 'absent' };
		return {
			kind: 'error',
			error: aggregationErrors({ kind: 'dash-without-stdin' }, CLI_SOURCE),
		};
	}

	if (cardinality.kind === 'many') {
		return {
			kind: 'value',
			value: spliced.map((entry) => occurrenceValue(entry.occurrence)),
			viaStdin,
		};
	}

	const entries: SourcedOccurrence[] = [];
	for (const entry of spliced) {
		if (entry.occurrence.kind !== 'entry') {
			return {
				kind: 'error',
				error: aggregationErrors(
					{
						kind: 'shape',
						expected: 'object',
						raw: occurrenceValue(entry.occurrence),
					},
					entry.source,
				),
			};
		}
		entries.push(entry);
	}

	const folded = foldEntries(
		entryPairsOf(entries.map((entry) => entry.occurrence)),
		cardinality.duplicateKeys,
	);
	if (!folded.ok) {
		return {
			kind: 'error',
			error: aggregationErrors(
				{ kind: 'duplicate-key', key: folded.duplicateKey },
				entries[folded.at]?.source ?? CLI_SOURCE,
			),
		};
	}
	return { kind: 'value', value: folded.value, viaStdin };
}

/** Decode the stdin buffer into the occurrences one `-` stands for. */
function readStdinOccurrence(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	policy: SplitPolicy,
	stdinData: string,
	decodeElement: (element: unknown) => CoerceResult,
	errors: CollectionErrors,
):
	| { readonly kind: 'value'; readonly occurrences: readonly Occurrence[] }
	| { readonly kind: 'error'; readonly error: ValidationError } {
	const source: CoerceSource = { kind: 'stdin' };

	if (cardinality.kind === 'many') {
		const parts = readManyParts(source, stdinData, policy);
		if (!parts.ok) return { kind: 'error', error: errors(parts.fault) };
		const occurrences: Occurrence[] = [];
		for (const part of parts.parts) {
			const decoded = decodeElement(part);
			if (!decoded.ok) return { kind: 'error', error: decoded.error };
			occurrences.push({ kind: 'value', value: decoded.value });
		}
		return { kind: 'value', occurrences };
	}

	const pairs = readEntryPairs(stdinData, policy);
	if (!pairs.ok) return { kind: 'error', error: errors(pairs.fault) };
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
