/**
 * Resolution chain: CLI -> env -> config -> prompt -> default.
 *
 * v0.1 implemented: **CLI parsed value -> default value**.
 * v0.2 adds: **env variable resolution** and **config object resolution**
 *   between CLI and default.
 * v0.3 adds: **prompt resolution** between config and default.
 *
 * The resolver takes raw `ParseResult` (from the parser) and a
 * `CommandSchema`, applies the resolution chain, and validates
 * that all required flags/args are present. On success it returns a
 * `ResolveResult` with fully resolved values; on failure it throws
 * `ValidationError`.
 *
 * @module dreamcli/core/resolve
 */

import type { ValidationErrorCode } from '../errors/index.ts';
import { ValidationError } from '../errors/index.ts';
import type { ParseResult } from '../parse/index.ts';
import type { PromptEngine } from '../prompt/index.ts';
import { resolvePromptConfig } from '../prompt/index.ts';
import type {
	CommandArgEntry,
	CommandSchema,
	ErasedInteractiveResolver,
	FlagSchema,
} from '../schema/index.ts';
import type { PromptConfig } from '../schema/prompt.ts';

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

	/**
	 * Prompt engine for interactive flag resolution.
	 *
	 * When provided, flags with `schema.prompt` configured that have no
	 * value after CLI/env/config resolution will be prompted interactively.
	 *
	 * When absent (or in non-interactive contexts), prompting is skipped
	 * and resolution falls through to default/required.
	 *
	 * @example
	 * ```ts
	 * resolve(schema, parsed, { prompter: createTestPrompter(['eu']) })
	 * ```
	 */
	readonly prompter?: PromptEngine;
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
	/**
	 * Deprecation notices for flags/args that were explicitly provided.
	 *
	 * Populated when a deprecated flag or arg receives a value from any
	 * explicit source (CLI, env, config, prompt). Not populated for
	 * default fallthrough.
	 *
	 * Consumers decide how to render these — the resolve layer provides
	 * structured data, not formatted strings.
	 */
	readonly deprecations: readonly DeprecationWarning[];
}

/**
 * Structured deprecation notice emitted when a deprecated flag or arg
 * is explicitly provided.
 *
 * Consumers (testkit, CLI layer) decide formatting. The resolve layer
 * only collects facts.
 */
interface DeprecationWarning {
	/** Whether the deprecated entity is a flag or a positional arg. */
	readonly kind: 'flag' | 'arg';
	/** Canonical name of the flag or arg. */
	readonly name: string;
	/**
	 * Deprecation reason/migration guidance, or `true` for generic
	 * deprecation with no specific message.
	 */
	readonly message: string | true;
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
 * 4. Prompt (from `ResolveOptions.prompter`, if flag declares `prompt`)
 * 5. Default value (from schema)
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
async function resolve(
	schema: CommandSchema,
	parsed: ParseResult,
	options?: ResolveOptions,
): Promise<ResolveResult> {
	const env = options?.env ?? {};
	const config = options?.config ?? {};
	const prompter = options?.prompter;
	const deprecations: DeprecationWarning[] = [];
	const flags = await resolveFlags(
		schema.flags,
		parsed.flags,
		env,
		config,
		prompter,
		schema.interactive,
		deprecations,
	);
	const args = resolveArgs(schema.args, parsed.args, deprecations);
	return { flags, args, deprecations };
}

// ---------------------------------------------------------------------------
// Flag resolution
// ---------------------------------------------------------------------------

/**
 * Resolve flag values: CLI -> env -> config -> interactive/prompt -> default,
 * then validate required.
 *
 * Two-pass approach when a command-level interactive resolver is present:
 *
 * **Pass 1 (all flags):** Resolve from CLI → env → config. Collect partially
 * resolved values and track which flags still need values.
 *
 * **Interactive resolver call:** If the command has an `.interactive()` resolver,
 * call it with the partially resolved flags. It returns prompt configs for
 * flags it wants to prompt, overriding/supplementing per-flag `.prompt()` configs.
 *
 * **Pass 2 (unresolved flags):** For each unresolved flag:
 * 1. If interactive resolver returned a `PromptConfig` for it → use that config
 * 2. Else if the flag has a per-flag `.prompt()` config → use it
 * 3. Else → fall through to default/required validation
 *
 * Without an interactive resolver, behaviour is identical to the single-pass
 * approach (per-flag prompt configs used directly).
 *
 * Array flags that were not provided and have no explicit default get
 * an empty array `[]` (more useful than `undefined` for consumers).
 */
async function resolveFlags(
	flagSchemas: Readonly<Record<string, FlagSchema>>,
	parsedFlags: Readonly<Record<string, unknown>>,
	env: Readonly<Record<string, string | undefined>>,
	config: Readonly<Record<string, unknown>>,
	prompter: PromptEngine | undefined,
	interactive: ErasedInteractiveResolver | undefined,
	deprecations: DeprecationWarning[],
): Promise<Readonly<Record<string, unknown>>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];

	// Track flags that had hard coercion errors during CLI/env/config — these
	// should NOT be prompted or defaulted (the error is authoritative).
	const hardErrorFlags = new Set<string>();

	// -- Pass 1: CLI → env → config -------------------------------------------
	for (const [name, schema] of Object.entries(flagSchemas)) {
		const parsedValue = parsedFlags[name];

		if (parsedValue !== undefined) {
			if (schema.deprecated !== undefined) {
				deprecations.push({ kind: 'flag', name, message: schema.deprecated });
			}
			resolved[name] = parsedValue;
			continue;
		}

		if (schema.envVar !== undefined) {
			const envValue = env[schema.envVar];
			if (envValue !== undefined) {
				const coerced = coerceValue(name, { kind: 'env', envVar: schema.envVar }, envValue, schema);
				if (coerced.ok) {
					if (schema.deprecated !== undefined) {
						deprecations.push({ kind: 'flag', name, message: schema.deprecated });
					}
					resolved[name] = coerced.value;
					continue;
				}
				errors.push(coerced.error);
				hardErrorFlags.add(name);
				continue;
			}
		}

		if (schema.configPath !== undefined) {
			const configValue = resolveConfigPath(config, schema.configPath);
			if (configValue !== undefined) {
				const coerced = coerceValue(
					name,
					{ kind: 'config', configPath: schema.configPath },
					configValue,
					schema,
				);
				if (coerced.ok) {
					if (schema.deprecated !== undefined) {
						deprecations.push({ kind: 'flag', name, message: schema.deprecated });
					}
					resolved[name] = coerced.value;
					continue;
				}
				errors.push(coerced.error);
				hardErrorFlags.add(name);
			}
		}

		// Not yet resolved — will be handled in pass 2
	}

	// -- Interactive resolver call (v0.3) ------------------------------------
	// Call the command-level interactive resolver with partially resolved flags.
	// It returns prompt configs for flags it wants prompted.
	const interactiveConfigs =
		interactive !== undefined ? interactive({ flags: resolved }) : undefined;

	// -- Pass 2: prompt → default → required ----------------------------------
	for (const [name, schema] of Object.entries(flagSchemas)) {
		// Already resolved in pass 1 or had a hard error
		if (name in resolved || hardErrorFlags.has(name)) {
			continue;
		}

		// Determine which prompt config to use for this flag:
		//
		// The interactive resolver returns a record where each key maps to:
		//   - a PromptConfig → use it (overrides per-flag)
		//   - `false` → explicitly suppress prompting for this flag
		//   - undefined/null (or key absent) → fall back to per-flag .prompt() config
		//
		// The `false` suppression matches the idiomatic `&&` pattern from the PRD:
		//   `region: !flags.region && { kind: 'select', ... }`
		// When `flags.region` is truthy, `&&` evaluates to `false`.
		const interactiveConfig = interactiveConfigs?.[name];

		let effectivePromptConfig: PromptConfig | undefined;
		if (
			interactiveConfig !== undefined &&
			interactiveConfig !== null &&
			interactiveConfig !== false &&
			interactiveConfig !== 0 &&
			interactiveConfig !== ''
		) {
			// Interactive returned a PromptConfig — use it
			effectivePromptConfig = interactiveConfig;
		} else if (interactiveConfig === false) {
			// Interactive explicitly returned false — suppress prompting
			effectivePromptConfig = undefined;
		} else {
			// undefined, null, 0, '', or not mentioned — fall back to per-flag
			effectivePromptConfig = schema.prompt;
		}

		if (effectivePromptConfig !== undefined && prompter !== undefined) {
			const promptResult = await resolvePromptValueWithConfig(
				name,
				schema,
				effectivePromptConfig,
				prompter,
			);
			if (promptResult.ok) {
				if (schema.deprecated !== undefined) {
					deprecations.push({ kind: 'flag', name, message: schema.deprecated });
				}
				resolved[name] = promptResult.value;
				continue;
			}
			if (promptResult.error !== undefined) {
				errors.push(promptResult.error);
				continue;
			}
			// Prompt was cancelled or not answered — fall through to default/required
		}

		if (schema.defaultValue !== undefined) {
			resolved[name] = schema.defaultValue;
			continue;
		}

		if (schema.kind === 'array') {
			resolved[name] = [];
			continue;
		}

		if (schema.presence === 'required') {
			const details: Record<string, unknown> = { flag: name, kind: schema.kind };
			if (schema.envVar !== undefined) details.envVar = schema.envVar;
			if (schema.configPath !== undefined) details.configPath = schema.configPath;
			errors.push(
				new ValidationError(`Missing required flag --${name}`, {
					code: 'REQUIRED_FLAG',
					details,
					suggest: buildRequiredFlagSuggest(name, schema),
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
// Prompt value resolution
// ---------------------------------------------------------------------------

/**
 * Result of attempting to resolve a flag value via prompting.
 *
 * Three outcomes:
 * - `ok: true` — prompt answered, value coerced successfully
 * - `ok: false, error: ValidationError` — prompt answered but coercion failed
 * - `ok: false, error: undefined` — prompt cancelled or not answered (fall through)
 */
type PromptResolveResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError | undefined };

/**
 * Prompt the user for a flag value using an explicit prompt config.
 *
 * Used by both per-flag prompt resolution and command-level interactive
 * resolver prompt resolution. The config may come from `schema.prompt`
 * or from the interactive resolver's returned prompt configs.
 *
 * Prepares a `ResolvedPromptConfig` (merging enum values from the flag
 * schema), calls the engine, and coerces the raw answer to the flag's
 * declared kind.
 *
 * @param flagName - Canonical flag name (for error messages)
 * @param schema - Flag schema declaring the expected kind
 * @param promptConfig - Prompt configuration to use
 * @param prompter - Prompt engine to call
 */
async function resolvePromptValueWithConfig(
	flagName: string,
	schema: FlagSchema,
	promptConfig: PromptConfig,
	prompter: PromptEngine,
): Promise<PromptResolveResult> {
	const resolvedConfig = resolvePromptConfig(promptConfig, schema.enumValues);
	const result = await prompter.promptOne(resolvedConfig);

	if (!result.answered) {
		// User cancelled — fall through to default/required
		return { ok: false, error: undefined };
	}

	// Coerce the prompt value to the flag's kind
	return coerceValue(flagName, { kind: 'prompt' }, result.value, schema);
}

// ---------------------------------------------------------------------------
// Required flag suggestion builder
// ---------------------------------------------------------------------------

/**
 * Build an actionable suggestion listing all configured resolution sources
 * for a required flag that was not provided.
 *
 * Generates CI-friendly hints like:
 * - `"Provide --region <value>, set DEPLOY_REGION, or add deploy.region to config"`
 * - `"Provide --force"` (boolean, no env/config)
 *
 * The ordering mirrors the resolution chain: CLI → env → config.
 */
function buildRequiredFlagSuggest(name: string, schema: FlagSchema): string {
	const sources: string[] = [];

	// CLI source (always present)
	sources.push(`Provide --${name}${schema.kind !== 'boolean' ? ' <value>' : ''}`);

	// Env source (if configured)
	if (schema.envVar !== undefined) {
		sources.push(`set ${schema.envVar}`);
	}

	// Config source (if configured)
	if (schema.configPath !== undefined) {
		sources.push(`add ${schema.configPath} to config`);
	}

	// Join with natural language connectors: "A", "A or B", "A, B, or C"
	if (sources.length <= 1) {
		return sources.join('');
	}
	const rest = sources.slice(0, -1);
	const last = sources.slice(-1).join('');
	return sources.length === 2 ? `${rest.join('')} or ${last}` : `${rest.join(', ')}, or ${last}`;
}

// ---------------------------------------------------------------------------
// Unified value coercion
// ---------------------------------------------------------------------------

/**
 * Describes the source of a raw value being coerced.
 *
 * Used to parameterize error messages, source-specific details, and
 * minor behavioral differences (prompt accepts 'y'/'n', trims array
 * elements) in the unified {@link coerceValue} function.
 */
type CoerceSource =
	| { readonly kind: 'env'; readonly envVar: string }
	| { readonly kind: 'config'; readonly configPath: string }
	| { readonly kind: 'prompt' };

/**
 * Result of attempting to coerce a raw value to a flag's declared kind.
 *
 * Two-state discriminated union: `ok: true` carries the coerced value,
 * `ok: false` carries a `ValidationError` describing the mismatch.
 *
 * The prompt caller wraps this in a three-state result at its own call
 * site (adding the `error: undefined` "cancelled" case).
 */
type CoerceResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError };

/** Format a source label for error messages (e.g. "from env MY_VAR", "from config deploy.region"). */
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

/** Build source-specific detail keys for error objects. */
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

/** Build a coercion error with source-aware message and details. */
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
 * Coerce a raw value to the flag's declared kind.
 *
 * Unified coercion for all three resolution sources (env, config, prompt).
 * Behavioral differences are parameterized by the {@link CoerceSource}:
 *
 * - **String leniency**: env input is always `string` (passthrough); config
 *   accepts `number | boolean` via `String()`; prompt accepts anything.
 * - **Boolean truthy/falsy**: prompt additionally accepts `'y'` / `'n'`.
 * - **Number NaN guard**: unconditional on numeric input (fixes a latent
 *   bug where prompt previously lacked this check).
 * - **Array trim**: prompt trims whitespace after comma-split.
 *
 * @param flagName - Canonical flag name (for error messages)
 * @param source - Where the raw value came from (env/config/prompt)
 * @param raw - Raw value to coerce
 * @param schema - Flag schema declaring the expected kind
 */
function coerceValue(
	flagName: string,
	source: CoerceSource,
	raw: unknown,
	schema: FlagSchema,
): CoerceResult {
	switch (schema.kind) {
		case 'string': {
			if (typeof raw === 'string') return { ok: true, value: raw };
			// Env input is always string — non-string paths only apply to config/prompt
			if (source.kind === 'prompt') return { ok: true, value: String(raw) };
			if (source.kind === 'config' && (typeof raw === 'number' || typeof raw === 'boolean')) {
				return { ok: true, value: String(raw) };
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
				// Guard against NaN on numeric input (all sources)
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
				return { ok: true, value: raw };
			}
			if (typeof raw === 'string') {
				const n = Number(raw);
				if (!Number.isNaN(n)) return { ok: true, value: n };
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
			if (schema.parseFn) {
				try {
					return { ok: true, value: schema.parseFn(raw) };
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
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
			return { ok: true, value: raw };
		}

		case 'array': {
			// Accept actual arrays (config/prompt may provide these)
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
			// Comma-separated string splitting
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
					value: source.kind === 'prompt' ? parts.map((p) => p.trim()) : parts,
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
	deprecations: DeprecationWarning[],
): Readonly<Record<string, unknown>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];

	for (const entry of argEntries) {
		const { name, schema } = entry;
		const parsedValue = parsedArgs[name];

		if (parsedValue !== undefined) {
			if (schema.deprecated !== undefined) {
				deprecations.push({ kind: 'arg', name, message: schema.deprecated });
			}
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
export type { DeprecationWarning, ResolveOptions, ResolveResult };
