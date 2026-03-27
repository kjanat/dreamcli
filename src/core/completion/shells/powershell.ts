/**
 * PowerShell completion script generator (not yet implemented).
 *
 * @module dreamcli/core/completion/shells/powershell
 * @internal
 */

import type { CLISchema } from '../../cli/index.ts';
import { CLIError } from '../../errors/index.ts';
import type { CompletionOptions } from './shared.ts';

/**
 * Generates a PowerShell completion script for the CLI.
 *
 * @throws {CLIError} Always — PowerShell completions are not yet implemented.
 */
function generatePowerShellCompletion(_schema: CLISchema, _options?: CompletionOptions): string {
	throw new CLIError("Shell completion for 'powershell' is not yet supported", {
		code: 'UNSUPPORTED_OPERATION',
		suggest: 'Supported shells: bash, zsh',
	});
}

export { generatePowerShellCompletion };
