/**
 * Runtime adapters for platform portability (Node, Bun, Deno).
 *
 * The adapter interface ({@link RuntimeAdapter}) defines the contract
 * between the platform-agnostic core and the host runtime. Concrete
 * adapters wrap platform-specific APIs (Node `process`, Deno namespace, etc.)
 * behind this uniform interface.
 *
 * @module dreamcli/runtime
 */

export type { RuntimeAdapter, TestAdapterOptions } from './adapter.js';
export { createTestAdapter, ExitError } from './adapter.js';
export type { NodeProcess } from './node.js';
export { createNodeAdapter } from './node.js';
