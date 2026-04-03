/**
 * Test harness: command.run() with injected state, output capture.
 *
 * Provides `runCommand()` — the in-process test harness wrapper over DreamCLI's
 * shared executor. It wires capture output and standalone command metadata,
 * then returns a structured `RunResult` with exitCode and captured output.
 *
 * This keeps command tests process-free without testkit owning the canonical
 * parse -> resolve -> execute pipeline.
 *
 * @module dreamcli/core/testkit
 */

import { buildRunResult, executeCommand } from '#internals/core/execution/index.ts';
import type { CapturedOutput } from '#internals/core/output/index.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
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
 * 1. Create or reuse capture output
 * 2. Build standalone schema/meta defaults when CLI dispatch did not
 * 3. Delegate parse -> resolve -> execute to the shared executor
 * 4. Return the structured result with captured buffers
 *
 * Errors are normalized by the shared executor into structured `RunResult`s
 * with appropriate exit codes. The function never throws.
 *
 * @param cmd - The command builder (must have an action handler)
 * @param argv - Raw argv strings (NOT including the command name itself)
 * @param options - Injectable runtime state
 * @returns Structured run result with exit code and captured output
 */
async function runCommand(
	cmd: RunnableCommand,
	argv: readonly string[],
	options?: RunOptions,
): Promise<RunResult> {
	let out: Out;
	let captured: CapturedOutput;
	if (options?.out !== undefined) {
		out = options.out;
		captured = options.captured ?? { stdout: [], stderr: [], activity: [] };
	} else {
		const captureOptions = {
			...(options?.verbosity !== undefined ? { verbosity: options.verbosity } : {}),
			...(options?.jsonMode !== undefined ? { jsonMode: options.jsonMode } : {}),
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

	const result = await executeCommand({
		command: cmd,
		argv,
		out,
		schema,
		meta,
		...(options !== undefined ? { options } : {}),
	});

	return buildRunResult(result, captured);
}

// --- Exports

export type { RunOptions, RunResult };
export { runCommand };
