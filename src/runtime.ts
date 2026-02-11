/**
 * Runtime adapters for platform portability (Node, Bun, Deno).
 *
 * Provides the {@link RuntimeAdapter} interface and concrete adapter
 * factories for each supported platform.
 *
 * @module dreamcli/runtime
 */

export type { GlobalForDetect, NodeProcess, Runtime, RuntimeAdapter } from './runtime/index.js';
export {
	createAdapter,
	createBunAdapter,
	createNodeAdapter,
	detectRuntime,
	ExitError,
	RUNTIMES,
} from './runtime/index.js';
