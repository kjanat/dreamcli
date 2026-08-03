/**
 * The source axis shared by the `flag` and `arg` factories.
 *
 * A flag or arg declares its sources through flat fields (`stdin`, `envVar`,
 * `configPath`, `prompt`, `defaultValue`). {@link sourceBindings} normalizes
 * those into one ordered {@link SourceBinding} list in {@link RESOLUTION_ORDER}
 * order, and `resolve/stages.ts` walks that list for both surfaces, so a stage
 * reads its settings off its own binding rather than off the schema.
 *
 * @module dreamcli/core/schema/source
 * @internal
 */

import type { ArgSchema } from './arg.ts';
import type { FlagSchema } from './flag.ts';
import type { PromptConfig } from './prompt.ts';
import type { StdinBinding, StdinConsume, StdinWhen } from './stdin.ts';
import { stdinReadsOnDash, stdinReadsWhenMissing } from './stdin.ts';

/**
 * Ordered resolution stages, highest precedence first.
 *
 * Both surfaces walk this one list. An explicit `-` is CLI-sourced with bytes
 * from stdin, so it lands on `'cli'`; the `'stdin'` stage is the implicit
 * fallback an absent CLI value takes before env.
 */
const RESOLUTION_ORDER = ['cli', 'stdin', 'env', 'config', 'prompt', 'default'] as const;

/** One stage of {@link RESOLUTION_ORDER}. */
type ResolutionStage = (typeof RESOLUTION_ORDER)[number];

const PROMPT_RANK = RESOLUTION_ORDER.indexOf('prompt');

/** Position of a stage in {@link RESOLUTION_ORDER}. */
function stageRank(stage: ResolutionStage): number {
	return RESOLUTION_ORDER.indexOf(stage);
}

/** One declared source of a flag or an arg. */
type SourceBinding =
	| { readonly stage: 'cli' }
	| { readonly stage: 'stdin'; readonly when: StdinWhen; readonly consume: StdinConsume }
	| { readonly stage: 'env'; readonly envVar: string }
	| { readonly stage: 'config'; readonly configPath: string }
	| { readonly stage: 'prompt'; readonly prompt: PromptConfig }
	| { readonly stage: 'default'; readonly defaultValue: unknown };

/**
 * Project a flag or arg schema onto its source axis.
 *
 * Every input accepts CLI input, so the list always opens with `'cli'`. The
 * remaining entries appear in {@link RESOLUTION_ORDER} order, and only for the
 * sources the schema actually declares. The resolver walks this list, so a
 * source the list omits is a source no stage can produce.
 *
 * @param schema - The flag or arg schema to read.
 * @returns The declared sources, ordered by precedence.
 */
function sourceBindings(schema: FlagSchema | ArgSchema): readonly SourceBinding[] {
	const bindings: SourceBinding[] = [{ stage: 'cli' }];

	const stdin = schema.stdin;
	if (stdin !== undefined) {
		bindings.push({ stage: 'stdin', when: stdin.when, consume: stdin.consume });
	}
	if (schema.envVar !== undefined) {
		bindings.push({ stage: 'env', envVar: schema.envVar });
	}
	if (schema.configPath !== undefined) {
		bindings.push({ stage: 'config', configPath: schema.configPath });
	}
	if (schema.prompt !== undefined) {
		bindings.push({ stage: 'prompt', prompt: schema.prompt });
	}
	if (schema.defaultValue !== undefined) {
		bindings.push({ stage: 'default', defaultValue: schema.defaultValue });
	}

	return bindings;
}

/**
 * The bindings an interactive resolver has not yet had a say in.
 *
 * @param bindings - One input's source list.
 * @returns The entries ranked before `'prompt'`.
 */
function bindingsBeforePrompt(bindings: readonly SourceBinding[]): readonly SourceBinding[] {
	return bindings.filter((binding) => stageRank(binding.stage) < PROMPT_RANK);
}

/**
 * The bindings left once an interactive resolver has run.
 *
 * @param bindings - One input's source list.
 * @returns The entries ranked at or after `'prompt'`.
 */
function bindingsFromPrompt(bindings: readonly SourceBinding[]): readonly SourceBinding[] {
	return bindings.filter((binding) => stageRank(binding.stage) >= PROMPT_RANK);
}

/**
 * Replace the prompt binding with the config this invocation actually uses.
 *
 * `.interactive()` may hand a prompt to an input that declares none, or take
 * away the one it declares, so the effective list is per invocation rather than
 * per schema.
 *
 * @param bindings - One input's source list.
 * @param prompt - The prompt config to use, or `undefined` for no prompt.
 * @returns The list with its prompt binding set to `prompt`.
 */
function withPromptBinding(
	bindings: readonly SourceBinding[],
	prompt: PromptConfig | undefined,
): readonly SourceBinding[] {
	const rest = bindings.filter((binding) => binding.stage !== 'prompt');
	if (prompt === undefined) return rest;
	const after = rest.findIndex((binding) => stageRank(binding.stage) > PROMPT_RANK);
	const at = after === -1 ? rest.length : after;
	return [...rest.slice(0, at), { stage: 'prompt', prompt }, ...rest.slice(at)];
}

/** One stdin-enabled input of a command, named by the surface that declares it. */
interface StdinConsumer {
	/** Which surface declares the input. */
	readonly kind: 'flag' | 'arg';
	/** Canonical flag name or positional arg name. */
	readonly name: string;
	/** The input's stdin axis. */
	readonly stdin: StdinBinding;
}

/**
 * List the stdin consumers declared across a command's flags and args.
 *
 * @param flags - The command's flag schemas keyed by name.
 * @param args - The command's positional entries in declaration order.
 * @returns Every stdin-enabled input, flags first, then args in declaration order.
 */
function stdinConsumers(
	flags: Readonly<Record<string, FlagSchema>>,
	args: readonly { readonly name: string; readonly schema: ArgSchema }[],
): readonly StdinConsumer[] {
	const consumers: StdinConsumer[] = [];
	for (const [name, schema] of Object.entries(flags)) {
		if (schema.stdin !== undefined) consumers.push({ kind: 'flag', name, stdin: schema.stdin });
	}
	for (const { name, schema } of args) {
		if (schema.stdin !== undefined) consumers.push({ kind: 'arg', name, stdin: schema.stdin });
	}
	return consumers;
}

/** How a stdin consumer is spelled on the command line: `--out` or `<out>`. */
function stdinConsumerReference(consumer: Pick<StdinConsumer, 'kind' | 'name'>): string {
	return consumer.kind === 'flag' ? `--${consumer.name}` : `<${consumer.name}>`;
}

/** What a parser produced for one command, read structurally. */
interface ParsedInputs {
	/** Flag values keyed by canonical flag name. */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Positional values keyed by arg name. */
	readonly args: Readonly<Record<string, unknown>>;
}

/**
 * Whether this invocation will actually select a stdin source.
 *
 * A `'dash'` binding fires when its token is `-`. A `'missing'` binding fires
 * when argv left the input absent; env, config, prompt, and default do not
 * suppress it, because the stdin fallback outranks all four. Callers use this
 * to decide whether reading the stream is warranted at all.
 *
 * @param flags - Declared flags keyed by canonical name.
 * @param args - Declared positionals in CLI order.
 * @param parsed - What the parser read off argv.
 * @returns `true` when at least one input would read stdin.
 */
function invocationSelectsStdin(
	flags: Readonly<Record<string, FlagSchema>>,
	args: readonly { readonly name: string; readonly schema: ArgSchema }[],
	parsed: ParsedInputs,
): boolean {
	for (const [name, schema] of Object.entries(flags)) {
		// An input named after an Object.prototype member would otherwise read
		// that inherited method as a supplied value.
		const present = Object.hasOwn(parsed.flags, name);
		if (inputSelectsStdin(schema.stdin, present, present ? parsed.flags[name] : undefined)) {
			return true;
		}
	}

	for (const { name, schema } of args) {
		const present = Object.hasOwn(parsed.args, name);
		if (inputSelectsStdin(schema.stdin, present, present ? parsed.args[name] : undefined)) {
			return true;
		}
	}

	return false;
}

/** The stdin selector, which names a source rather than a value. */
const STDIN_SENTINEL = '-';

/**
 * Whether one input's stdin binding fires for the value argv left it.
 *
 * A collection keeps its occurrences in a list until resolution splices them,
 * so a `-` among them selects stdin exactly as a lone `-` does for a scalar.
 */
function inputSelectsStdin(
	stdin: StdinBinding | undefined,
	present: boolean,
	value: unknown,
): boolean {
	if (stdin === undefined) return false;
	if (!present || value === undefined) return stdinReadsWhenMissing(stdin);
	if (!stdinReadsOnDash(stdin)) return false;
	return Array.isArray(value) ? value.includes(STDIN_SENTINEL) : value === STDIN_SENTINEL;
}

export type { ParsedInputs, ResolutionStage, SourceBinding, StdinConsumer };
export {
	bindingsBeforePrompt,
	bindingsFromPrompt,
	invocationSelectsStdin,
	RESOLUTION_ORDER,
	sourceBindings,
	stdinConsumerReference,
	stdinConsumers,
	withPromptBinding,
};
