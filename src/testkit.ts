/**
 * Test utilities for DreamCLI commands.
 *
 * Provides `runCommand()` — the in-process test harness — plus test doubles
 * for output capture, prompt simulation, and runtime adaptation.
 *
 * @module dreamcli/testkit
 */

export type { CapturedOutput } from './core/output/index.js';
export { createCaptureOutput } from './core/output/index.js';
export type { TestAnswer, TestPrompterOptions } from './core/prompt/index.js';
export { createTestPrompter, PROMPT_CANCEL } from './core/prompt/index.js';
export type { RunOptions, RunResult } from './core/testkit/index.js';
export { runCommand } from './core/testkit/index.js';
export type { TestAdapterOptions } from './runtime/index.js';
export { createTestAdapter } from './runtime/index.js';
