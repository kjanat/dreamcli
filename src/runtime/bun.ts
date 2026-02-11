/**
 * Bun runtime adapter implementation.
 *
 * Bun provides a Node-compatible `process` global, so this adapter
 * delegates to {@link createNodeAdapter} for all operations. The
 * separate factory exists to:
 *
 * 1. Make runtime selection explicit when auto-detection picks Bun
 * 2. Provide an extension point for Bun-specific overrides in the future
 *    (e.g. `Bun.write` for optimized I/O, `Bun.stdin` for streaming)
 *
 * @module dreamcli/runtime/bun
 */

import type { RuntimeAdapter } from './adapter.ts';
import type { NodeProcess } from './node.ts';
import { createNodeAdapter } from './node.ts';

// ---------------------------------------------------------------------------
// Bun adapter factory
// ---------------------------------------------------------------------------

/**
 * Create a runtime adapter backed by Bun's Node-compatible `process` global.
 *
 * Bun exposes `globalThis.process` with the same shape as Node.js, so this
 * delegates entirely to {@link createNodeAdapter}. If Bun-specific optimizations
 * are needed in the future (e.g. `Bun.write` for I/O), they can be layered
 * here without changing the public API.
 *
 * @param proc - Override the process object (useful for testing the adapter itself).
 * @returns A `RuntimeAdapter` backed by Bun's process state.
 *
 * @example
 * ```ts
 * import { cli } from 'dreamcli';
 * import { createBunAdapter } from 'dreamcli/runtime/bun';
 *
 * cli('mycli')
 *   .command(deploy)
 *   .run({ adapter: createBunAdapter() });
 * ```
 */
function createBunAdapter(proc?: NodeProcess): RuntimeAdapter {
	return createNodeAdapter(proc);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createBunAdapter };
