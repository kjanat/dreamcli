/**
 * The ordered resolution stages both surfaces walk.
 *
 * A stage is one {@link SourceBinding} of the input being resolved, so the
 * bindings `schema/source.ts` projects are the structure this file consumes.
 * Each surface supplies only what it alone knows: how a parsed CLI value reads,
 * how a raw value coerces, and how a prompt runs.
 *
 * @module dreamcli/core/resolve/stages
 * @internal
 */

import type { ValidationError } from '#internals/core/errors/index.ts';
import type { PromptConfig } from '#internals/core/schema/prompt.ts';
import type { SourceBinding } from '#internals/core/schema/source.ts';
import { STDIN_SENTINEL } from '#internals/core/schema/source.ts';
import { stdinReadsOnDash, stdinReadsWhenMissing } from '#internals/core/schema/stdin.ts';
import type { CliFinish, CoerceResult } from './coerce.ts';
import { resolveConfigPath } from './config.ts';
import type { DecodedDiagnosticSource, ResolutionProvenance } from './contracts.ts';

/** What the parser produced for one input in this invocation. */
type CliValue =
	| { readonly kind: 'value'; readonly value: unknown }
	| { readonly kind: 'dash' }
	| { readonly kind: 'absent' };

/** The outcome of one stage, or of a whole walk. */
type StageOutcome =
	| { readonly kind: 'value'; readonly value: unknown; readonly provenance: ResolutionProvenance }
	| { readonly kind: 'error'; readonly error: ValidationError }
	| { readonly kind: 'absent' };

/** A prompt run that either answered, failed, or declined to produce a value. */
type PromptOutcome =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError | undefined };

/** Everything one input contributes to its own resolution. */
interface StageInput {
	/** What the parser produced for this input. */
	readonly cli: CliValue;
	/** Decode a raw value from a non-CLI source into the input's declared type. */
	readonly coerce: (source: DecodedDiagnosticSource, raw: unknown) => CoerceResult;
	/**
	 * Aggregate what the parser produced, splicing the stdin buffer into the
	 * position each `-` occurrence holds.
	 */
	readonly finishCli: (value: unknown, stdinData: string | null | undefined) => CliFinish;
	/** Run the prompt engine for this input. */
	readonly runPrompt: (config: PromptConfig) => Promise<PromptOutcome>;
}

/** External state every stage reads from. */
interface StageState {
	/** Environment variable snapshot. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Parsed config file contents. */
	readonly config: Readonly<Record<string, unknown>>;
	/** Pre-read stdin content, or `null`/`undefined` when nothing was piped. */
	readonly stdinData: string | null | undefined;
	/** Whether an interactive prompt engine is available. */
	readonly canPrompt: boolean;
}

const ABSENT: StageOutcome = { kind: 'absent' };

/**
 * Walk the given bindings in order and return the first one that produces a
 * value or an error.
 *
 * A coercion failure at any sourced stage stops the walk, so a bad env value
 * never silently falls through to config.
 *
 * @param bindings - The sources to attempt, in precedence order.
 * @param input - The input being resolved.
 * @param state - External state the stages read.
 * @returns The winning stage's outcome, or `absent` when no stage produced one.
 */
async function runStages(
	bindings: readonly SourceBinding[],
	input: StageInput,
	state: StageState,
): Promise<StageOutcome> {
	for (const binding of bindings) {
		const outcome = await runStage(binding, input, state);
		if (outcome.kind !== 'absent') return outcome;
	}
	return ABSENT;
}

/** Attempt one binding. */
async function runStage(
	binding: SourceBinding,
	input: StageInput,
	state: StageState,
): Promise<StageOutcome> {
	switch (binding.stage) {
		case 'cli':
			return cliStage(input, state);
		case 'stdin':
			return stdinStage(binding, input, state);
		case 'env':
			return envStage(binding, input, state);
		case 'config':
			return configStage(binding, input, state);
		case 'prompt':
			return promptStage(binding, input, state);
		case 'default':
			return { kind: 'value', value: binding.defaultValue, provenance: { stage: 'default' } };
	}
}

/**
 * The CLI stage, including an explicit `-`.
 *
 * A `-` selects stdin while staying CLI-sourced, so it outranks every later
 * stage. When nothing was piped it produces no value and the walk continues,
 * leaving env, config, prompt, and the default reachable.
 */
function cliStage(input: StageInput, state: StageState): StageOutcome {
	if (input.cli.kind === 'dash') {
		const buffer = state.stdinData;
		if (typeof buffer !== 'string') return ABSENT;
		return coerced(input, { kind: 'stdin' }, buffer, {
			stage: 'cli',
			via: 'stdin',
			trigger: 'dash',
		});
	}
	if (input.cli.kind === 'value') {
		const finished = input.finishCli(input.cli.value, state.stdinData);
		if (finished.kind === 'absent') return ABSENT;
		if (finished.kind === 'error') return { kind: 'error', error: finished.error };
		return { kind: 'value', value: finished.value, provenance: cliProvenance(finished.viaStdin) };
	}
	return ABSENT;
}

/**
 * Name where a finished CLI value came from.
 *
 * A collection that spliced the buffer at a `-` occurrence is CLI-sourced with
 * some of its bytes from stdin, which is the record an explicit `-` produces
 * for a scalar. A literal `-` an input without a stdin binding collected is a
 * value like any other.
 *
 * @param viaStdin - Whether finishing the CLI value read the stdin buffer.
 * @returns The provenance record for the CLI stage.
 */
function cliProvenance(viaStdin: boolean): ResolutionProvenance {
	return viaStdin ? { stage: 'cli', via: 'stdin', trigger: 'dash' } : { stage: 'cli' };
}

/** The implicit stdin fallback, taken only by an input argv left absent. */
function stdinStage(
	binding: Extract<SourceBinding, { stage: 'stdin' }>,
	input: StageInput,
	state: StageState,
): StageOutcome {
	if (!stdinReadsWhenMissing(binding)) return ABSENT;
	if (input.cli.kind !== 'absent') return ABSENT;
	const buffer = state.stdinData;
	if (typeof buffer !== 'string') return ABSENT;
	return coerced(input, { kind: 'stdin' }, buffer, {
		stage: 'stdin',
		via: 'stdin',
		trigger: 'fallback',
	});
}

/** The environment stage. */
function envStage(
	binding: Extract<SourceBinding, { stage: 'env' }>,
	input: StageInput,
	state: StageState,
): StageOutcome {
	const envVar = binding.envVar;
	// An env var named after an Object.prototype member would otherwise read
	// that inherited method as a supplied value.
	const raw = Object.hasOwn(state.env, envVar) ? state.env[envVar] : undefined;
	if (raw === undefined) return ABSENT;
	return coerced(input, { kind: 'env', envVar }, raw, { stage: 'env', envVar });
}

/** The config-file stage. */
function configStage(
	binding: Extract<SourceBinding, { stage: 'config' }>,
	input: StageInput,
	state: StageState,
): StageOutcome {
	const configPath = binding.configPath;
	const raw = resolveConfigPath(state.config, configPath);
	if (raw === undefined) return ABSENT;
	return coerced(input, { kind: 'config', configPath }, raw, { stage: 'config', configPath });
}

/** The interactive stage. */
async function promptStage(
	binding: Extract<SourceBinding, { stage: 'prompt' }>,
	input: StageInput,
	state: StageState,
): Promise<StageOutcome> {
	if (!state.canPrompt) return ABSENT;
	const result = await input.runPrompt(binding.prompt);
	if (result.ok) {
		return { kind: 'value', value: result.value, provenance: { stage: 'prompt' } };
	}
	return result.error === undefined ? ABSENT : { kind: 'error', error: result.error };
}

/** Decode a raw value and attach the stage's provenance on success. */
function coerced(
	input: StageInput,
	source: DecodedDiagnosticSource,
	raw: unknown,
	provenance: ResolutionProvenance,
): StageOutcome {
	const result = input.coerce(source, raw);
	return result.ok
		? { kind: 'value', value: result.value, provenance }
		: { kind: 'error', error: result.error };
}

/**
 * How the parser's record reads for one input.
 *
 * A `-` counts as the stdin selector only when the input declares a stdin
 * binding that reacts to it; otherwise it is the literal string the user typed.
 *
 * @param present - Whether the parser produced an own key for this input.
 * @param value - The parsed value.
 * @param bindings - The input's source list.
 * @returns What the CLI stage should do with it.
 */
function readCliValue(
	present: boolean,
	value: unknown,
	bindings: readonly SourceBinding[],
): CliValue {
	if (!present || value === undefined) return { kind: 'absent' };
	const readsOnDash = bindings.some(
		(binding) => binding.stage === 'stdin' && stdinReadsOnDash(binding),
	);
	if (value === STDIN_SENTINEL && readsOnDash) return { kind: 'dash' };
	return { kind: 'value', value };
}

export type { CliValue, PromptOutcome, StageInput, StageOutcome, StageState };
export { readCliValue, runStages };
