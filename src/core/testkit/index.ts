/**
 * Test harness: command.run() with injected state, output capture.
 *
 * Provides {@linkcode runCommand()} — the in-process test harness wrapper over DreamCLI's
 * shared executor.\
 * It wires capture output and standalone command metadata,
 * then returns a structured {@linkcode RunResult} with exitCode and captured output.
 *
 * This keeps command tests process-free without testkit owning the canonical pipeline:
 *
 * ```text
 * parse -> resolve -> execute
 * ```
 * @module dreamcli/core/testkit
 */

import type { BuiltinsConfig } from '#internals/core/cli/builtins.ts';
import { builtinEnabled } from '#internals/core/cli/builtins.ts';
import {
	readRootOutputFlags,
	resolveRootJsonMode,
	resolveRootVerbosity,
} from '#internals/core/cli/root-output-flags.ts';
import { buildRunResult, executeCommand } from '#internals/core/execution/index.ts';
import type { CapturedOutput, Verbosity } from '#internals/core/output/index.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
import { requestsHelp } from '#internals/core/parse/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import type {
	CommandBuilder,
	CommandMeta,
	Out,
	RunnableCommand,
} from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import type { InternalRunOptions, RunOptions, RunResult } from '#internals/core/schema/run.ts';

// RunOptions and RunResult are defined in schema/run.ts so the execution
// contract is shared by schema, CLI dispatch, and testkit. Re-exported here
// for public testkit continuity.

// --- Core execution pipeline

/**
 * Options for {@linkcode runCommand}.
 *
 * Extends {@linkcode RunOptions} with the CLI-root state `runCommand()` mirrors,
 * following the way `CLIRunOptions` extends `CLIExecuteOptions` with the fields
 * only that layer needs.
 */
interface RunCommandOptions extends RunOptions {
	/**
	 * Which built-in flags the harness mirrors, matching the CLI the command is
	 * registered on.
	 *
	 * A command that owns a released built-in (`cli(...).builtins({ json: 'off' })`
	 * plus a `json` flag) must be tested with the same setting, otherwise the
	 * harness strips the token before `parse()` sees it.
	 *
	 * @defaultValue every built-in `'on'`, mirroring an unconfigured CLI root
	 */
	readonly builtins?: BuiltinsConfig;
}

/**
 * Run a command builder against the given argv with injected options.
 *
 * This is the testkit wrapper around the shared executor:
 * 1. Apply the CLI root-flag layer (detect/strip `--json` and `--quiet`/`-q`) so
 *    copied real argv works
 * 2. Create or reuse capture output
 * 3. Build standalone schema/meta defaults when CLI dispatch did not
 * 4. Delegate parse -> resolve -> execute to the shared executor
 * 5. Return the structured result with captured buffers
 *
 * Errors are normalized by the shared executor into structured {@linkcode RunResult}s
 * with appropriate exit codes. The function never throws.
 *
 * @param cmd - The command builder (must have an action handler)
 * @param argv - Raw argv strings (NOT including the command name itself).
 *   CLI-level `--json` and `--quiet`/`-q` before the `--` separator are honored
 *   and stripped here, just like the real CLI root — so `['--json']` enables
 *   JSON mode and `['--quiet']` sets quiet verbosity rather than failing as
 *   unknown flags. Equivalent to `{ jsonMode: true }` / `{ verbosity: 'quiet' }`.
 *   Both accept an explicit value (`--json=false`), and an invalid one fails
 *   with the same `INVALID_VALUE` error the CLI root produces. Pass
 *   `options.builtins` to mirror a CLI that released one of these tokens to its
 *   commands.
 * @param options - Injectable runtime state
 * @returns Structured run result with exit code and captured output
 */
async function runCommand<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown> = Record<string, never>,
>(
	cmd: CommandBuilder<F, A, C>,
	argv: readonly string[],
	options?: RunCommandOptions,
): Promise<RunResult> {
	return runCommandInternal(cmd, argv, options);
}

/**
 * Execution body behind {@linkcode runCommand}, accepting the
 * framework-populated channel, capture, schema, and meta fields.
 *
 * @internal
 */
async function runCommandInternal(
	cmd: RunnableCommand,
	argv: readonly string[],
	options?: InternalRunOptions,
): Promise<RunResult> {
	// Root-flag layer mirroring `CLIBuilder.execute()`: `--json` and `--quiet`
	// are owned by the CLI root, not the command schema, so they would otherwise
	// reach `parse()` as unknown flags (#33). The shared reader detects them,
	// strips them, and rejects an invalid `=value` exactly as dispatch does. The
	// explicit `options.jsonMode` keeps working when argv says nothing.
	const rootOutputFlags = readRootOutputFlags(argv, options?.builtins);
	const jsonMode = resolveRootJsonMode(rootOutputFlags, options?.jsonMode);
	const verbosity: Verbosity | undefined = resolveRootVerbosity(
		rootOutputFlags,
		options?.verbosity,
	);
	const effectiveArgv = rootOutputFlags.argv;

	let out: Out;
	let captured: CapturedOutput;
	if (options?.out !== undefined) {
		out = options.out;
		captured = options.captured ?? { stdout: [], stderr: [], activity: [] };
	} else {
		const captureOptions = {
			...(verbosity !== undefined ? { verbosity } : {}),
			...(jsonMode ? { jsonMode } : {}),
			...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
		};
		[out, captured] = createCaptureOutput(
			Object.keys(captureOptions).length > 0 ? captureOptions : undefined,
		);
	}

	if (
		rootOutputFlags.kind === 'failed' &&
		!(builtinEnabled(options?.builtins, 'help') && requestsHelp(effectiveArgv))
	) {
		const { error } = rootOutputFlags;
		if (jsonMode) {
			out.json({ error: error.toJSON() });
		} else {
			out.error(error.message);
			if (error.suggest !== undefined) {
				out.error(`Suggestion: ${error.suggest}`);
			}
		}
		return buildRunResult({ exitCode: error.exitCode, error }, captured);
	}

	// Use merged schema (with propagated flags) when provided by dispatch layer,
	// otherwise fall back to the command's own schema.
	const schema = options?.mergedSchema ?? cmd.schema;
	const meta: CommandMeta = options?.meta ?? {
		name: schema.name,
		bin: options?.help?.binName ?? schema.name,
		version: undefined,
		command: schema.name,
	};

	// Thread the effective JSON mode into the executor so its error path renders
	// structured JSON, matching dispatch where the planner sets `options.jsonMode`.
	const effectiveOptions: InternalRunOptions | undefined =
		options !== undefined
			? { ...options, ...(jsonMode ? { jsonMode } : {}) }
			: jsonMode
				? { jsonMode }
				: undefined;

	const result = await executeCommand({
		command: { handler: cmd.handler, steps: cmd._executionSteps },
		argv: effectiveArgv,
		out,
		schema,
		meta,
		...(effectiveOptions !== undefined ? { options: effectiveOptions } : {}),
	});

	return buildRunResult(result, captured);
}

// --- Exports

/**
 * Options for {@linkcode runCommand} — process-free command execution.
 *
 * Every field is optional. Inject env, config, prompt answers, and
 * output capture without touching process state.
 *
 * @example
 * ```ts
 * const result = await runCommand(cmd, ['--verbose'], {
 *   env: { LOG_LEVEL: 'debug' },
 *   config: { theme: 'dark' },
 * });
 * ```
 */
/**
 * Structured result from {@linkcode runCommand}.
 *
 * Contains the exit code, captured stdout/stderr output, recorded
 * {@linkcode ActivityEvent | activity events}, and an `error` field
 * that is `undefined` on success and a {@linkcode CLIError} on failure.
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
export type { RunCommandOptions, RunOptions, RunResult };

export { runCommand, runCommandInternal };
