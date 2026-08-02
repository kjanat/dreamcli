/**
 * Internal resolver coercion helpers.
 *
 * @module dreamcli/core/resolve/coerce
 * @internal
 */

import type { ValidationErrorCode } from '#internals/core/errors/index.ts';
import { ValidationError } from '#internals/core/errors/index.ts';
import type {
	ArgSchema,
	FlagSchema,
	NumberConstraints,
	StringConstraints,
	StringConstraintViolation,
} from '#internals/core/schema/index.ts';
import {
	describeNumberConstraintViolation,
	describeStringConstraintViolation,
	stringConstraintDetails,
	validateNumberConstraints,
	validateStringConstraints,
} from '#internals/core/schema/index.ts';
import type { ArgDiagnosticSource, FlagDiagnosticSource } from './contracts.ts';
import type { SharedPropertySchema } from './property.ts';
import { toSharedArgPropertySchema, toSharedFlagPropertySchema } from './property.ts';

type CoerceSource = FlagDiagnosticSource;

/** Discriminated result of a value coercion attempt — success with the coerced value, or failure with a structured validation error. */
type CoerceResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError };

function sourceLabel(source: CoerceSource): string {
	switch (source.kind) {
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
		case 'env':
			return { envVar: source.envVar };
		case 'config':
			return { configPath: source.configPath };
		case 'prompt':
			return { source: 'prompt' };
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
): CoerceResult {
	return {
		ok: false,
		error: new ValidationError(`${messageSuffix} ${sourceLabel(source)} for flag --${flagName}`, {
			code,
			details: { flag: flagName, ...sourceDetails(source), value: raw, expected, ...extraDetails },
			suggest,
		}),
	};
}

/**
 * Apply numeric constraints to an already-parsed number. Shares the single
 * {@link validateNumberConstraints} check used by the parse path, so the two
 * boundaries cannot drift. On violation, returns a `CONSTRAINT_VIOLATED`
 * failure; the human-readable reason is also surfaced in `details.constraint`
 * (the violation kind) and the message suffix.
 */
function finalizeNumber(
	flagName: string,
	source: CoerceSource,
	raw: unknown,
	value: number,
	constraints: NumberConstraints | undefined,
): CoerceResult {
	const violation = validateNumberConstraints(value, constraints);
	if (violation === undefined) {
		return { ok: true, value };
	}

	const reason = describeNumberConstraintViolation(violation);
	return {
		ok: false,
		error: new ValidationError(
			`Invalid number value '${String(raw)}' ${sourceLabel(source)} for flag --${flagName}: ${reason}`,
			{
				code: 'CONSTRAINT_VIOLATED',
				details: {
					flag: flagName,
					...sourceDetails(source),
					value: raw,
					expected: 'number',
					constraint: violation.kind,
					...('bound' in violation ? { bound: violation.bound } : {}),
				},
				suggest:
					source.kind === 'env'
						? `Set ${source.envVar} to a valid number`
						: source.kind === 'config'
							? `Set ${source.configPath} to a valid number in your config`
							: `Enter a valid number for --${flagName}`,
			},
		),
	};
}

/**
 * Apply string constraints to an already-string value. Shares the single
 * {@link validateStringConstraints} check used by the parse path, so the two
 * boundaries cannot drift. On violation, returns a `CONSTRAINT_VIOLATED`
 * failure mirroring {@link finalizeNumber}.
 */
function finalizeString(
	flagName: string,
	source: CoerceSource,
	value: string,
	constraints: StringConstraints | undefined,
): CoerceResult {
	const violation = validateStringConstraints(value, constraints);
	if (violation === undefined) {
		return { ok: true, value };
	}

	const reason = describeStringConstraintViolation(violation);
	return {
		ok: false,
		error: new ValidationError(
			`Invalid value '${value}' ${sourceLabel(source)} for flag --${flagName}: ${reason}`,
			{
				code: 'CONSTRAINT_VIOLATED',
				details: {
					flag: flagName,
					...sourceDetails(source),
					value,
					expected: 'string',
					...stringConstraintDetails(violation),
				},
				suggest:
					source.kind === 'env'
						? `Set ${source.envVar} to a valid string`
						: source.kind === 'config'
							? `Set ${source.configPath} to a valid string in your config`
							: `Enter a valid value for --${flagName}`,
			},
		),
	};
}

/** Coerce a raw value from env/config/prompt into the type declared by a flag schema. */
function coerceValue(
	flagName: string,
	source: CoerceSource,
	raw: unknown,
	schema: FlagSchema,
): CoerceResult {
	const sharedSchema = toSharedFlagPropertySchema(schema);
	if (sharedSchema !== undefined) {
		return coerceSharedPropertyValue(flagName, source, raw, sharedSchema);
	}

	switch (schema.kind) {
		case 'boolean': {
			if (typeof raw === 'boolean') return { ok: true, value: raw };
			if (typeof raw === 'string') {
				const lower = raw.toLowerCase();
				const truthy =
					lower === 'true' ||
					lower === '1' ||
					lower === 'yes' ||
					(source.kind === 'prompt' && lower === 'y');
				if (truthy) return { ok: true, value: true };
				const falsy =
					lower === 'false' ||
					lower === '0' ||
					lower === 'no' ||
					lower === '' ||
					(source.kind === 'prompt' && lower === 'n');
				if (falsy) return { ok: true, value: false };
			}
			return coercionError(
				flagName,
				source,
				'TYPE_MISMATCH',
				'boolean',
				raw,
				typeof raw === 'string' ? `Invalid boolean value '${raw}'` : 'Invalid boolean value',
				source.kind === 'env'
					? `Set ${source.envVar} to true/false, 1/0, or yes/no`
					: source.kind === 'config'
						? `Set ${source.configPath} to true or false in your config`
						: `Answer yes or no for --${flagName}`,
			);
		}

		case 'array': {
			if (Array.isArray(raw)) {
				if (schema.elementSchema) {
					const coerced: unknown[] = [];
					for (const element of raw) {
						const result = coerceValue(flagName, source, element, schema.elementSchema);
						if (!result.ok) return result;
						coerced.push(result.value);
					}
					return { ok: true, value: coerced };
				}
				return { ok: true, value: raw };
			}
			if (typeof raw === 'string') {
				if (raw === '') return { ok: true, value: [] };
				const parts = raw.split(schema.separator ?? ',').filter((part) => part.length > 0);
				if (schema.elementSchema) {
					const coerced: unknown[] = [];
					for (const part of parts) {
						const element = source.kind === 'prompt' ? part.trim() : part;
						const result = coerceValue(flagName, source, element, schema.elementSchema);
						if (!result.ok) return result;
						coerced.push(result.value);
					}
					return { ok: true, value: coerced };
				}
				return {
					ok: true,
					value: source.kind === 'prompt' ? parts.map((part) => part.trim()) : parts,
				};
			}
			return coercionError(
				flagName,
				source,
				'TYPE_MISMATCH',
				'array',
				raw,
				'Invalid array value',
				source.kind === 'env'
					? `Set ${source.envVar} to comma-separated values`
					: source.kind === 'config'
						? `Set ${source.configPath} to an array in your config`
						: `Provide valid values for --${flagName}`,
			);
		}

		case 'count': {
			// Reject '' explicitly — Number('') is 0, which would silently
			// accept an empty env var as a zero count.
			const value = typeof raw === 'string' ? (raw.trim() === '' ? Number.NaN : Number(raw)) : raw;
			if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
				return { ok: true, value };
			}
			return coercionError(
				flagName,
				source,
				'TYPE_MISMATCH',
				'count',
				raw,
				typeof raw === 'string' ? `Invalid count value '${raw}'` : 'Invalid count value',
				source.kind === 'env'
					? `Set ${source.envVar} to a non-negative integer`
					: source.kind === 'config'
						? `Set ${source.configPath} to a non-negative integer in your config`
						: `Enter a non-negative integer for --${flagName}`,
			);
		}

		case 'keyValue': {
			if (isStringRecord(raw)) {
				return { ok: true, value: { ...raw } };
			}
			if (typeof raw === 'string') {
				if (raw === '') return { ok: true, value: {} };
				const pairs: [string, string][] = [];
				// Empty segments are dropped (trailing-comma parity with array
				// coercion). Values themselves cannot contain ',' via env —
				// use CLI or config for those.
				for (const pair of raw.split(',').filter((segment) => segment.length > 0)) {
					const eq = pair.indexOf('=');
					if (eq <= 0) {
						return coercionError(
							flagName,
							source,
							'TYPE_MISMATCH',
							'key=value',
							raw,
							`Invalid key-value pair '${pair}'`,
							source.kind === 'env'
								? `Set ${source.envVar} to comma-separated KEY=VALUE pairs`
								: source.kind === 'config'
									? `Set ${source.configPath} to an object with string values`
									: `Use KEY=VALUE for --${flagName}`,
						);
					}
					pairs.push([pair.slice(0, eq), pair.slice(eq + 1)]);
				}
				// fromEntries defines own data properties — '__proto__' keys are
				// stored verbatim, not routed to the prototype setter.
				return { ok: true, value: Object.fromEntries(pairs) };
			}
			return coercionError(
				flagName,
				source,
				'TYPE_MISMATCH',
				'key=value',
				raw,
				'Invalid key-value value',
				source.kind === 'env'
					? `Set ${source.envVar} to comma-separated KEY=VALUE pairs`
					: source.kind === 'config'
						? `Set ${source.configPath} to an object with string values`
						: `Use KEY=VALUE for --${flagName}`,
			);
		}
	}

	throw new Error(`Unreachable flag coercion kind: ${schema.kind}`);
}

/** Narrow config-sourced objects to plain string-valued records. */
function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	return Object.values(value).every((entry) => typeof entry === 'string');
}

function coerceSharedPropertyValue(
	flagName: string,
	source: CoerceSource,
	raw: unknown,
	schema: SharedPropertySchema,
): CoerceResult {
	switch (schema.kind) {
		case 'string': {
			if (typeof raw === 'string') {
				return finalizeString(flagName, source, raw, schema.stringConstraints);
			}
			if (source.kind === 'prompt') {
				return finalizeString(flagName, source, String(raw), schema.stringConstraints);
			}
			if (source.kind === 'config' && (typeof raw === 'number' || typeof raw === 'boolean')) {
				return finalizeString(flagName, source, String(raw), schema.stringConstraints);
			}
			return coercionError(
				flagName,
				source,
				'TYPE_MISMATCH',
				'string',
				raw,
				'Invalid string value',
				source.kind === 'config'
					? `Set ${source.configPath} to a string in your config`
					: `Enter a valid string for --${flagName}`,
			);
		}

		case 'number': {
			if (typeof raw === 'number') {
				if (Number.isNaN(raw)) {
					return coercionError(
						flagName,
						source,
						'TYPE_MISMATCH',
						'number',
						raw,
						'Invalid number value NaN',
						source.kind === 'env'
							? `Set ${source.envVar} to a valid number`
							: source.kind === 'config'
								? `Set ${source.configPath} to a valid number in your config`
								: `Enter a valid number for --${flagName}`,
					);
				}
				return finalizeNumber(flagName, source, raw, raw, schema.numberConstraints);
			}
			if (typeof raw === 'string') {
				const value = Number(raw);
				if (!Number.isNaN(value)) {
					return finalizeNumber(flagName, source, raw, value, schema.numberConstraints);
				}
			}
			return coercionError(
				flagName,
				source,
				'TYPE_MISMATCH',
				'number',
				raw,
				typeof raw === 'string' ? `Invalid number value '${raw}'` : 'Invalid number value',
				source.kind === 'env'
					? `Set ${source.envVar} to a valid number`
					: source.kind === 'config'
						? `Set ${source.configPath} to a valid number in your config`
						: `Enter a valid number for --${flagName}`,
			);
		}

		case 'enum': {
			const allowed = schema.enumValues ?? [];
			if (typeof raw === 'string' && allowed.includes(raw)) {
				return { ok: true, value: raw };
			}
			return {
				ok: false,
				error: new ValidationError(
					`Invalid value '${String(raw)}' ${sourceLabel(source)} for flag --${flagName}. Allowed: ${allowed.join(', ')}`,
					{
						code: 'INVALID_ENUM',
						details: { flag: flagName, ...sourceDetails(source), value: raw, allowed },
						suggest:
							source.kind === 'env'
								? `Set ${source.envVar} to one of: ${allowed.join(', ')}`
								: source.kind === 'config'
									? `Set ${source.configPath} to one of: ${allowed.join(', ')}`
									: `Select one of: ${allowed.join(', ')}`,
					},
				),
			};
		}

		case 'custom': {
			if (schema.parseFn === undefined) {
				return { ok: true, value: raw };
			}

			try {
				return { ok: true, value: schema.parseFn(raw) };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const sourceRef =
					source.kind === 'env'
						? `env ${source.envVar}`
						: source.kind === 'config'
							? `config ${source.configPath}`
							: 'prompt value';
				return {
					ok: false,
					error: new ValidationError(
						`Failed to parse ${sourceRef} for flag --${flagName}: ${message}`,
						{
							code: 'TYPE_MISMATCH',
							details: {
								flag: flagName,
								...sourceDetails(source),
								value: raw,
								expected: 'custom',
							},
							suggest:
								source.kind === 'env'
									? `Set ${source.envVar} to a valid value for --${flagName}`
									: source.kind === 'config'
										? `Set ${source.configPath} to a valid value for --${flagName} in your config`
										: `Enter a valid value for --${flagName}`,
						},
					),
				};
			}
		}
	}
}

type ArgStringSource = ArgDiagnosticSource;

function argSourceLabel(source: ArgStringSource): string {
	return source.kind === 'env' ? `from env ${source.envVar}` : 'from stdin';
}

function argSourceDetails(source: ArgStringSource): Record<string, unknown> {
	return source.kind === 'env' ? { envVar: source.envVar } : { source: 'stdin' };
}

function buildArgCoercionSuggest(
	argName: string,
	source: ArgStringSource,
	expected: 'number' | 'string' | 'custom',
): string {
	if (expected === 'custom') {
		return source.kind === 'env'
			? `Set ${source.envVar} to a valid value for <${argName}>`
			: `Pipe a valid value to stdin for <${argName}>`;
	}

	return source.kind === 'env'
		? `Set ${source.envVar} to a valid ${expected}`
		: `Pipe a valid ${expected} to stdin for <${argName}>`;
}

function argSourceToCoerceSource(source: ArgStringSource): CoerceSource {
	return source.kind === 'env' ? { kind: 'env', envVar: source.envVar } : { kind: 'prompt' };
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
		case 'string': {
			const base = `Invalid value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`;
			const reason = stringConstraintReason(error);
			return reason === undefined ? base : `${base}: ${reason}`;
		}
		default: {
			const exhaustive: never = schema.kind;
			return exhaustive;
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
		...(schema.kind === 'number' || schema.kind === 'custom' ? { expected: schema.kind } : {}),
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
	if (schema.kind === 'number' || schema.kind === 'custom') {
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
		return source.kind === 'env'
			? `Set ${source.envVar} to one of: ${allowedList}`
			: `Provide one of: ${allowedList}`;
	}

	return undefined;
}

/** Coerce a string value from stdin/env into the type declared by an arg schema, redacting raw values in error diagnostics. */
function coerceArgStringValue(
	argName: string,
	source: ArgStringSource,
	raw: string,
	schema: ArgSchema,
): CoerceResult {
	const coerced = coerceSharedPropertyValue(
		argName,
		argSourceToCoerceSource(source),
		raw,
		toSharedArgPropertySchema(schema),
	);
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

export type { CoerceResult };
export { coerceArgStringValue, coerceValue };
