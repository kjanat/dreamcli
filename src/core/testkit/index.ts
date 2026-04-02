/**
 * Test harness: command.run() with injected state, output capture.
 *
 * Provides `runCommand()` — the core execution pipeline that parses argv,
 * resolves values (CLI → env → config → default), creates an output channel,
 * and invokes the action handler. Returns a structured `RunResult` with
 * exitCode and captured output.
 *
 * `CommandBuilder.run()` delegates to `runCommand()`, making commands
 * testable without touching process state.
 *
 * @module dreamcli/core/testkit
 */

import { buildRunResult, executeCommand } from '#internals/core/execution/index.ts';
import type { CapturedOutput } from '#internals/core/output/index.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import type { CommandBuilder, CommandMeta, Out } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import type { RunOptions, RunResult } from '#internals/core/schema/run.ts';

// RunOptions and RunResult are defined in schema/run.ts so the execution
// contract is shared by schema, CLI dispatch, and testkit. Re-exported here
// for public testkit continuity.

// --- Core execution pipeline

/**
 * Run a command builder against the given argv with injected options.
 *
 * This is the core execution pipeline:
 * 1. Detect `--help` / `-h` → print help text, exit 0
 * 2. Parse argv against the command schema
 * 3. Resolve values (CLI → env → config → default)
 * 4. Create a capture output channel
 * 5. Run derive/middleware/action execution steps
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
	C extends Record<string, unknown> = Record<string, never>,
>(cmd: CommandBuilder<F, A, C>, argv: readonly string[], options?: RunOptions): Promise<RunResult> {
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
