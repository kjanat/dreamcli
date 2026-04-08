/**
 * Runtime adapters for platform portability (Node, Bun, Deno).
 *
 * The adapter interface ({@link RuntimeAdapter}) defines the contract
 * between the platform-agnostic core and the host runtime. Concrete
 * adapters wrap platform-specific APIs (Node `process`, Deno namespace, etc.)
 * behind this uniform interface.
 *
 * @module @kjanat/dreamcli/runtime
 */

export type { RuntimeAdapter, TestAdapterOptions } from './adapter.ts';
export { createTestAdapter, ExitError } from './adapter.ts';
export { createAdapter } from './auto.ts';
export { createBunAdapter } from './bun.ts';
export type { DenoNamespace } from './deno.ts';
export { createDenoAdapter } from './deno.ts';
export type { GlobalForDetect, Runtime } from './detect.ts';
export { detectRuntime, RUNTIMES } from './detect.ts';
export type { NodeProcess } from './node.ts';
export { createNodeAdapter } from './node.ts';
