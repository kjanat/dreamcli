/**
 * Internal resolver coercion helpers.
 *
 * @module dreamcli/core/resolve/coerce
 * @internal
 */

import type { ValidationErrorCode } from '#internals/core/errors/index.ts';
import { ValidationError } from '#internals/core/errors/index.ts';
import type { ArgSchema, FlagSchema } from '#internals/core/schema/index.ts';
import { buildZodSchema } from '#internals/core/schema/zod-kinds.ts';
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
				const parts = raw.split(',');
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
	}

	throw new Error(`Unreachable flag coercion kind: ${schema.kind}`);
}

function coerceSharedPropertyValue(
	flagName: string,
	source: CoerceSource,
	raw: unknown,
	schema: SharedPropertySchema,
): CoerceResult {
	switch (schema.kind) {
		case 'string': {
			// Source-specific normalization: prompt always stringifies; config
			// permits number/boolean → String(raw). The resulting value is then
			// validated by the canonical declared-type zod schema (z.string()).
			const normalized =
				source.kind === 'prompt' ||
				(source.kind === 'config' && (typeof raw === 'number' || typeof raw === 'boolean'))
					? String(raw)
					: raw;
			const parsed = buildZodSchema('string').safeParse(normalized);
			if (parsed.success) return { ok: true, value: parsed.data };
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
			// Source-specific normalization: numeric strings coerce to Number
			// before the canonical z.number() schema (which rejects NaN) decides.
			const normalized = typeof raw === 'string' ? Number(raw) : raw;
			const parsed = buildZodSchema('number').safeParse(normalized);
			if (parsed.success) return { ok: true, value: parsed.data };
			return coercionError(
				flagName,
				source,
				'TYPE_MISMATCH',
				'number',
				raw,
				typeof raw === 'number'
					? 'Invalid number value NaN'
					: typeof raw === 'string'
						? `Invalid number value '${raw}'`
						: 'Invalid number value',
				source.kind === 'env'
					? `Set ${source.envVar} to a valid number`
					: source.kind === 'config'
						? `Set ${source.configPath} to a valid number in your config`
						: `Enter a valid number for --${flagName}`,
			);
		}

		case 'enum': {
			const allowed = schema.enumValues ?? [];
			// z.enum(allowed) is the membership decision; falls back to z.string()
			// when no values are declared, which still rejects non-strings.
			const parsed = buildZodSchema('enum', { enumValues: allowed }).safeParse(raw);
			if (parsed.success && allowed.includes(parsed.data as string)) {
				return { ok: true, value: parsed.data };
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
	expected: 'number' | 'custom',
): string {
	if (source.kind === 'env') {
		return expected === 'number'
			? `Set ${source.envVar} to a valid number`
			: `Set ${source.envVar} to a valid value for <${argName}>`;
	}

	return expected === 'number'
		? `Pipe a valid number to stdin for <${argName}>`
		: `Pipe a valid value to stdin for <${argName}>`;
}

function argSourceToCoerceSource(source: ArgStringSource): CoerceSource {
	return source.kind === 'env' ? { kind: 'env', envVar: source.envVar } : { kind: 'prompt' };
}

function redactArgCoercionMessage(
	argName: string,
	source: ArgStringSource,
	schema: ArgSchema,
	error: ValidationError,
): string {
	switch (schema.kind) {
		case 'number':
			return `Invalid number value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`;
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
			return `Invalid value '<redacted>' ${argSourceLabel(source)} for argument <${argName}>`;
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
	return {
		arg: argName,
		...argSourceDetails(source),
		...(schema.kind === 'number' || schema.kind === 'custom' ? { expected: schema.kind } : {}),
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
