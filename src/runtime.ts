/**
 * Runtime adapters for platform portability (Node, Bun, Deno).
 *
 * Provides the {@link RuntimeAdapter} interface and concrete adapter
 * factories for each supported platform.
 *
 * Start here when embedding DreamCLI in a real host runtime:
 * - {@link createAdapter} for normal auto-detected production use
 * - {@link createNodeAdapter}, {@link createDenoAdapter}, or
 *   {@link createBunAdapter} when the runtime must be selected explicitly
 *
 * Most applications do not need this subpath unless they are wiring DreamCLI
 * into a custom host, testing runtime behavior directly, or building their own
 * process/bootstrap layer.
 *
 * @module dreamcli/runtime
 */

export type {
	Runtime,
	RuntimeAdapter,
} from './runtime/index.ts';
export {
	createAdapter,
	createBunAdapter,
	createDenoAdapter,
	createNodeAdapter,
	detectRuntime,
	ExitError,
	RUNTIMES,
} from './runtime/index.ts';
