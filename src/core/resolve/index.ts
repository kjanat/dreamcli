/**
 * Resolution chain: CLI -> stdin -> env -> config -> prompt -> default.
 *
 * Flags and args walk the same ordered stages. An explicit `-` is CLI-sourced
 * with bytes from stdin and keeps CLI precedence; the `stdin` stage is the
 * implicit fallback an absent input takes before the environment.
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
import type {
	DeprecationWarning,
	ResolutionProvenance,
	ResolveOptions,
	ResolveResult,
} from './contracts.ts';
import { collectValidationErrors, isNonEmpty, throwAggregatedErrors } from './errors.ts';
import { resolveFlags } from './flags.ts';
import { applyStandardValidators } from './standard.ts';

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
 * 2. Stdin (from {@linkcode ResolveOptions.stdinData}, if the input declares `stdin`)
 * 3. Env variable (from {@linkcode ResolveOptions.env}, if the input declares `envVar`)
 * 4. Config value (from {@linkcode ResolveOptions.config}, if the input declares `configPath`)
 * 5. Prompt (from {@linkcode ResolveOptions.prompter}, if the input declares `prompt`)
 * 6. Default value (from schema)
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
	const deprecations: DeprecationWarning[] = [];
	const flagProvenance: Record<string, ResolutionProvenance> = {};
	const argProvenance: Record<string, ResolutionProvenance> = {};
	const shared = {
		env: options?.env ?? {},
		config: options?.config ?? {},
		stdinData: options?.stdinData,
		prompter: options?.prompter,
		deprecations,
		stat: options?.stat,
		mkdir: options?.mkdir,
	};
	let flags: Readonly<Record<string, unknown>> = {};
	let args: Readonly<Record<string, unknown>> = {};
	const errors: ValidationError[] = [];

	try {
		flags = await resolveFlags(schema.flags, parsed.flags, {
			...shared,
			interactive: schema.interactive,
			provenance: flagProvenance,
		});
	} catch (error) {
		if (!isValidationError(error)) {
			throw error;
		}
		errors.push(...collectValidationErrors(error));
	}

	try {
		args = await resolveArgs(schema.args, parsed.args, {
			...shared,
			provenance: argProvenance,
		});
	} catch (error) {
		if (!isValidationError(error)) {
			throw error;
		}
		errors.push(...collectValidationErrors(error));
	}

	const validated = await applyStandardValidators(schema, flags, args);
	flags = validated.flags;
	args = validated.args;
	errors.push(...validated.errors);

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return {
		flags,
		args,
		deprecations,
		provenance: { flags: flagProvenance, args: argProvenance },
	};
}

export type { DeprecationWarning, ResolutionProvenance, ResolveOptions, ResolveResult };
export { resolve };
