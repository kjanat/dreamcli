/**
 * Prompt engines.
 *
 * `CLIBuilder.run()` loads the terminal prompter on demand when stdin is a
 * TTY. Import this module to drive prompts from a custom host or to build a
 * prompt engine of your own against {@link PromptEngine}.
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
