/**
 * Internal flag resolution helpers.
 *
 * @module dreamcli/core/resolve/flags
 * @internal
 */

import { ValidationError } from '#internals/core/errors/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import { resolvePromptConfig } from '#internals/core/prompt/index.ts';
import type { ErasedInteractiveResolver } from '#internals/core/schema/command.ts';
import type { FlagKind, FlagSchema } from '#internals/core/schema/flag.ts';
import type { PromptConfig, PromptKind } from '#internals/core/schema/prompt.ts';
import { coerceValue } from './coerce.ts';
import { resolveConfigPath } from './config.ts';
import type { DeprecationWarning } from './contracts.ts';
import { isNonEmpty, throwAggregatedErrors } from './errors.ts';

type PromptResolveResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError | undefined };

/**
 * Filesystem probe injected by the caller for `flag.path()` checks.
 *
 * Returns what exists at the path, or `null` when nothing does.
 */
type StatFn = (path: string) => Promise<'file' | 'directory' | null>;

/** Recursive directory creation injected by the caller for `flag.path()` `create` checks. */
type MkdirFn = (path: string) => Promise<void>;

/** Walk every declared flag through the resolution chain (cli -> env -> config -> prompt -> default), collecting deprecations and throwing aggregated errors. */
async function resolveFlags(
	flagSchemas: Readonly<Record<string, FlagSchema>>,
	parsedFlags: Readonly<Record<string, unknown>>,
	env: Readonly<Record<string, string | undefined>>,
	config: Readonly<Record<string, unknown>>,
	prompter: PromptEngine | undefined,
	interactive: ErasedInteractiveResolver | undefined,
	deprecations: DeprecationWarning[],
	stat: StatFn | undefined,
	mkdir: MkdirFn | undefined,
): Promise<Readonly<Record<string, unknown>>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];
	const hardErrorFlags = new Set<string>();

	for (const [name, schema] of Object.entries(flagSchemas)) {
		const hasParsedValue = Object.hasOwn(parsedFlags, name);
		const parsedValue = parsedFlags[name];

		if (hasParsedValue && parsedValue !== undefined) {
			if (schema.deprecated !== undefined) {
				deprecations.push({ kind: 'flag', name, message: schema.deprecated });
			}
			resolved[name] = parsedValue;
			continue;
		}

		if (schema.envVar !== undefined) {
			const envValue = Object.hasOwn(env, schema.envVar) ? env[schema.envVar] : undefined;
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
	}

	const interactiveConfigs =
		interactive !== undefined ? interactive({ flags: resolved }) : undefined;

	for (const [name, schema] of Object.entries(flagSchemas)) {
		if (Object.hasOwn(resolved, name) || hardErrorFlags.has(name)) {
			continue;
		}

		// A flag named after an Object.prototype member would otherwise read that
		// inherited method as an override.
		const interactiveConfig =
			interactiveConfigs !== undefined && Object.hasOwn(interactiveConfigs, name)
				? interactiveConfigs[name]
				: undefined;

		let effectivePromptConfig: PromptConfig | undefined;
		// `interactiveConfig === false` explicitly disables prompts for this flag.
		// Other falsy values mean "no override", so we fall back to `schema.prompt`.
		if (
			interactiveConfig !== undefined &&
			interactiveConfig !== null &&
			interactiveConfig !== false &&
			interactiveConfig !== 0 &&
			interactiveConfig !== ''
		) {
			effectivePromptConfig = interactiveConfig;
		} else if (interactiveConfig === false) {
			effectivePromptConfig = undefined;
		} else {
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
		}

		if (schema.defaultValue !== undefined) {
			resolved[name] = schema.defaultValue;
			continue;
		}

		if (schema.kind === 'array' && schema.presence !== 'required') {
			resolved[name] = [];
			continue;
		}

		if (schema.kind === 'keyValue' && schema.presence !== 'required') {
			resolved[name] = {};
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

		resolved[name] = undefined;
	}

	// Post-resolution pass — rules that apply to the final value regardless
	// of which source produced it (CLI, env, config, prompt, or default).
	for (const [name, schema] of Object.entries(flagSchemas)) {
		const value = resolved[name];

		if (schema.kind === 'array' && schema.unique && Array.isArray(value)) {
			resolved[name] = [...new Set(value)];
		}

		if (schema.pathChecks !== undefined && typeof value === 'string' && stat !== undefined) {
			const violation = await validatePathChecks(name, value, schema.pathChecks, stat, mkdir);
			if (violation !== undefined) {
				errors.push(violation);
			}
		}
	}

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return resolved;
}

/**
 * Check a resolved path value against its declared filesystem expectations.
 *
 * @returns `undefined` when the path satisfies the checks, or a
 * {@link ValidationError} with code `'CONSTRAINT_VIOLATED'` otherwise.
 * @internal
 */
async function validatePathChecks(
	flagName: string,
	value: string,
	checks: NonNullable<FlagSchema['pathChecks']>,
	stat: StatFn,
	mkdir: MkdirFn | undefined,
): Promise<ValidationError | undefined> {
	const found = await stat(value);
	if (found === null) {
		if (checks.create && mkdir !== undefined) {
			try {
				await mkdir(value);
				return undefined;
			} catch (error) {
				return new ValidationError(
					`Failed to create directory '${value}' for flag --${flagName}: ${
						error instanceof Error ? error.message : String(error)
					}`,
					{
						code: 'CONSTRAINT_VIOLATED',
						details: { flag: flagName, value, constraint: 'create' },
						suggest: `Provide a creatable or existing directory path for --${flagName}`,
					},
				);
			}
		}
		if (!checks.mustExist) return undefined;
		return new ValidationError(`Path '${value}' for flag --${flagName} does not exist`, {
			code: 'CONSTRAINT_VIOLATED',
			details: { flag: flagName, value, constraint: 'mustExist' },
			suggest: `Provide an existing path for --${flagName}`,
		});
	}
	if (checks.type !== undefined && found !== checks.type) {
		return new ValidationError(
			`Path '${value}' for flag --${flagName} is a ${found}, expected a ${checks.type}`,
			{
				code: 'CONSTRAINT_VIOLATED',
				details: { flag: flagName, value, constraint: 'pathType', expected: checks.type },
				suggest: `Provide a ${checks.type} path for --${flagName}`,
			},
		);
	}
	return undefined;
}

/** Maps each flag kind to the prompt kinds that produce compatible values. */
const COMPATIBLE_PROMPT_KINDS: Record<FlagKind, readonly PromptKind[]> = {
	boolean: ['confirm'],
	string: ['input', 'select'],
	number: ['input'],
	enum: ['select', 'input'],
	array: ['multiselect'],
	custom: ['input', 'select', 'confirm', 'multiselect'],
	count: [],
	keyValue: [],
};

/**
 * Check whether a prompt kind is compatible with the flag's declared kind.
 *
 * @returns `undefined` when compatible, or a {@link ValidationError} with
 * code `'CONSTRAINT_VIOLATED'` and an actionable `suggest` message when not.
 * @internal
 */
function validatePromptFlagCompatibility(
	flagName: string,
	flagKind: FlagKind,
	promptKind: PromptKind,
): ValidationError | undefined {
	const allowed = COMPATIBLE_PROMPT_KINDS[flagKind];
	if (allowed.includes(promptKind)) return undefined;

	const first = allowed[0];
	if (first === undefined) {
		return new ValidationError(
			`Prompt kind '${promptKind}' is not compatible with ${flagKind} flag --${flagName}. ${flagKind} flags are not promptable`,
			{
				code: 'CONSTRAINT_VIOLATED',
				details: { flag: flagName, flagKind, promptKind, allowed },
				suggest: `Remove the prompt config for --${flagName}`,
			},
		);
	}

	return new ValidationError(
		`Prompt kind '${promptKind}' is not compatible with ${flagKind} flag --${flagName}. Use '${first}' instead`,
		{
			code: 'CONSTRAINT_VIOLATED',
			details: { flag: flagName, flagKind, promptKind, allowed },
			suggest: `Change the prompt to { kind: '${first}' } for --${flagName}`,
		},
	);
}

/**
 * Validate prompt/flag compatibility, run the prompt engine, and coerce the result.
 *
 * Returns early with a {@link ValidationError} if the prompt kind is
 * incompatible with the flag kind (checked via {@link COMPATIBLE_PROMPT_KINDS}
 * before the prompter is invoked).
 * @internal
 */
async function resolvePromptValueWithConfig(
	flagName: string,
	schema: FlagSchema,
	promptConfig: PromptConfig,
	prompter: PromptEngine,
): Promise<PromptResolveResult> {
	const mismatch = validatePromptFlagCompatibility(flagName, schema.kind, promptConfig.kind);
	if (mismatch !== undefined) {
		return { ok: false, error: mismatch };
	}

	const resolvedConfig = resolvePromptConfig(promptConfig, schema.enumValues);
	const result = await prompter.promptOne(resolvedConfig);

	if (!result.answered) {
		return { ok: false, error: undefined };
	}

	// An empty/blank `input` answer with no prompt-level default is not a real
	// answer — fall through (ok: false) so resolution reaches the flag's
	// `.default()`. When a prompt-level default exists, the prompt engine has
	// already applied it (so the value is the default, not blank), giving it
	// precedence over the flag default.
	if (
		promptConfig.kind === 'input' &&
		promptConfig.default === undefined &&
		typeof result.value === 'string' &&
		result.value.trim() === ''
	) {
		return { ok: false, error: undefined };
	}

	return coerceValue(flagName, { kind: 'prompt' }, result.value, schema);
}

/** Build a human-readable suggestion listing all available sources for a required flag. @internal */
function buildRequiredFlagSuggest(name: string, schema: FlagSchema): string {
	const sources: string[] = [];
	const takesValue = schema.kind !== 'boolean' && schema.kind !== 'count';
	sources.push(`Provide --${name}${takesValue ? ' <value>' : ''}`);

	if (schema.envVar !== undefined) {
		sources.push(`set ${schema.envVar}`);
	}

	if (schema.configPath !== undefined) {
		sources.push(`add ${schema.configPath} to config`);
	}

	if (sources.length <= 1) {
		return sources.join('');
	}

	const rest = sources.slice(0, -1);
	const last = sources.slice(-1).join('');
	return sources.length === 2 ? `${rest.join('')} or ${last}` : `${rest.join(', ')}, or ${last}`;
}

export { COMPATIBLE_PROMPT_KINDS, resolveFlags };
