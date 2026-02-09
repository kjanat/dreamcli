/**
 * Resolution chain: CLI -> env -> config -> prompt -> default.
 *
 * v0.1 implemented: **CLI parsed value -> default value**.
 * v0.2 adds: **env variable resolution** and **config object resolution**
 *   between CLI and default. Prompt resolution deferred to v0.3.
 *
 * The resolver takes raw `ParseResult` (from the parser) and a
 * `CommandSchema`, applies the resolution chain, and validates
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
// Resolve options — injectable external state for the resolution chain
// ---------------------------------------------------------------------------

/**
 * Options controlling the resolution chain.
 *
 * These provide external state (env vars, config objects) that the resolver
 * reads from when CLI-provided values are absent.
 */
interface ResolveOptions {
	/**
	 * Environment variables to resolve against.
	 *
	 * For each flag with `schema.envVar` set, the resolver looks up the
	 * env var value here. Values are coerced to the flag's declared kind.
	 *
	 * @example
	 * ```ts
	 * resolve(schema, parsed, { env: { DEPLOY_REGION: 'eu' } })
	 * ```
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;

	/**
	 * Configuration object to resolve against.
	 *
	 * For each flag with `schema.configPath` set, the resolver looks up the
	 * value at the dotted path (e.g. `'deploy.region'`). Config values may
	 * already be typed (number, boolean, array) so coercion is lenient —
	 * only validates kind compatibility rather than string-parsing.
	 *
	 * Config is plain JSON — file loading is the caller's responsibility.
	 *
	 * @example
	 * ```ts
	 * resolve(schema, parsed, { config: { deploy: { region: 'eu' } } })
	 * ```
	 */
	readonly config?: Readonly<Record<string, unknown>>;
}

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
 * Resolution order:
 * 1. CLI parsed value (from `ParseResult`)
 * 2. Env variable (from `ResolveOptions.env`, if flag declares `envVar`)
 * 3. Config value (from `ResolveOptions.config`, if flag declares `configPath`)
 * 4. Default value (from schema)
 *
 * After resolution, validates that all required flags and args have
 * a value. Collects **all** validation errors before throwing, so the
 * user sees every missing field at once.
 *
 * @param schema - The command schema defining flags and args
 * @param parsed - Raw parsed values from the parser
 * @param options - External state for the resolution chain
 * @returns Fully resolved flag and arg values
 * @throws ValidationError if any required flag or arg is missing,
 *   or if an env/config value fails coercion
 */
function resolve(
	schema: CommandSchema,
	parsed: ParseResult,
	options?: ResolveOptions,
): ResolveResult {
	const env = options?.env ?? {};
	const config = options?.config ?? {};
	const flags = resolveFlags(schema.flags, parsed.flags, env, config);
	const args = resolveArgs(schema.args, parsed.args);
	return { flags, args };
}

// ---------------------------------------------------------------------------
// Flag resolution
// ---------------------------------------------------------------------------

/**
 * Resolve flag values: CLI -> env -> config -> default, then validate required.
 *
 * For each declared flag in the schema:
 * 1. If the parser produced a value → use it
 * 2. Else if the flag has an `envVar` and the env contains it → coerce and use
 * 3. Else if the flag has a `configPath` and the config contains it → coerce and use
 * 4. Else if the schema has a default → use it
 * 5. Else if array kind → use `[]`
 * 6. Else if required → collect a validation error
 * 7. Else (optional) → leave absent (`undefined` when accessed)
 *
 * Array flags that were not provided and have no explicit default get
 * an empty array `[]` (more useful than `undefined` for consumers).
 */
function resolveFlags(
	flagSchemas: Readonly<Record<string, FlagSchema>>,
	parsedFlags: Readonly<Record<string, unknown>>,
	env: Readonly<Record<string, string | undefined>>,
	config: Readonly<Record<string, unknown>>,
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

		// -- Env resolution (v0.2) -----------------------------------------------
		if (schema.envVar !== undefined) {
			const envValue = env[schema.envVar];
			if (envValue !== undefined) {
				const coerced = coerceEnvValue(name, schema.envVar, envValue, schema);
				if (coerced.ok) {
					resolved[name] = coerced.value;
					continue;
				}
				// Env value present but invalid — this is a hard error
				errors.push(coerced.error);
				continue;
			}
		}

		// -- Config resolution (v0.2) --------------------------------------------
		if (schema.configPath !== undefined) {
			const configValue = resolveConfigPath(config, schema.configPath);
			if (configValue !== undefined) {
				const coerced = coerceConfigValue(name, schema.configPath, configValue, schema);
				if (coerced.ok) {
					resolved[name] = coerced.value;
					continue;
				}
				// Config value present but invalid — this is a hard error
				errors.push(coerced.error);
				continue;
			}
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
// Env value coercion
// ---------------------------------------------------------------------------

/**
 * Result of attempting to coerce an env variable string to a flag's kind.
 *
 * Discriminated union: `ok: true` carries the coerced value,
 * `ok: false` carries a `ValidationError` describing the mismatch.
 */
type CoerceEnvResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError };

/**
 * Coerce a raw env variable string to the flag's declared kind.
 *
 * Returns a discriminated result rather than throwing, so the caller
 * can collect multiple errors before surfacing them.
 *
 * @param flagName - Canonical flag name (for error messages)
 * @param envVar - Env variable name (for error messages)
 * @param raw - Raw env string value
 * @param schema - Flag schema declaring the expected kind
 */
function coerceEnvValue(
	flagName: string,
	envVar: string,
	raw: string,
	schema: FlagSchema,
): CoerceEnvResult {
	switch (schema.kind) {
		case 'string':
			return { ok: true, value: raw };

		case 'number': {
			const n = Number(raw);
			if (Number.isNaN(n)) {
				return {
					ok: false,
					error: new ValidationError(
						`Invalid number value '${raw}' from env ${envVar} for flag --${flagName}`,
						{
							code: 'TYPE_MISMATCH',
							details: { flag: flagName, envVar, value: raw, expected: 'number' },
							suggest: `Set ${envVar} to a valid number`,
						},
					),
				};
			}
			return { ok: true, value: n };
		}

		case 'boolean': {
			const lower = raw.toLowerCase();
			if (lower === 'true' || lower === '1' || lower === 'yes') {
				return { ok: true, value: true };
			}
			if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') {
				return { ok: true, value: false };
			}
			return {
				ok: false,
				error: new ValidationError(
					`Invalid boolean value '${raw}' from env ${envVar} for flag --${flagName}`,
					{
						code: 'TYPE_MISMATCH',
						details: { flag: flagName, envVar, value: raw, expected: 'boolean' },
						suggest: `Set ${envVar} to true/false, 1/0, or yes/no`,
					},
				),
			};
		}

		case 'enum': {
			const allowed = schema.enumValues ?? [];
			if (!allowed.includes(raw)) {
				return {
					ok: false,
					error: new ValidationError(
						`Invalid value '${raw}' from env ${envVar} for flag --${flagName}. Allowed: ${allowed.join(', ')}`,
						{
							code: 'INVALID_ENUM',
							details: { flag: flagName, envVar, value: raw, allowed },
							suggest: `Set ${envVar} to one of: ${allowed.join(', ')}`,
						},
					),
				};
			}
			return { ok: true, value: raw };
		}

		case 'array': {
			// Env array values are comma-separated: "a,b,c" → ["a", "b", "c"]
			// Empty string → empty array
			if (raw === '') {
				return { ok: true, value: [] };
			}
			const parts = raw.split(',');
			if (schema.elementSchema) {
				// Coerce each element via the element schema
				const coerced: unknown[] = [];
				for (const part of parts) {
					const result = coerceEnvValue(flagName, envVar, part, schema.elementSchema);
					if (!result.ok) return result;
					coerced.push(result.value);
				}
				return { ok: true, value: coerced };
			}
			return { ok: true, value: parts };
		}
	}
}

// ---------------------------------------------------------------------------
// Config path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a dotted path against a nested config object.
 *
 * For path `'deploy.region'` and config `{ deploy: { region: 'eu' } }`,
 * returns `'eu'`. Returns `undefined` if any segment is missing or
 * a non-object intermediate is encountered.
 *
 * @param config - Root config object
 * @param path - Dotted path (e.g. `'deploy.region'`)
 */
function resolveConfigPath(config: Readonly<Record<string, unknown>>, path: string): unknown {
	const segments = path.split('.');
	let current: unknown = config;

	for (const segment of segments) {
		if (current === null || current === undefined || typeof current !== 'object') {
			return undefined;
		}
		// Safe indexed access on a plain object
		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

// ---------------------------------------------------------------------------
// Config value coercion
// ---------------------------------------------------------------------------

/**
 * Result of attempting to coerce a config value to a flag's kind.
 *
 * Same discriminated union as `CoerceEnvResult` — `ok: true` carries
 * the coerced value, `ok: false` carries a `ValidationError`.
 */
type CoerceConfigResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError };

/**
 * Coerce a config value to the flag's declared kind.
 *
 * Unlike env coercion, config values may already be correctly typed
 * (e.g. a number in JSON). The coercion is lenient for matching types
 * and stricter for mismatches:
 *
 * - **string flag**: accepts strings; coerces numbers/booleans via `String()`
 * - **number flag**: accepts numbers; coerces numeric strings
 * - **boolean flag**: accepts booleans; coerces common string representations
 * - **enum flag**: accepts strings that match allowed values
 * - **array flag**: accepts arrays (coerces elements); coerces comma-separated strings
 *
 * @param flagName - Canonical flag name (for error messages)
 * @param configPath - Dotted config path (for error messages)
 * @param raw - Raw config value (may be any JSON type)
 * @param schema - Flag schema declaring the expected kind
 */
function coerceConfigValue(
	flagName: string,
	configPath: string,
	raw: unknown,
	schema: FlagSchema,
): CoerceConfigResult {
	switch (schema.kind) {
		case 'string': {
			if (typeof raw === 'string') return { ok: true, value: raw };
			if (typeof raw === 'number' || typeof raw === 'boolean') {
				return { ok: true, value: String(raw) };
			}
			return {
				ok: false,
				error: new ValidationError(
					`Invalid string value from config ${configPath} for flag --${flagName}`,
					{
						code: 'TYPE_MISMATCH',
						details: { flag: flagName, configPath, value: raw, expected: 'string' },
						suggest: `Set ${configPath} to a string in your config`,
					},
				),
			};
		}

		case 'number': {
			if (typeof raw === 'number') {
				if (Number.isNaN(raw)) {
					return {
						ok: false,
						error: new ValidationError(
							`Invalid number value NaN from config ${configPath} for flag --${flagName}`,
							{
								code: 'TYPE_MISMATCH',
								details: { flag: flagName, configPath, value: raw, expected: 'number' },
								suggest: `Set ${configPath} to a valid number in your config`,
							},
						),
					};
				}
				return { ok: true, value: raw };
			}
			if (typeof raw === 'string') {
				const n = Number(raw);
				if (!Number.isNaN(n)) return { ok: true, value: n };
			}
			return {
				ok: false,
				error: new ValidationError(
					`Invalid number value from config ${configPath} for flag --${flagName}`,
					{
						code: 'TYPE_MISMATCH',
						details: { flag: flagName, configPath, value: raw, expected: 'number' },
						suggest: `Set ${configPath} to a valid number in your config`,
					},
				),
			};
		}

		case 'boolean': {
			if (typeof raw === 'boolean') return { ok: true, value: raw };
			if (typeof raw === 'string') {
				const lower = raw.toLowerCase();
				if (lower === 'true' || lower === '1' || lower === 'yes') {
					return { ok: true, value: true };
				}
				if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') {
					return { ok: true, value: false };
				}
			}
			return {
				ok: false,
				error: new ValidationError(
					`Invalid boolean value from config ${configPath} for flag --${flagName}`,
					{
						code: 'TYPE_MISMATCH',
						details: { flag: flagName, configPath, value: raw, expected: 'boolean' },
						suggest: `Set ${configPath} to true or false in your config`,
					},
				),
			};
		}

		case 'enum': {
			const allowed = schema.enumValues ?? [];
			if (typeof raw === 'string' && allowed.includes(raw)) {
				return { ok: true, value: raw };
			}
			return {
				ok: false,
				error: new ValidationError(
					`Invalid value '${String(raw)}' from config ${configPath} for flag --${flagName}. Allowed: ${allowed.join(', ')}`,
					{
						code: 'INVALID_ENUM',
						details: { flag: flagName, configPath, value: raw, allowed },
						suggest: `Set ${configPath} to one of: ${allowed.join(', ')}`,
					},
				),
			};
		}

		case 'array': {
			// Config arrays may be actual arrays (JSON) or comma-separated strings
			if (Array.isArray(raw)) {
				if (schema.elementSchema) {
					const coerced: unknown[] = [];
					for (const element of raw) {
						const result = coerceConfigValue(flagName, configPath, element, schema.elementSchema);
						if (!result.ok) return result;
						coerced.push(result.value);
					}
					return { ok: true, value: coerced };
				}
				return { ok: true, value: raw };
			}
			if (typeof raw === 'string') {
				// Comma-separated string fallback (same as env)
				if (raw === '') return { ok: true, value: [] };
				const parts = raw.split(',');
				if (schema.elementSchema) {
					const coerced: unknown[] = [];
					for (const part of parts) {
						const result = coerceConfigValue(flagName, configPath, part, schema.elementSchema);
						if (!result.ok) return result;
						coerced.push(result.value);
					}
					return { ok: true, value: coerced };
				}
				return { ok: true, value: parts };
			}
			return {
				ok: false,
				error: new ValidationError(
					`Invalid array value from config ${configPath} for flag --${flagName}`,
					{
						code: 'TYPE_MISMATCH',
						details: { flag: flagName, configPath, value: raw, expected: 'array' },
						suggest: `Set ${configPath} to an array in your config`,
					},
				),
			};
		}
	}
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
export type { ResolveOptions, ResolveResult };
