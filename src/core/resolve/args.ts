/**
 * Internal arg resolution helpers.
 *
 * @module dreamcli/core/resolve/args
 * @internal
 */

import { ValidationError } from '#internals/core/errors/index.ts';
import type { ArgSchema, CommandArgEntry } from '#internals/core/schema/index.ts';
import { coerceArgStringValue } from './coerce.ts';
import type { DeprecationWarning } from './contracts.ts';
import { isNonEmpty, throwAggregatedErrors } from './errors.ts';

/** Walk every declared arg through the resolution chain (cli -> stdin -> env -> default), collecting deprecations and throwing aggregated errors. */
function resolveArgs(
	argEntries: readonly CommandArgEntry[],
	parsedArgs: Readonly<Record<string, unknown>>,
	stdinData: string | null | undefined,
	env: Readonly<Record<string, string | undefined>>,
	deprecations: DeprecationWarning[],
): Readonly<Record<string, unknown>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];

	for (const entry of argEntries) {
		const { name, schema } = entry;
		const hasParsedValue = Object.hasOwn(parsedArgs, name);
		const parsedValue = parsedArgs[name];
		const usesCliValue =
			hasParsedValue &&
			parsedValue !== undefined &&
			(!schema.stdinMode || parsedValue !== '-') &&
			!(schema.variadic && Array.isArray(parsedValue) && parsedValue.length === 0);

		if (usesCliValue) {
			if (schema.deprecated !== undefined) {
				deprecations.push({ kind: 'arg', name, message: schema.deprecated });
			}
			resolved[name] = parsedValue;
			continue;
		}

		if (schema.stdinMode && (!hasParsedValue || parsedValue === undefined || parsedValue === '-')) {
			if (stdinData !== undefined && stdinData !== null) {
				const coerced = coerceArgStringValue(name, { kind: 'stdin' }, stdinData, schema);
				if (coerced.ok) {
					if (schema.deprecated !== undefined) {
						deprecations.push({ kind: 'arg', name, message: schema.deprecated });
					}
					resolved[name] = coerced.value;
					continue;
				}
				errors.push(coerced.error);
				continue;
			}
		}

		if (schema.envVar !== undefined) {
			const envValue = env[schema.envVar];
			if (envValue !== undefined) {
				const coerced = coerceArgStringValue(
					name,
					{ kind: 'env', envVar: schema.envVar },
					envValue,
					schema,
				);
				if (coerced.ok) {
					if (schema.deprecated !== undefined) {
						deprecations.push({ kind: 'arg', name, message: schema.deprecated });
					}
					resolved[name] = coerced.value;
					continue;
				}
				errors.push(coerced.error);
				continue;
			}
		}

		if (schema.defaultValue !== undefined) {
			resolved[name] = schema.defaultValue;
			continue;
		}

		if (schema.variadic) {
			if (schema.presence === 'required') {
				errors.push(
					new ValidationError(`Missing required argument <${name}>`, {
						code: 'REQUIRED_ARG',
						details: { arg: name, variadic: true },
						suggest: buildRequiredArgSuggest(name, schema, true),
					}),
				);
				continue;
			}
			resolved[name] = [];
			continue;
		}

		if (schema.presence === 'required') {
			errors.push(
				new ValidationError(`Missing required argument <${name}>`, {
					code: 'REQUIRED_ARG',
					details: { arg: name },
					suggest: buildRequiredArgSuggest(name, schema),
				}),
			);
			continue;
		}

		resolved[name] = undefined;
	}

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return resolved;
}

function buildRequiredArgSuggest(name: string, schema: ArgSchema, variadic?: boolean): string {
	const sources: [string, ...string[]] = [
		variadic ? `Provide at least one value for <${name}>` : `Provide a value for <${name}>`,
	];

	if (schema.stdinMode) {
		sources.push(`pipe a value to stdin or pass '-'`);
	}

	if (schema.envVar !== undefined) {
		sources.push(`set ${schema.envVar}`);
	}

	if (sources.length === 1) {
		return sources[0];
	}

	if (sources.length === 2) {
		return `${sources[0]} or ${sources[1]}`;
	}

	return `${sources.slice(0, -1).join(', ')}, or ${sources[sources.length - 1]}`;
}

export { resolveArgs };
