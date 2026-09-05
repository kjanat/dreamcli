/**
 * Shell completion script generation.
 *
 * Generates Bash, Zsh, Fish, and PowerShell completion scripts from a CLI
 * schema. `CLIBuilder.completions()` loads this module on demand, so import
 * it directly only to write scripts yourself or to drive completion from
 * custom tooling.
 *
 * @module @kjanat/dreamcli/completion
 */

export {
	generateBashCompletion,
	generateCompletion,
	generateFishCompletion,
	generatePowerShellCompletion,
	generateZshCompletion,
} from './core/completion/index.ts';
export type { CompletionOptions, Shell } from './core/completion/shell.ts';
export { SHELLS } from './core/completion/shell.ts';
