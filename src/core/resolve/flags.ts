/**
 * Internal flag resolution helpers.
 *
 * @module dreamcli/core/resolve/flags
 * @internal
 */

import { ValidationError } from '#internals/core/errors/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import { resolvePromptConfig } from '#internals/core/prompt/index.ts';
import { dedupe } from '#internals/core/schema/cardinality.ts';
import type {
	ErasedInteractiveResolver,
	InteractiveResult,
} from '#internals/core/schema/command.ts';
import type { FlagKind, FlagSchema } from '#internals/core/schema/flag.ts';
import type { PromptConfig, PromptKind } from '#internals/core/schema/prompt.ts';
import type { SourceBinding } from '#internals/core/schema/source.ts';
import {
	bindingsBeforePrompt,
	bindingsFromPrompt,
	sourceBindings,
	withPromptBinding,
} from '#internals/core/schema/source.ts';
import { flagValueSchema, valueEnumValues } from '#internals/core/schema/value.ts';
import { coerceValue, finishCliFlagValue } from './coerce.ts';
import type { DeprecationWarning, ResolutionProvenance } from './contracts.ts';
import { isNonEmpty, throwAggregatedErrors } from './errors.ts';
import type { MkdirFn, StatFn } from './path-checks.ts';
import { pathValuesOf, validatePathChecks } from './path-checks.ts';
import type { PromptOutcome, StageInput, StageOutcome, StageState } from './stages.ts';
import { readCliValue, runStages } from './stages.ts';

/** External state and collectors one flag-resolution pass shares. */
interface FlagResolutionOptions {
	/** Environment variable snapshot. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Parsed config file contents. */
	readonly config: Readonly<Record<string, unknown>>;
	/** Pre-read stdin content, or `null`/`undefined` when nothing was piped. */
	readonly stdinData: string | null | undefined;
	/** Interactive prompt engine, absent in non-TTY contexts. */
	readonly prompter: PromptEngine | undefined;
	/** Per-invocation prompt overrides declared by `.interactive()`. */
	readonly interactive: ErasedInteractiveResolver | undefined;
	/** Collector for notices produced by `.deprecated()` flags. */
	readonly deprecations: DeprecationWarning[];
	/** Filesystem probe for `flag.path()` checks. */
	readonly stat: StatFn | undefined;
	/** Directory creation for `flag.path()` `create` checks. */
	readonly mkdir: MkdirFn | undefined;
	/** Receiver for the stage that produced each resolved flag. */
	readonly provenance: Record<string, ResolutionProvenance>;
}

/**
 * Walk every declared flag through the resolution chain
 * (cli -> stdin -> env -> config -> prompt -> default), collecting deprecations
 * and throwing aggregated errors.
 *
 * The chain runs in two passes so `.interactive()` sees what the non-interactive
 * sources produced before it decides which flags to prompt for.
 *
 * @param flagSchemas - Declared flags keyed by canonical name.
 * @param parsedFlags - Values the parser read off argv.
 * @param options - External state and collectors for this pass.
 * @returns Fully resolved flag values keyed by flag name.
 */
async function resolveFlags(
	flagSchemas: Readonly<Record<string, FlagSchema>>,
	parsedFlags: Readonly<Record<string, unknown>>,
	options: FlagResolutionOptions,
): Promise<Readonly<Record<string, unknown>>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];
	const hardErrorFlags = new Set<string>();
	const state: StageState = {
		env: options.env,
		config: options.config,
		stdinData: options.stdinData,
		canPrompt: options.prompter !== undefined,
	};

	for (const [name, schema] of Object.entries(flagSchemas)) {
		const bindings = sourceBindings(schema);
		const outcome = await runStages(
			bindingsBeforePrompt(bindings),
			stageInput(name, schema, parsedFlags, bindings, options.prompter),
			state,
		);
		record(name, schema, outcome, resolved, errors, hardErrorFlags, options);
	}

	const interactiveConfigs =
		options.interactive !== undefined ? options.interactive({ flags: resolved }) : undefined;

	for (const [name, schema] of Object.entries(flagSchemas)) {
		if (Object.hasOwn(resolved, name) || hardErrorFlags.has(name)) {
			continue;
		}

		const bindings = withPromptBinding(
			sourceBindings(schema),
			effectivePromptConfig(name, schema, interactiveConfigs),
		);
		const outcome = await runStages(
			bindingsFromPrompt(bindings),
			stageInput(name, schema, parsedFlags, bindings, options.prompter),
			state,
		);
		record(name, schema, outcome, resolved, errors, hardErrorFlags, options);

		if (Object.hasOwn(resolved, name) || hardErrorFlags.has(name)) {
			continue;
		}

		if (schema.kind === 'array' && schema.presence !== 'required') {
			resolved[name] = [];
			options.provenance[name] = { stage: 'default' };
			continue;
		}

		if (schema.kind === 'keyValue' && schema.presence !== 'required') {
			resolved[name] = {};
			options.provenance[name] = { stage: 'default' };
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
	// of which source produced it.
	for (const [name, schema] of Object.entries(flagSchemas)) {
		// A flag whose resolution threw has no entry here, and a flag named
		// after an Object.prototype member would otherwise read that inherited
		// method as its resolved value.
		const value = Object.hasOwn(resolved, name) ? resolved[name] : undefined;
		const checks = flagValueSchema(schema).pathChecks;

		if (schema.kind === 'array' && schema.unique && Array.isArray(value)) {
			resolved[name] = [...dedupe(value)];
		}

		if (checks === undefined || options.stat === undefined) continue;

		for (const path of pathValuesOf(Object.hasOwn(resolved, name) ? resolved[name] : undefined)) {
			const violation = await validatePathChecks(
				{ kind: 'flag', name },
				path,
				checks,
				options.stat,
				options.mkdir,
			);
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

/** Assemble what one flag contributes to its own resolution. */
function stageInput(
	name: string,
	schema: FlagSchema,
	parsedFlags: Readonly<Record<string, unknown>>,
	bindings: readonly SourceBinding[],
	prompter: PromptEngine | undefined,
): StageInput {
	// A flag named after an Object.prototype member would otherwise read that
	// inherited method as a parsed value.
	const present = Object.hasOwn(parsedFlags, name);
	return {
		cli: readCliValue(present, present ? parsedFlags[name] : undefined, bindings),
		coerce: (source, raw) => coerceValue(name, source, raw, schema),
		finishCli: (value, stdinData) => finishCliFlagValue(name, schema, value, stdinData),
		runPrompt: async (config) =>
			prompter === undefined
				? { ok: false, error: undefined }
				: resolvePromptValueWithConfig(name, schema, config, prompter),
	};
}

/** Apply one stage walk's outcome to the resolution state. */
function record(
	name: string,
	schema: FlagSchema,
	outcome: StageOutcome,
	resolved: Record<string, unknown>,
	errors: ValidationError[],
	hardErrorFlags: Set<string>,
	options: FlagResolutionOptions,
): void {
	if (outcome.kind === 'error') {
		errors.push(outcome.error);
		hardErrorFlags.add(name);
		return;
	}
	if (outcome.kind === 'absent') return;

	if (schema.deprecated !== undefined && outcome.provenance.stage !== 'default') {
		options.deprecations.push({ kind: 'flag', name, message: schema.deprecated });
	}
	resolved[name] = outcome.value;
	options.provenance[name] = outcome.provenance;
}

/**
 * Pick the prompt config this invocation uses for a flag.
 *
 * `.interactive()` returning `false` disables the prompt outright; any other
 * falsy value means "no override" and leaves the schema's own config in place.
 */
function effectivePromptConfig(
	name: string,
	schema: FlagSchema,
	interactiveConfigs: InteractiveResult | undefined,
): PromptConfig | undefined {
	// A flag named after an Object.prototype member would otherwise read that
	// inherited method as an override.
	const override =
		interactiveConfigs !== undefined && Object.hasOwn(interactiveConfigs, name)
			? interactiveConfigs[name]
			: undefined;

	if (override === false) return undefined;
	if (override === undefined || override === null || override === 0 || override === '') {
		return schema.prompt;
	}
	return override;
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
): Promise<PromptOutcome> {
	const mismatch = validatePromptFlagCompatibility(flagName, schema.kind, promptConfig.kind);
	if (mismatch !== undefined) {
		return { ok: false, error: mismatch };
	}

	const resolvedConfig = resolvePromptConfig(
		promptConfig,
		valueEnumValues(flagValueSchema(schema)),
	);
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

	if (schema.stdin !== undefined) {
		sources.push(`pipe a value to stdin`);
	}

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

export type { FlagResolutionOptions };
export { COMPATIBLE_PROMPT_KINDS, resolveFlags };
