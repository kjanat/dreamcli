/**
 * Resolution chain: CLI -> env -> config -> prompt -> default.
 *
 * v0.1 implemented: **CLI parsed value -> default value**.
 * v0.2 adds: **env variable resolution** and **config object resolution**
 *   between CLI and default.
 * v0.3 adds: **prompt resolution** between config and default.
 *
 * The resolver takes raw {@linkcode ParseResult} (from the parser) and a
 * {@linkcode CommandSchema}, applies the resolution chain, and validates
 * that all required flags/args are present. On success it returns a
 * {@linkcode ResolveResult} with fully resolved values; on failure it throws
 * {@linkcode ValidationError}.
 *
 * @module dreamcli/core/resolve
 */

import { isValidationError, type ValidationError } from '#internals/core/errors/index.ts';
import type { ParseResult } from '#internals/core/parse/index.ts';
import type { CommandSchema } from '#internals/core/schema/index.ts';
import { resolveArgs } from './args.ts';
import type { DeprecationWarning, ResolveOptions, ResolveResult } from './contracts.ts';
import { collectValidationErrors, isNonEmpty, throwAggregatedErrors } from './errors.ts';
import { resolveFlags } from './flags.ts';

/**
 * Resolve parsed values against a command schema.
 *
 * Low-level API: most applications should rely on `cli().run()`, `.execute()`,
 * or `runCommand()`, which already call {@linkcode resolve} at the right time.
 * Reach for this function when testing precedence rules directly or building
 * custom execution flows around {@linkcode CommandSchema}.
 *
 * Resolution order:
 * 1. CLI parsed value (from {@linkcode ParseResult})
 * 2. Env variable (from {@linkcode ResolveOptions.env}, if flag declares `envVar`)
 * 3. Config value (from {@linkcode ResolveOptions.config}, if flag declares `configPath`)
 * 4. Prompt (from {@linkcode ResolveOptions.prompter}, if flag declares `prompt`)
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
 * @throws {@linkcode ValidationError} if any required flag or arg is missing,
 *   or if an env/config value fails coercion
 *
 * @example
 * ```ts
 * const parsed = parse(deploy.schema, ['production']);
 * const resolved = await resolve(deploy.schema, parsed, {
 *   env: { DEPLOY_REGION: 'eu' },
 * });
 * ```
 */
async function resolve(
	schema: CommandSchema,
	parsed: ParseResult,
	options?: ResolveOptions,
): Promise<ResolveResult> {
	const stdinData = options?.stdinData;
	const env = options?.env ?? {};
	const config = options?.config ?? {};
	const prompter = options?.prompter;
	const deprecations: DeprecationWarning[] = [];
	let flags: Readonly<Record<string, unknown>> = {};
	let args: Readonly<Record<string, unknown>> = {};
	const errors: ValidationError[] = [];

	try {
		flags = await resolveFlags(
			schema.flags,
			parsed.flags,
			env,
			config,
			prompter,
			schema.interactive,
			deprecations,
		);
	} catch (error) {
		if (!isValidationError(error)) {
			throw error;
		}
		errors.push(...collectValidationErrors(error));
	}

	try {
		args = resolveArgs(schema.args, parsed.args, stdinData, env, deprecations);
	} catch (error) {
		if (!isValidationError(error)) {
			throw error;
		}
		errors.push(...collectValidationErrors(error));
	}

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return { flags, args, deprecations };
}

export type { DeprecationWarning, ResolveOptions, ResolveResult };
export { resolve };
