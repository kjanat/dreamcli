/**
 * Runtime adapters for platform portability (Node, Bun, Deno).
 *
 * Provides the {@link RuntimeAdapter} interface and concrete adapter
 * factories for each supported platform.
 *
 * Start here when embedding DreamCLI in a real host runtime:
 * - {@link createAdapter} for normal auto-detected production use
 * - {@link createNodeAdapter} or {@link createDenoAdapter} when the runtime
 *   must be selected explicitly (Bun uses the Node adapter — its `process` is
 *   Node-compatible — so there is no separate Bun factory)
 *
 * Most applications do not need this subpath unless they are wiring DreamCLI
 * into a custom host, testing runtime behavior directly, or building their own
 * process/bootstrap layer.
 *
 * @module @kjanat/dreamcli/runtime
 */

export type {
	DenoNamespace,
	GlobalForDetect,
	NodeProcess,
	Runtime,
	RuntimeAdapter,
	TerminalSize,
} from './runtime/index.ts';
export {
	createAdapter,
	createDenoAdapter,
	createNodeAdapter,
	detectRuntime,
	ExitError,
	RUNTIMES,
} from './runtime/index.ts';
