/**
 * Fish completion script generator (not yet implemented).
 *
 * @module dreamcli/core/completion/shells/fish
 * @internal
 */

import type { CLISchema } from '#internals/core/cli/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import type { CompletionOptions } from './shared.ts';

/**
 * Generates a fish completion script for the CLI.
 *
 * @throws {CLIError} Always — fish completions are not yet implemented.
 */
function generateFishCompletion(_schema: CLISchema, _options?: CompletionOptions): string {
	throw new CLIError("Shell completion for 'fish' is not yet supported", {
		code: 'UNSUPPORTED_OPERATION',
		suggest: 'Supported shells: bash, zsh',
	});
}

export { generateFishCompletion };
