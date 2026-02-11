/**
 * Runtime adapters for platform portability (Node, Bun, Deno).
 *
 * Provides the {@link RuntimeAdapter} interface and concrete adapter
 * factories for each supported platform.
 *
 * @module dreamcli/runtime
 */

export type {
	DenoNamespace,
	GlobalForDetect,
	NodeProcess,
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
