/**
 * Test utilities for DreamCLI commands.
 *
 * Provides {@linkcode runCommand | runCommand()} — the in-process test harness — plus test doubles
 * for output capture, prompt simulation, and runtime adaptation.
 *
 * Start here for most tests:
 * - {@link runCommand} to execute a command in-process
 * - {@link createCaptureOutput} to assert on raw output behavior
 * - {@link createTestPrompter} to script interactive answers
 * - {@link createTestAdapter} when you need adapter-level control
 *
 * @module @kjanat/dreamcli/testkit
 */

export { type CapturedOutput, createCaptureOutput } from './core/output/index.ts';
export {
	createTestPrompter,
	PROMPT_CANCEL,
	type TestAnswer,
	type TestPrompterOptions,
} from './core/prompt/index.ts';
export { type RunOptions, type RunResult, runCommand } from './core/testkit/index.ts';
export { createTestAdapter, type TestAdapterOptions } from './runtime/index.ts';
