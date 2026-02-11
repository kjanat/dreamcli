/**
 * Auto-detecting adapter factory.
 *
 * Uses {@link detectRuntime} to identify the current runtime and
 * creates the appropriate {@link RuntimeAdapter}. Falls back to the
 * Node adapter for unknown runtimes (safest default — most runtimes
 * provide a Node-compatible `process` global).
 *
 * @module dreamcli/runtime/auto
 */

import type { RuntimeAdapter } from './adapter.ts';
import { createBunAdapter } from './bun.ts';
import { createDenoAdapter } from './deno.ts';
import type { GlobalForDetect } from './detect.ts';
import { detectRuntime } from './detect.ts';
import { createNodeAdapter } from './node.ts';

// ---------------------------------------------------------------------------
// Auto-adapter factory
// ---------------------------------------------------------------------------

/**
 * Create a runtime adapter for the current environment.
 *
 * Detection order follows {@link detectRuntime}: Bun → Deno → Node → unknown.
 * Unknown runtimes fall back to the Node adapter because most JS runtimes
 * expose a Node-compatible `process` global.
 *
 * @param globals - Override `globalThis` for testing. Production callers
 *   should omit this parameter.
 * @returns A `RuntimeAdapter` for the detected runtime.
 *
 * @example
 * ```ts
 * import { cli } from 'dreamcli';
 *
 * // Auto-detects Node/Bun/Deno and creates the right adapter
 * cli('mycli').run(); // uses createAdapter() internally
 * ```
 */
function createAdapter(globals?: GlobalForDetect): RuntimeAdapter {
	const runtime = detectRuntime(globals);

	switch (runtime) {
		case 'bun':
			return createBunAdapter();
		case 'deno':
			return createDenoAdapter();
		case 'node':
		case 'unknown':
			return createNodeAdapter();
		default: {
			const _exhaustive: never = runtime;
			return _exhaustive;
		}
	}
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createAdapter };
