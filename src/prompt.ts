/**
 * Prompt engines.
 *
 * When stdin is a TTY and no prompter was injected, `CLIBuilder.run()` installs
 * a thin engine that imports the terminal prompter the first time a prompt is
 * presented; a run that never prompts never loads it. Import this module to
 * drive prompts from a custom host or to build a prompt engine of your own
 * against {@link PromptEngine}.
 *
 * @module @kjanat/dreamcli/prompt
 */

export type {
	PromptEngine,
	ReadFn,
	ResolvedMultiselectPromptConfig,
	ResolvedPromptConfig,
	ResolvedSelectPromptConfig,
} from './core/prompt/index.ts';
export { resolvePromptConfig } from './core/prompt/index.ts';
export { createTerminalPrompter } from './core/prompt/terminal.ts';
