/**
 * Run result type — structured output from command execution.
 *
 * Lives in schema (not testkit) because it describes the execution contract
 * that `ErasedCommand._execute` returns. Both schema and testkit layers
 * reference it without dependency inversion.
 *
 * @module dreamcli/core/schema/run
 */

import type { CLIError } from '#internals/core/errors/index.ts';
import type { ActivityEvent } from './activity.ts';

/**
 * Structured result from running a command.
 *
 * Contains the exit code, captured stdout/stderr output, and optionally
 * the error that caused a non-zero exit.
 */
interface RunResult {
	/** Process exit code. 0 = success. */
	readonly exitCode: number;

	/** Captured stdout lines (from `out.log` and `out.info`). */
	readonly stdout: readonly string[];

	/** Captured stderr lines (from `out.warn` and `out.error`). */
	readonly stderr: readonly string[];

	/**
	 * Captured spinner and progress lifecycle events.
	 *
	 * Recorded separately from stdout/stderr — handlers that call
	 * `out.spinner()` or `out.progress()` produce events here, enabling
	 * targeted assertions on activity lifecycle without parsing text.
	 */
	readonly activity: readonly ActivityEvent[];

	/**
	 * The error that caused a non-zero exit, if any.
	 * `CLIError` instances are preserved; unknown errors are wrapped.
	 */
	readonly error: CLIError | undefined;
}

export type { RunResult };
