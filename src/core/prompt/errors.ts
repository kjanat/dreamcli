/** Structured interaction errors shared by prompt sessions and runtime readers.
 * @module dreamcli/core/prompt/errors
 */
import { CLIError } from '#internals/core/errors/index.ts';

/** The user stopped an interaction. Unlike a skipped schema prompt, this aborts execution. */
export class PromptCancelledError extends CLIError {
	/** Structured error class name. */
	override readonly name = 'PromptCancelledError';
	/** Cancellation source, when available from the engine. */
	readonly reason: 'interrupt' | 'escape' | 'eof' | 'cancel';

	/** Create an interaction cancellation with the conventional interrupt exit code. */
	constructor(reason: PromptCancelledError['reason'] = 'cancel') {
		super('Prompt cancelled', { code: 'PROMPT_CANCELLED', exitCode: 130, details: { reason } });
		this.reason = reason;
	}
}
