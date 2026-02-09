/**
 * Test harness: command.run() with injected state, output capture.
 *
 * Provides `runCommand()` — the core execution pipeline that parses argv,
 * resolves values, creates an output channel, and invokes the action handler.
 * Returns a structured `RunResult` with exitCode and captured output.
 *
 * `CommandBuilder.run()` delegates to `runCommand()`, making commands
 * testable without touching process state.
 *
 * @module dreamcli/core/testkit
 */

import { CLIError } from '../errors/index.js';
import type { HelpOptions } from '../help/index.js';
import { formatHelp } from '../help/index.js';
import type { CapturedOutput, Verbosity } from '../output/index.js';
import { createCaptureOutput } from '../output/index.js';
import { parse } from '../parse/index.js';
import type { ResolveOptions } from '../resolve/index.js';
import { resolve } from '../resolve/index.js';
import type { ArgBuilder, ArgConfig } from '../schema/arg.js';
import type { ActionHandler, CommandBuilder, Out } from '../schema/command.js';
import type { FlagBuilder, FlagConfig } from '../schema/flag.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * The runtime shape of action handler params — unbranded.
 *
 * This is what `ActionParams<F, A>` looks like after type erasure.
 * Used at the phantom-type boundary in `invokeHandler`.
 *
 * @internal
 */
interface HandlerParams {
	readonly flags: Readonly<Record<string, unknown>>;
	readonly args: Readonly<Record<string, unknown>>;
	readonly ctx: Readonly<Record<string, unknown>>;
	readonly out: Out;
}

// ---------------------------------------------------------------------------
// Run options — injectable runtime state for testing
// ---------------------------------------------------------------------------

/**
 * Options accepted by `commandBuilder.run()` and `runCommand()`.
 *
 * Every field is optional — sensible defaults are applied. This is the
 * primary testing seam: inject env, config, I/O writers, etc. without
 * touching process state.
 */
interface RunOptions {
	/**
	 * Environment variables available to the command.
	 * MVP: stored for future env-based resolution (v0.2).
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;

	/**
	 * Verbosity level for the output channel.
	 * @default 'normal'
	 */
	readonly verbosity?: Verbosity;

	/**
	 * Help formatting options (width, binName).
	 * Used when `--help` is detected.
	 */
	readonly help?: HelpOptions;
}

// ---------------------------------------------------------------------------
// Run result — structured output from command execution
// ---------------------------------------------------------------------------

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
	 * The error that caused a non-zero exit, if any.
	 * `CLIError` instances are preserved; unknown errors are wrapped.
	 */
	readonly error: CLIError | undefined;
}

// ---------------------------------------------------------------------------
// Core execution pipeline
// ---------------------------------------------------------------------------

/**
 * Run a command builder against the given argv with injected options.
 *
 * This is the core execution pipeline:
 * 1. Detect `--help` / `-h` → print help text, exit 0
 * 2. Parse argv against the command schema
 * 3. Resolve values (CLI → default for MVP)
 * 4. Create a capture output channel
 * 5. Invoke the action handler
 * 6. Return structured result
 *
 * All errors are caught and converted to structured `RunResult`s with
 * appropriate exit codes. The function never throws.
 *
 * @param cmd - The command builder (must have an action handler)
 * @param argv - Raw argv strings (NOT including the command name itself)
 * @param options - Injectable runtime state
 * @returns Structured run result with exit code and captured output
 */
async function runCommand<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
>(cmd: CommandBuilder<F, A>, argv: readonly string[], options?: RunOptions): Promise<RunResult> {
	const captureOptions =
		options?.verbosity !== undefined ? { verbosity: options.verbosity } : undefined;
	const [out, captured] = createCaptureOutput(captureOptions);

	// -- Help detection -------------------------------------------------------
	if (argv.includes('--help') || argv.includes('-h')) {
		const helpText = formatHelp(cmd.schema, options?.help);
		out.log(helpText);
		return buildResult(0, captured, undefined);
	}

	// -- No action handler → error -------------------------------------------
	if (!cmd.handler) {
		const err = new CLIError(`Command '${cmd.schema.name}' has no action handler`, {
			code: 'NO_ACTION',
			suggest: `Add an .action() handler to the '${cmd.schema.name}' command`,
		});
		out.error(err.message);
		return buildResult(1, captured, err);
	}

	try {
		// -- Parse ---------------------------------------------------------------
		const parsed = parse(cmd.schema, argv);

		// -- Resolve -------------------------------------------------------------
		const resolveOptions: ResolveOptions = {
			...(options?.env !== undefined ? { env: options.env } : {}),
		};
		const resolved = resolve(cmd.schema, parsed, resolveOptions);

		// -- Execute handler -----------------------------------------------------
		// The resolver guarantees that resolved.flags and resolved.args match
		// the shape declared by the command's flag/arg builders. The phantom
		// types on CommandBuilder<F, A> are erased at runtime — the handler
		// is just a function accepting a plain object. `invokeHandler` bridges
		// the phantom type boundary without type assertions in user-facing code.
		await invokeHandler(cmd.handler, resolved.flags, resolved.args, out);

		return buildResult(0, captured, undefined);
	} catch (err: unknown) {
		if (err instanceof CLIError) {
			out.error(err.message);
			if (err.suggest !== undefined) {
				out.error(`Suggestion: ${err.suggest}`);
			}
			return buildResult(err.exitCode, captured, err);
		}

		// Unknown error — wrap and exit 1
		const message = err instanceof Error ? err.message : String(err);
		const wrapped = new CLIError(`Unexpected error: ${message}`, {
			code: 'UNEXPECTED_ERROR',
			cause: err,
		});
		out.error(wrapped.message);
		return buildResult(1, captured, wrapped);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Invoke an action handler at the phantom-type boundary.
 *
 * The resolver produces `Record<string, unknown>` at runtime — the correct
 * runtime representation of the phantom-typed `InferFlags<F>` / `InferArgs<A>`.
 * At runtime, `ActionHandler<F, A>` is just `(params: object) => void | Promise<void>`
 * — the generic params F and A are erased.
 *
 * This function is the sole point where we bridge that gap. The parse→resolve
 * pipeline guarantees the runtime values match the schema; the phantom types
 * guarantee the handler expects that schema. The `Function.prototype.call`
 * invocation bypasses TypeScript's compile-time check at this one seam.
 *
 * @internal
 */
function invokeHandler<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
>(
	handler: ActionHandler<F, A>,
	flags: Readonly<Record<string, unknown>>,
	args: Readonly<Record<string, unknown>>,
	out: Out,
): void | Promise<void> {
	const params: HandlerParams = { flags, args, ctx: {}, out };
	// The handler's runtime signature is (params: object) => void | Promise<void>.
	// Phantom-type erasure means this call is safe; parse→resolve guarantees shape.
	return (handler as (params: HandlerParams) => void | Promise<void>)(params);
}

/** Build a `RunResult` from parts. */
function buildResult(
	exitCode: number,
	captured: CapturedOutput,
	error: CLIError | undefined,
): RunResult {
	return {
		exitCode,
		stdout: captured.stdout,
		stderr: captured.stderr,
		error,
	};
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { runCommand };
export type { RunOptions, RunResult };
