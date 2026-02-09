/**
 * Resolution chain: CLI -> env -> config -> prompt -> default.
 *
 * MVP (v0.1) implements only: **CLI parsed value -> default value**.
 * Env, config, and prompt resolution are deferred to v0.2/v0.3.
 *
 * The resolver takes raw `ParseResult` (from the parser) and a
 * `CommandSchema`, applies defaults for missing values, and validates
 * that all required flags/args are present. On success it returns a
 * `ResolveResult` with fully resolved values; on failure it throws
 * `ValidationError`.
 *
 * @module dreamcli/core/resolve
 */

import { ValidationError } from '../errors/index.js';
import type { ParseResult } from '../parse/index.js';
import type { CommandArgEntry, CommandSchema, FlagSchema } from '../schema/index.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Fully resolved flag and arg values — guaranteed present for required
 * and defaulted entries.
 *
 * At runtime the maps are `Record<string, unknown>` because the generic
 * type info lives in the builder phantom types, not here. Type narrowing
 * happens at the `CommandBuilder.action()` boundary via `InferFlags`/
 * `InferArgs`.
 */
interface ResolveResult {
	/** Resolved flag values keyed by canonical flag name. */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Resolved arg values keyed by arg name. */
	readonly args: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve parsed values against a command schema.
 *
 * Resolution order (v0.1 MVP):
 * 1. CLI parsed value (from `ParseResult`)
 * 2. Default value (from schema)
 *
 * After resolution, validates that all required flags and args have
 * a value. Collects **all** validation errors before throwing, so the
 * user sees every missing field at once.
 *
 * @param schema - The command schema defining flags and args
 * @param parsed - Raw parsed values from the parser
 * @returns Fully resolved flag and arg values
 * @throws ValidationError if any required flag or arg is missing
 */
function resolve(schema: CommandSchema, parsed: ParseResult): ResolveResult {
	const flags = resolveFlags(schema.flags, parsed.flags);
	const args = resolveArgs(schema.args, parsed.args);
	return { flags, args };
}

// ---------------------------------------------------------------------------
// Flag resolution
// ---------------------------------------------------------------------------

/**
 * Resolve flag values: apply defaults, validate required.
 *
 * For each declared flag in the schema:
 * 1. If the parser produced a value → use it
 * 2. Else if the schema has a default → use it
 * 3. Else if required → collect a validation error
 * 4. Else (optional) → leave absent (`undefined` when accessed)
 *
 * Array flags that were not provided and have no explicit default get
 * an empty array `[]` (more useful than `undefined` for consumers).
 */
function resolveFlags(
	flagSchemas: Readonly<Record<string, FlagSchema>>,
	parsedFlags: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];

	for (const [name, schema] of Object.entries(flagSchemas)) {
		const parsedValue = parsedFlags[name];

		if (parsedValue !== undefined) {
			// CLI provided a value — use it directly
			resolved[name] = parsedValue;
			continue;
		}

		if (schema.defaultValue !== undefined) {
			// Schema default available
			resolved[name] = schema.defaultValue;
			continue;
		}

		if (schema.kind === 'array') {
			// Array flags default to [] when not provided and no explicit default
			resolved[name] = [];
			continue;
		}

		if (schema.presence === 'required') {
			errors.push(
				new ValidationError(`Missing required flag --${name}`, {
					code: 'REQUIRED_FLAG',
					details: { flag: name, kind: schema.kind },
					suggest: `Provide --${name}${schema.kind !== 'boolean' ? ' <value>' : ''}`,
				}),
			);
			continue;
		}

		// Optional with no default — explicitly set undefined so the key exists
		// in the result object (consistent shape for consumers)
		resolved[name] = undefined;
	}

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return resolved;
}

// ---------------------------------------------------------------------------
// Arg resolution
// ---------------------------------------------------------------------------

/**
 * Resolve arg values: apply defaults, validate required.
 *
 * For each declared arg in the schema (ordered):
 * 1. If the parser produced a value → use it
 * 2. Else if the schema has a default → use it
 * 3. Else if variadic with no value → use `[]`
 * 4. Else if required → collect a validation error
 * 5. Else (optional) → leave absent (`undefined` when accessed)
 */
function resolveArgs(
	argEntries: readonly CommandArgEntry[],
	parsedArgs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];

	for (const entry of argEntries) {
		const { name, schema } = entry;
		const parsedValue = parsedArgs[name];

		if (parsedValue !== undefined) {
			// For variadic args, the parser produces an array. An empty array
			// means "present but no values" — still valid unless required checks.
			if (schema.variadic && Array.isArray(parsedValue) && parsedValue.length === 0) {
				// Variadic with zero values — check if required
				if (schema.presence === 'required') {
					errors.push(
						new ValidationError(`Missing required argument <${name}>`, {
							code: 'REQUIRED_ARG',
							details: { arg: name, variadic: true },
							suggest: `Provide at least one value for <${name}>`,
						}),
					);
					continue;
				}
				resolved[name] = [];
				continue;
			}
			resolved[name] = parsedValue;
			continue;
		}

		if (schema.defaultValue !== undefined) {
			resolved[name] = schema.defaultValue;
			continue;
		}

		if (schema.variadic) {
			// Variadic with no parsed values and no default → empty array
			// (unless required — then error)
			if (schema.presence === 'required') {
				errors.push(
					new ValidationError(`Missing required argument <${name}>`, {
						code: 'REQUIRED_ARG',
						details: { arg: name, variadic: true },
						suggest: `Provide at least one value for <${name}>`,
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
					suggest: `Provide a value for <${name}>`,
				}),
			);
			continue;
		}

		// Optional with no default
		resolved[name] = undefined;
	}

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return resolved;
}

// ---------------------------------------------------------------------------
// Type narrowing helpers
// ---------------------------------------------------------------------------

/** Narrow a plain array to a non-empty tuple. */
function isNonEmpty<T>(arr: readonly T[]): arr is readonly [T, ...T[]] {
	return arr.length > 0;
}

// ---------------------------------------------------------------------------
// Error aggregation
// ---------------------------------------------------------------------------

/**
 * Throw a single `ValidationError` that aggregates multiple missing-value
 * errors. The first error's code is used as the primary; all errors are
 * listed in `details.errors` for programmatic access.
 *
 * If there's exactly one error, throw it directly (no wrapping overhead).
 */
function throwAggregatedErrors(errors: readonly [ValidationError, ...ValidationError[]]): never {
	if (errors.length === 1) {
		throw errors[0];
	}

	const messages = errors.map((e) => e.message);
	throw new ValidationError(`Multiple validation errors:\n  - ${messages.join('\n  - ')}`, {
		code: errors[0].code,
		details: {
			errors: errors.map((e) => e.toJSON()),
			count: errors.length,
		},
		suggest: 'Fix all missing required values listed above',
	});
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { resolve };
export type { ResolveResult };
