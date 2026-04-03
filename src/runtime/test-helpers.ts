/**
 * Shared test helpers for runtime adapter tests.
 *
 * @internal — test-only, not exported from any public barrel.
 * @module @kjanat/dreamcli/runtime/test-helpers
 */

import { vi } from 'vitest';

/**
 * Create a minimal mock Deno namespace for adapter tests.
 *
 * Tests that exercise the Deno adapter path through `createAdapter()`
 * can pass this namespace via the injected `globals` parameter instead
 * of mutating `globalThis.Deno`.
 *
 * @returns A mock Deno namespace with stubbed I/O, env, and exit.
 */
export function createMockDenoNamespace() {
	return {
		build: { os: 'linux' as const },
		args: [],
		env: { get: () => undefined, toObject: () => ({}) },
		cwd: () => '/deno/mock',
		stdout: { writeSync: vi.fn(() => 0), isTerminal: () => false },
		stderr: { writeSync: vi.fn(() => 0) },
		stdin: {
			isTerminal: () => false,
			readable: {
				getReader: () => ({
					read: () => Promise.resolve({ done: true, value: undefined }),
					releaseLock: () => {},
				}),
			},
		},
		exit: vi.fn() as unknown as (code: number) => never,
		readTextFile: () => Promise.reject(Object.assign(new Error('not found'), { name: 'NotFound' })),
		version: { deno: '2.6.0' },
	};
}
