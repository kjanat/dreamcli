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

import { CLIError } from '../core/errors/index.js';
import type { RuntimeAdapter } from './adapter.js';
import { createBunAdapter } from './bun.js';
import type { GlobalForDetect } from './detect.js';
import { detectRuntime } from './detect.js';
import { createNodeAdapter } from './node.js';

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
 * Deno is detected but not yet supported — throws a `CLIError` with code
 * `UNSUPPORTED_RUNTIME` until a dedicated Deno adapter is implemented.
 * Use `createNodeAdapter()` directly if you need to bypass detection.
 *
 * @param globals - Override `globalThis` for testing. Production callers
 *   should omit this parameter.
 * @returns A `RuntimeAdapter` for the detected runtime.
 *
 * @example
 * ```ts
 * import { cli } from 'dreamcli';
 *
 * // Auto-detects Node/Bun and creates the right adapter
 * cli('mycli').run(); // uses createAdapter() internally
 * ```
 */
function createAdapter(globals?: GlobalForDetect): RuntimeAdapter {
	const runtime = detectRuntime(globals);

	switch (runtime) {
		case 'bun':
			return createBunAdapter();
		case 'deno':
			throw new CLIError('Deno runtime detected but not yet supported', {
				code: 'UNSUPPORTED_RUNTIME',
				suggest: 'Use createNodeAdapter() directly to bypass auto-detection',
			});
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
