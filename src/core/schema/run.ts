/**
 * Run result type — structured output from command execution.
 *
 * Lives in schema (not testkit) because it describes the execution contract
 * the shared executor returns. Both schema and testkit layers reference it
 * without dependency inversion.
 *
 * @module dreamcli/core/schema/run
 */

import type { BuiltinsConfig } from '#internals/core/cli/builtins.ts';
import type { CLIPlugin } from '#internals/core/cli/plugin.ts';
import type { CLIError } from '#internals/core/errors/index.ts';
import type { HelpOptions } from '#internals/core/help/index.ts';
import type { CapturedOutput, Verbosity } from '#internals/core/output/index.ts';
// Type-only: erased at compile time, so the parse → schema module edge does
// not become a runtime import cycle.
import type { ParseOptions } from '#internals/core/parse/index.ts';
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
export interface RunOptions {
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
	 * Filesystem probe for `flag.path()` checks: reports what exists at a
	 * path (`'file'`, `'directory'`, or `null` for nothing).
	 *
	 * `CLIBuilder.run()` supplies the runtime adapter's probe automatically.
	 * When absent (process-free `.execute()` / `runCommand()` without an
	 * override), path checks are skipped.
	 */
	readonly stat?: (path: string) => Promise<'file' | 'directory' | null>;

	/**
	 * Recursive directory creation for `flag.path()` `create` checks.
	 *
	 * `CLIBuilder.run()` supplies the runtime adapter's implementation
	 * automatically. When absent, missing paths are not created.
	 */
	readonly mkdir?: (path: string) => Promise<void>;

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
	 * Framework-rendered errors are emitted as structured JSON to stdout.
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
	 * Help formatting options (width, binName).
	 * Used when `--help` is detected.
	 */
	readonly help?: HelpOptions;

	/**
	 * Flag-parsing behavior settings.
	 *
	 * `caseParity` accepts the kebab↔camel counterpart spelling of each flag
	 * name/alias (`--doThis` for `do-this`, and vice versa). The CLI layer
	 * threads `cli(name, { flags })` settings here automatically.
	 *
	 * @defaultValue `{ caseParity: true }`
	 */
	readonly flags?: ParseOptions;
}

/**
 * Execution options threaded between the CLI dispatch layer, the shared
 * executor, and the testkit. Extends the public {@linkcode RunOptions} with
 * fields the framework populates itself.
 *
 * @internal
 */
export interface InternalRunOptions extends RunOptions {
	/**
	 * Output channel override used by live CLI execution.
	 *
	 * `CLIBuilder.run()` passes a real output channel so activity renders to
	 * the terminal instead of being captured.
	 */
	readonly out?: Out;

	/**
	 * Capture buffers override paired with `out`.
	 *
	 * When omitted, `runCommand()` creates empty buffers for the returned
	 * {@linkcode RunResult} while writing directly to the provided `out`.
	 */
	readonly captured?: CapturedOutput;

	/**
	 * Command schema with propagated flags merged in.
	 *
	 * When provided, `runCommandInternal()` uses it for parsing and resolution
	 * instead of `cmd.schema`. CLI dispatch passes its merged schema straight to
	 * the shared executor and leaves this field unset.
	 */
	readonly mergedSchema?: CommandSchema;

	/**
	 * CLI program metadata passed to action handlers and middleware.
	 *
	 * When provided (by CLI dispatch layer), handlers receive this as `meta`.
	 * When absent (standalone `runCommand()`), a minimal meta is constructed
	 * from the command's own schema.
	 */
	readonly meta?: CommandMeta;

	/** CLI plugins registered on the parent `CLIBuilder`. */
	readonly plugins?: readonly CLIPlugin[];

	/**
	 * Built-in flag state from the CLI schema.
	 *
	 * `help: 'off'` releases the command-level `--help`/`-h` short-circuit so a
	 * command's own `help` flag parses. Absent means every built-in is on.
	 */
	readonly builtins?: BuiltinsConfig;
}

/**
 * Structured result from {@linkcode runCommand}.
 *
 * Contains the exit code, captured stdout/stderr output, recorded
 * {@linkcode ActivityEvent | activity events}, and an `error` field.
 * `error` is `undefined` when execution completed without throwing, even if
 * the handler requested a non-zero status via {@linkcode Out.setExitCode}.
 *
 * @example
 * ```ts
 * const result = await runCommand(greetCmd, ['World']);
 *
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('Hello, World!');
 * expect(result.error).toBeUndefined();
 * ```
 */
export interface RunResult {
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
	 * The error that caused a failure, or `undefined` when execution completed.
	 * A non-zero `exitCode` can still have no error when a handler calls
	 * {@linkcode Out.setExitCode}. {@linkcode CLIError} instances are preserved;
	 * unknown errors are wrapped.
	 */
	readonly error: CLIError | undefined;
}
