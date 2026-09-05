/**
 * Shell completion script generation from command schemas.
 *
 * Each shell has a dedicated generator in `shells/` that takes a
 * {@link CLISchema} and returns a complete shell-specific completion
 * script as a string. Generators walk the full command tree depth,
 * including propagated flags from ancestor commands at each nesting level.
 *
 * @module dreamcli/core/completion
 */

import type { CLISchema } from '#internals/core/cli/index.ts';
import type { CompletionOptions, Shell } from './shell.ts';
import { generateBashCompletion } from './shells/bash.ts';
import { generateFishCompletion } from './shells/fish.ts';
import { generatePowerShellCompletion } from './shells/powershell.ts';
import { generateZshCompletion } from './shells/zsh.ts';

// --- Shell-agnostic dispatch

/**
 * Generate a completion script for the given shell.
 *
 * This is the primary completion entrypoint for most consumers. Pass a CLI
 * schema and target shell, then write the returned script to a file or source
 * it directly from the command line.
 *
 * @param schema - The CLI schema describing commands, flags, and args.
 * @param shell - Target shell.
 * @param options - Optional generator configuration such as function naming
 *   and root default-command completion behavior.
 * @returns A complete shell completion script as a string.
 *
 * @example
 * ```ts
 * const script = generateCompletion(app.schema, 'bash');
 * // e.g. source <(mycli completions bash)
 * ```
 */
function generateCompletion(schema: CLISchema, shell: Shell, options?: CompletionOptions): string {
	switch (shell) {
		case 'bash':
			return generateBashCompletion(schema, options);
		case 'zsh':
			return generateZshCompletion(schema, options);
		case 'fish':
			return generateFishCompletion(schema, options);
		case 'powershell':
			return generatePowerShellCompletion(schema, options);
	}
}

// --- Exports

export type { CompletionOptions, Shell } from './shell.ts';
export { detectShell, normalizeShell, SHELLS } from './shell.ts';
export {
	generateBashCompletion,
	generateCompletion,
	generateFishCompletion,
	generatePowerShellCompletion,
	generateZshCompletion,
};
