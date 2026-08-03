/**
 * Internal arg resolution helpers.
 *
 * @module dreamcli/core/resolve/args
 * @internal
 */

import { ValidationError } from '#internals/core/errors/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import { resolvePromptConfig } from '#internals/core/prompt/index.ts';
import { argCardinality, dedupe } from '#internals/core/schema/cardinality.ts';
import type { ArgSchema, CommandArgEntry } from '#internals/core/schema/index.ts';
import type { PromptConfig } from '#internals/core/schema/prompt.ts';
import type { SourceBinding } from '#internals/core/schema/source.ts';
import { sourceBindings } from '#internals/core/schema/source.ts';
import { argValueSchema, valueEnumValues } from '#internals/core/schema/value.ts';
import { coerceArgValue, finishCliArgValue } from './coerce.ts';
import type { DeprecationWarning, ResolutionProvenance } from './contracts.ts';
import { isNonEmpty, throwAggregatedErrors } from './errors.ts';
import { COMPATIBLE_PROMPT_KINDS } from './flags.ts';
import type { MkdirFn, StatFn } from './path-checks.ts';
import { pathValuesOf, validatePathChecks } from './path-checks.ts';
import type { PromptOutcome, StageInput, StageState } from './stages.ts';
import { readCliValue, runStages } from './stages.ts';

/** External state and collectors one arg-resolution pass shares. */
interface ArgResolutionOptions {
	/** Environment variable snapshot. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Parsed config file contents. */
	readonly config: Readonly<Record<string, unknown>>;
	/** Pre-read stdin content, or `null`/`undefined` when nothing was piped. */
	readonly stdinData: string | null | undefined;
	/** Interactive prompt engine, absent in non-TTY contexts. */
	readonly prompter: PromptEngine | undefined;
	/** Collector for notices produced by `.deprecated()` args. */
	readonly deprecations: DeprecationWarning[];
	/** Filesystem probe for `arg.path()` checks. */
	readonly stat: StatFn | undefined;
	/** Directory creation for `arg.path()` `create` checks. */
	readonly mkdir: MkdirFn | undefined;
	/** Receiver for the stage that produced each resolved arg. */
	readonly provenance: Record<string, ResolutionProvenance>;
}

/**
 * Walk every declared arg through the resolution chain
 * (cli -> stdin -> env -> config -> prompt -> default), collecting deprecations
 * and throwing aggregated errors.
 *
 * @param argEntries - Declared positionals in CLI order.
 * @param parsedArgs - Values the parser read off argv.
 * @param options - External state and collectors for this pass.
 * @returns Fully resolved arg values keyed by arg name.
 */
async function resolveArgs(
	argEntries: readonly CommandArgEntry[],
	parsedArgs: Readonly<Record<string, unknown>>,
	options: ArgResolutionOptions,
): Promise<Readonly<Record<string, unknown>>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];
	const state: StageState = {
		env: options.env,
		config: options.config,
		stdinData: options.stdinData,
		canPrompt: options.prompter !== undefined,
	};

	for (const { name, schema } of argEntries) {
		const bindings = sourceBindings(schema);
		const outcome = await runStages(
			bindings,
			stageInput(name, schema, parsedArgs, bindings, options.prompter),
			state,
		);

		if (outcome.kind === 'error') {
			errors.push(outcome.error);
			continue;
		}

		if (outcome.kind === 'value') {
			if (schema.deprecated !== undefined && outcome.provenance.stage !== 'default') {
				options.deprecations.push({ kind: 'arg', name, message: schema.deprecated });
			}
			resolved[name] = outcome.value;
			options.provenance[name] = outcome.provenance;
			continue;
		}

		const cardinality = argCardinality(schema);
		if (cardinality.kind === 'many' || cardinality.kind === 'entries') {
			if (schema.presence === 'required') {
				errors.push(
					new ValidationError(`Missing required argument <${name}>`, {
						code: 'REQUIRED_ARG',
						details: { arg: name, ...(schema.variadic ? { variadic: true } : {}) },
						suggest: buildRequiredArgSuggest(name, schema, schema.variadic),
					}),
				);
				continue;
			}
			resolved[name] = cardinality.kind === 'many' ? [] : {};
			options.provenance[name] = { stage: 'default' };
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

	for (const { name, schema } of argEntries) {
		if (!schema.unique) continue;
		const value = Object.hasOwn(resolved, name) ? resolved[name] : undefined;
		if (Array.isArray(value)) resolved[name] = [...dedupe(value)];
	}

	if (options.stat !== undefined) {
		for (const { name, schema } of argEntries) {
			const checks = argValueSchema(schema).pathChecks;
			if (checks === undefined) continue;

			for (const value of pathValuesOf(
				Object.hasOwn(resolved, name) ? resolved[name] : undefined,
			)) {
				const violation = await validatePathChecks(
					{ kind: 'arg', name },
					value,
					checks,
					options.stat,
					options.mkdir,
				);
				if (violation !== undefined) {
					errors.push(violation);
				}
			}
		}
	}

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return resolved;
}

/** Assemble what one arg contributes to its own resolution. */
function stageInput(
	name: string,
	schema: ArgSchema,
	parsedArgs: Readonly<Record<string, unknown>>,
	bindings: readonly SourceBinding[],
	prompter: PromptEngine | undefined,
): StageInput {
	// An arg named after an Object.prototype member would otherwise read that
	// inherited method as a supplied positional.
	const present = Object.hasOwn(parsedArgs, name);
	const parsedValue = present ? parsedArgs[name] : undefined;
	// A variadic arg that collected nothing is an absent positional, not an
	// empty CLI value, so the later stages stay reachable.
	const collectedNothing =
		schema.variadic && Array.isArray(parsedValue) && parsedValue.length === 0;

	return {
		cli: collectedNothing ? { kind: 'absent' } : readCliValue(present, parsedValue, bindings),
		coerce: (source, raw) => coerceArgValue(name, source, raw, schema),
		finishCli: (value, stdinData) => finishCliArgValue(name, schema, value, stdinData),
		runPrompt: async (config) =>
			prompter === undefined
				? { ok: false, error: undefined }
				: resolveArgPromptValue(name, schema, config, prompter),
	};
}

/**
 * Validate prompt/arg compatibility, run the prompt engine, and coerce the result.
 *
 * The compatibility table is the one flags use; every arg kind is also a flag
 * kind, so the two surfaces accept the same prompt kinds for the same value.
 * @internal
 */
async function resolveArgPromptValue(
	argName: string,
	schema: ArgSchema,
	promptConfig: PromptConfig,
	prompter: PromptEngine,
): Promise<PromptOutcome> {
	const allowed = COMPATIBLE_PROMPT_KINDS[schema.kind];
	if (!allowed.includes(promptConfig.kind)) {
		const first = allowed[0];
		return {
			ok: false,
			error: new ValidationError(
				`Prompt kind '${promptConfig.kind}' is not compatible with ${schema.kind} argument <${argName}>. Use '${String(first)}' instead`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						arg: argName,
						argKind: schema.kind,
						promptKind: promptConfig.kind,
						allowed,
					},
					suggest: `Change the prompt to { kind: '${String(first)}' } for <${argName}>`,
				},
			),
		};
	}

	const resolvedConfig = resolvePromptConfig(promptConfig, valueEnumValues(argValueSchema(schema)));
	const result = await prompter.promptOne(resolvedConfig);

	if (!result.answered) {
		return { ok: false, error: undefined };
	}

	// A blank `input` answer with no prompt-level default is not a real answer,
	// so resolution falls through to the arg's `.default()`.
	if (
		promptConfig.kind === 'input' &&
		promptConfig.default === undefined &&
		typeof result.value === 'string' &&
		result.value.trim() === ''
	) {
		return { ok: false, error: undefined };
	}

	return coerceArgValue(argName, { kind: 'prompt' }, result.value, schema);
}

function buildRequiredArgSuggest(name: string, schema: ArgSchema, variadic?: boolean): string {
	const sources: [string, ...string[]] = [
		variadic ? `Provide at least one value for <${name}>` : `Provide a value for <${name}>`,
	];

	const stdin = schema.stdin;
	if (stdin !== undefined) {
		sources.push(
			stdin.when === 'dash'
				? `pass '-' to read stdin`
				: stdin.when === 'missing'
					? `pipe a value to stdin`
					: `pipe a value to stdin or pass '-'`,
		);
	}

	if (schema.envVar !== undefined) {
		sources.push(`set ${schema.envVar}`);
	}

	if (schema.configPath !== undefined) {
		sources.push(`add ${schema.configPath} to config`);
	}

	if (sources.length === 1) {
		return sources[0];
	}

	if (sources.length === 2) {
		return `${sources[0]} or ${sources[1]}`;
	}

	return `${sources.slice(0, -1).join(', ')}, or ${sources[sources.length - 1]}`;
}

export type { ArgResolutionOptions };
export { resolveArgs };
