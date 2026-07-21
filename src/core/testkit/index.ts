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

import { buildRunResult, executeCommand } from '#internals/core/execution/index.ts';
import type { CapturedOutput, Verbosity } from '#internals/core/output/index.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
import { includesBeforeSeparator, stripBeforeSeparator } from '#internals/core/parse/index.ts';
import type { CommandMeta, Out, RunnableCommand } from '#internals/core/schema/command.ts';
import type { RunOptions, RunResult } from '#internals/core/schema/run.ts';

// RunOptions and RunResult are defined in schema/run.ts so the execution
// contract is shared by schema, CLI dispatch, and testkit. Re-exported here
// for public testkit continuity.

// --- Core execution pipeline

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
 * @param options - Injectable runtime state
 * @returns Structured run result with exit code and captured output
 */
async function runCommand(
	cmd: RunnableCommand,
	argv: readonly string[],
	options?: RunOptions,
): Promise<RunResult> {
	// Root-flag layer mirroring `CLIBuilder.execute()`: `--json` is owned by the
	// CLI root, not the command schema, so it would otherwise reach `parse()` as
	// an unknown flag (#33). Detect it before the `--` separator (a literal
	// `--json` positional after `--` survives), enable JSON mode, and strip it so
	// the command schema never sees it. The explicit `options.jsonMode` keeps
	// working — either source enables JSON mode.
	const hasJsonFlag = includesBeforeSeparator(argv, '--json');
	const jsonMode = hasJsonFlag || options?.jsonMode === true;
	const hasQuietFlag =
		includesBeforeSeparator(argv, '--quiet') || includesBeforeSeparator(argv, '-q');
	const verbosity: Verbosity | undefined = hasQuietFlag ? 'quiet' : options?.verbosity;
	let effectiveArgv = hasJsonFlag ? stripBeforeSeparator(argv, '--json') : argv;
	if (hasQuietFlag) {
		effectiveArgv = stripBeforeSeparator(stripBeforeSeparator(effectiveArgv, '--quiet'), '-q');
	}

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
	const effectiveOptions: RunOptions | undefined =
		options !== undefined
			? { ...options, ...(jsonMode ? { jsonMode } : {}) }
			: jsonMode
				? { jsonMode }
				: undefined;

	const result = await executeCommand({
		command: cmd,
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
export type { RunOptions, RunResult };

export { runCommand };
