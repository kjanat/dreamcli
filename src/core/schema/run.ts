/**
 * Run result type — structured output from command execution.
 *
 * Lives in schema (not testkit) because it describes the execution contract
 * that `ErasedCommand._execute` returns. Both schema and testkit layers
 * reference it without dependency inversion.
 *
 * @module dreamcli/core/schema/run
 */

import type { CLIPlugin } from '#internals/core/cli/plugin.ts';
import type { CLIError } from '#internals/core/errors/index.ts';
import type { HelpOptions } from '#internals/core/help/index.ts';
import type { CapturedOutput, Verbosity } from '#internals/core/output/index.ts';
import type { PromptEngine, TestAnswer } from '#internals/core/prompt/index.ts';
import type { ActivityEvent } from './activity.ts';
import type { CommandMeta, CommandSchema, Out } from './command.ts';

/**
 * Options accepted by `runCommand()` and internal command execution paths.
 *
 * Every field is optional — sensible defaults are applied. This is the
 * primary process-free execution seam: inject env, config, prompt I/O, and
 * dispatch-layer metadata without touching process state.
 */
interface RunOptions {
	/**
	 * Environment variables for flag resolution.
	 *
	 * Flags with `.env('VAR')` configured resolve from this record
	 * when no CLI value is provided (CLI → env → config → prompt → default).
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;

	/**
	 * Configuration object for flag resolution.
	 *
	 * Flags with `.config('path')` configured resolve from this record
	 * when no CLI or env value is provided (CLI → env → config → prompt → default).
	 * Config is plain JSON — file loading is the caller's responsibility.
	 */
	readonly config?: Readonly<Record<string, unknown>>;

	/**
	 * Full stdin contents for args configured with `.stdin()`.
	 *
	 * Lets tests inject piped input without a runtime adapter.
	 */
	readonly stdinData?: string | null;

	/**
	 * Prompt engine for interactive flag resolution.
	 *
	 * When provided, flags with `.prompt()` configured that have no value
	 * after CLI/env/config resolution will be prompted interactively.
	 *
	 * When absent (and `answers` is also absent), prompting is skipped
	 * and resolution falls through to default/required.
	 *
	 * Takes precedence over `answers` when both are provided.
	 */
	readonly prompter?: PromptEngine;

	/**
	 * Pre-configured prompt answers for testing convenience.
	 *
	 * When provided, a test prompter is created from these answers via
	 * `createTestPrompter(answers)`. Each entry is consumed in order —
	 * use `PROMPT_CANCEL` to simulate cancellation.
	 *
	 * Ignored when an explicit `prompter` is provided.
	 */
	readonly answers?: readonly TestAnswer[];

	/**
	 * Verbosity level for the output channel.
	 * @defaultValue `'normal'`
	 */
	readonly verbosity?: Verbosity;

	/**
	 * Enable JSON output mode.
	 *
	 * When `true`, `log` and `info` messages are redirected to stderr
	 * so that stdout is reserved exclusively for structured {@linkcode Out.json | json()} output.
	 * Errors are also rendered as JSON to stderr.
	 *
	 * @defaultValue `false`
	 */
	readonly jsonMode?: boolean;

	/**
	 * Whether stdout is connected to a TTY.
	 *
	 * Handlers can check {@linkcode Out.isTTY | out.isTTY} to decide whether to emit decorative
	 * output (spinners, progress bars, ANSI codes). Defaults to `false`
	 * (safe default for tests — non-TTY until proven otherwise).
	 *
	 * @defaultValue `false`
	 */
	readonly isTTY?: boolean;

	/**
	 * Output channel override used by live CLI execution.
	 *
	 * @internal — `CLIBuilder.run()` passes a real output channel so activity renders to
	 * the terminal instead of being captured.
	 */
	readonly out?: Out;

	/**
	 * Capture buffers override paired with `out`.
	 *
	 * @internal — when omitted, `runCommand()` creates empty buffers for the
	 * returned {@linkcode RunResult} while writing directly to the provided `out`.
	 */
	readonly captured?: CapturedOutput;

	/**
	 * Help formatting options (width, binName).
	 * Used when `--help` is detected.
	 */
	readonly help?: HelpOptions;

	/**
	 * Command schema with propagated flags merged in.
	 *
	 * When provided, used for parsing and resolution instead of `cmd.schema`.
	 * Set by the CLI dispatch layer after collecting propagated flags from
	 * the command ancestry path.
	 *
	 * @internal — set by dispatch layer, not for public use.
	 */
	readonly mergedSchema?: CommandSchema;

	/**
	 * CLI program metadata passed to action handlers and middleware.
	 *
	 * When provided (by CLI dispatch layer), handlers receive this as `meta`.
	 * When absent (standalone `runCommand()`), a minimal meta is constructed
	 * from the command's own schema.
	 *
	 * @internal — populated by CLI dispatch, not for public use.
	 */
	readonly meta?: CommandMeta;

	/**
	 * CLI plugins registered on the parent `CLIBuilder`.
	 *
	 * @internal — threaded through from CLI dispatch.
	 */
	readonly plugins?: readonly CLIPlugin[];
}

/**
 * Structured result from running a command.
 *
 * Contains the exit code, captured stdout/stderr output, and an `error`
 * field that is `undefined` on success and populated on failure.
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
	 * {@linkcode Out.spinner | out.spinner()} or {@linkcode Out.progress | out.progress()} produce events here, enabling
	 * targeted assertions on activity lifecycle without parsing text.
	 */
	readonly activity: readonly ActivityEvent[];

	/**
	 * The error that caused a non-zero exit, or `undefined` on success.
	 * {@linkcode CLIError} instances are preserved; unknown errors are wrapped.
	 */
	readonly error: CLIError | undefined;
}

export type { RunOptions, RunResult };
