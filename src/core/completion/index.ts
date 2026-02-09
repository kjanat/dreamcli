/**
 * Shell completion script generation from command schemas.
 *
 * Defines the type contracts for shell completion generators. Each shell
 * has a dedicated generator function that takes a {@link CLISchema} and
 * returns a complete shell-specific completion script as a string.
 *
 * Current stubs throw — implementations land in subsequent tasks.
 *
 * @module dreamcli/core/completion
 */

import type { CLISchema } from '../cli/index.js';
import { CLIError } from '../errors/index.js';

// ---------------------------------------------------------------------------
// Shell type — supported completion targets
// ---------------------------------------------------------------------------

/**
 * Supported shell targets for completion script generation.
 *
 * `bash` and `zsh` are implemented first; `fish` and `powershell` are
 * declared for forward compatibility but throw on generation.
 */
type Shell = 'bash' | 'zsh' | 'fish' | 'powershell';

/** All shell values as a readonly tuple (useful for validation). */
const SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish', 'powershell'] as const;

// ---------------------------------------------------------------------------
// CompletionOptions — generator configuration
// ---------------------------------------------------------------------------

/**
 * Options for completion script generation.
 *
 * Passed to individual shell generators alongside the CLI schema.
 * Currently a placeholder — future options may include custom function
 * name prefixes, output style tweaks, etc.
 */
interface CompletionOptions {
	/**
	 * Override the function name prefix in generated scripts.
	 * Defaults to the CLI name from the schema.
	 */
	readonly functionPrefix?: string;
}

// ---------------------------------------------------------------------------
// Generator function signatures
// ---------------------------------------------------------------------------

/**
 * Generates a completion script for the given shell.
 *
 * @param schema - The CLI schema describing commands, flags, and args.
 * @param shell - Target shell.
 * @param options - Optional generator configuration.
 * @returns A complete shell completion script as a string.
 * @throws {CLIError} If the shell is not yet supported.
 */
function generateCompletion(schema: CLISchema, shell: Shell, options?: CompletionOptions): string {
	switch (shell) {
		case 'bash':
			return generateBashCompletion(schema, options);
		case 'zsh':
			return generateZshCompletion(schema, options);
		case 'fish':
		case 'powershell':
			throw new CLIError(`Shell completion for '${shell}' is not yet supported`, {
				code: 'UNSUPPORTED_OPERATION',
			});
	}
}

/**
 * Generates a bash completion script for the CLI.
 *
 * @param schema - The CLI schema.
 * @param options - Optional generator configuration.
 * @returns A complete bash completion script.
 */
function generateBashCompletion(schema: CLISchema, options?: CompletionOptions): string {
	void schema;
	void options;
	throw new CLIError('Bash completion generation is not yet implemented', {
		code: 'UNSUPPORTED_OPERATION',
	});
}

/**
 * Generates a zsh completion script for the CLI.
 *
 * @param schema - The CLI schema.
 * @param options - Optional generator configuration.
 * @returns A complete zsh completion script.
 */
function generateZshCompletion(schema: CLISchema, options?: CompletionOptions): string {
	void schema;
	void options;
	throw new CLIError('Zsh completion generation is not yet implemented', {
		code: 'UNSUPPORTED_OPERATION',
	});
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { generateBashCompletion, generateCompletion, generateZshCompletion, SHELLS };
export type { CompletionOptions, Shell };
