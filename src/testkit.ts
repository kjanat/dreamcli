/**
 * Test utilities for DreamCLI commands.
 *
 * Provides `runCommand()` — the in-process test harness — plus test doubles
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

export type { CapturedOutput } from './core/output/index.ts';
export { createCaptureOutput } from './core/output/index.ts';
export type { TestAnswer, TestPrompterOptions } from './core/prompt/index.ts';
export { createTestPrompter, PROMPT_CANCEL } from './core/prompt/index.ts';
export type { RunOptions, RunResult } from './core/testkit/index.ts';
export { runCommand } from './core/testkit/index.ts';
export type { TestAdapterOptions } from './runtime/index.ts';
export { createTestAdapter } from './runtime/index.ts';
