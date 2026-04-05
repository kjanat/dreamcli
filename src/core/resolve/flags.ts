/**
 * Internal flag resolution helpers.
 *
 * @module dreamcli/core/resolve/flags
 * @internal
 */

import { ValidationError } from '#internals/core/errors/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import { resolvePromptConfig } from '#internals/core/prompt/index.ts';
import type { ErasedInteractiveResolver, FlagSchema } from '#internals/core/schema/index.ts';
import type { PromptConfig } from '#internals/core/schema/prompt.ts';
import { coerceValue } from './coerce.ts';
import { resolveConfigPath } from './config.ts';
import type { DeprecationWarning } from './contracts.ts';
import { isNonEmpty, throwAggregatedErrors } from './errors.ts';

type PromptResolveResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError | undefined };

/** Walk every declared flag through the resolution chain (cli -> env -> config -> prompt -> default), collecting deprecations and throwing aggregated errors. */
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
	}

	const interactiveConfigs =
		interactive !== undefined ? interactive({ flags: resolved }) : undefined;

	for (const [name, schema] of Object.entries(flagSchemas)) {
		if (Object.hasOwn(resolved, name) || hardErrorFlags.has(name)) {
			continue;
		}

		const interactiveConfig = interactiveConfigs?.[name];

		let effectivePromptConfig: PromptConfig | undefined;
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

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return resolved;
}

async function resolvePromptValueWithConfig(
	flagName: string,
	schema: FlagSchema,
	promptConfig: PromptConfig,
	prompter: PromptEngine,
): Promise<PromptResolveResult> {
	const resolvedConfig = resolvePromptConfig(promptConfig, schema.enumValues);
	const result = await prompter.promptOne(resolvedConfig);

	if (!result.answered) {
		return { ok: false, error: undefined };
	}

	return coerceValue(flagName, { kind: 'prompt' }, result.value, schema);
}

function buildRequiredFlagSuggest(name: string, schema: FlagSchema): string {
	const sources: string[] = [];
	sources.push(`Provide --${name}${schema.kind !== 'boolean' ? ' <value>' : ''}`);

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

export { resolveFlags };
