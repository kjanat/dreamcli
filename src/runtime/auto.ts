/**
 * Auto-detecting adapter factory.
 *
 * Uses {@link detectRuntime} to identify the current runtime and
 * creates the appropriate {@link RuntimeAdapter}. Falls back to the
 * Node adapter for unknown runtimes (safest default — most runtimes
 * provide a Node-compatible `process` global).
 *
 * @module @kjanat/dreamcli/runtime/auto
 */

import type { RuntimeAdapter } from './adapter.ts';
import { createBunAdapter } from './bun.ts';
import type { DenoNamespace } from './deno.ts';
import { createDenoAdapter } from './deno.ts';
import type { GlobalForDetect } from './detect.ts';
import { detectRuntime } from './detect.ts';
import { createNodeAdapter } from './node.ts';
import { assertRuntimeVersionSupported } from './support.ts';

function detectRuntimeVersion(
	runtime: ReturnType<typeof detectRuntime>,
	globals: GlobalForDetect,
): string | undefined {
	switch (runtime) {
		case 'bun':
			return globals.Bun?.version;
		case 'deno':
			return globals.Deno?.version?.deno;
		case 'node':
			return globals.process?.versions?.node;
		case 'unknown':
			return undefined;
		default: {
			const _exhaustive: never = runtime;
			return _exhaustive;
		}
	}
}

function isDenoNamespace(value: unknown): value is DenoNamespace {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Partial<DenoNamespace>;
	return (
		Array.isArray(candidate.args) &&
		typeof candidate.cwd === 'function' &&
		typeof candidate.exit === 'function' &&
		typeof candidate.readTextFile === 'function' &&
		typeof candidate.env?.get === 'function' &&
		typeof candidate.env.toObject === 'function' &&
		typeof candidate.stdout?.writeSync === 'function' &&
		typeof candidate.stdout.isTerminal === 'function' &&
		typeof candidate.stderr?.writeSync === 'function' &&
		typeof candidate.stdin?.isTerminal === 'function' &&
		typeof candidate.stdin?.readable?.getReader === 'function'
	);
}

function getInjectedDenoNamespace(globals: GlobalForDetect): DenoNamespace | undefined {
	const candidate = (globals as { readonly Deno?: unknown }).Deno;
	return isDenoNamespace(candidate) ? candidate : undefined;
}

// --- Auto-adapter factory

/**
 * Create a runtime adapter for the current environment.
 *
 * Detection order follows {@link detectRuntime}: Bun → Deno → Node → unknown.
 * Unknown runtimes fall back to the Node adapter because most JS runtimes
 * expose a Node-compatible `process` global.
 *
 * @param globals - Override `globalThis` for testing. Production callers
 *   should omit this parameter.
 * @returns A {@linkcode RuntimeAdapter} for the detected runtime.
 *
 * @example
 * ```ts
 * import { cli } from '@kjanat/dreamcli';
 *
 * // Auto-detects Node/Bun/Deno and creates the right adapter
 * cli('mycli').run(); // uses createAdapter() internally
 * ```
 */
function createAdapter(globals?: GlobalForDetect): RuntimeAdapter {
	const runtimeGlobals = globals ?? globalThis;
	const runtime = detectRuntime(runtimeGlobals);
	if (runtime !== 'unknown') {
		assertRuntimeVersionSupported(runtime, detectRuntimeVersion(runtime, runtimeGlobals));
	}

	switch (runtime) {
		case 'bun':
			return createBunAdapter();
		case 'deno':
			return createDenoAdapter(getInjectedDenoNamespace(runtimeGlobals));
		case 'node':
		case 'unknown':
			return createNodeAdapter();
		default: {
			const _exhaustive: never = runtime;
			return _exhaustive;
		}
	}
}

// --- Exports

export { createAdapter };
