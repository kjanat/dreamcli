/**
 * Shared test helpers for runtime adapter tests.
 *
 * @internal — test-only, not exported from any public barrel.
 * @module dreamcli/runtime/test-helpers
 */

import { vi } from 'vitest';

/**
 * Install a minimal mock Deno namespace on globalThis for the duration of `fn`.
 *
 * `createDenoAdapter()` reads from `globalThis.Deno` when no explicit
 * namespace is provided. In vitest (Node), there is no real Deno global,
 * so Deno-path tests in `createAdapter` must install a mock temporarily.
 */
export function withMockDenoGlobal<T>(fn: () => T): T {
	const g = globalThis as Record<string, unknown>;
	const prev = g['Deno'];
	g['Deno'] = {
		args: [],
		env: { get: () => undefined, toObject: () => ({}) },
		cwd: () => '/deno/mock',
		stdout: { write: vi.fn(() => Promise.resolve(0)), isTerminal: () => false },
		stderr: { write: vi.fn(() => Promise.resolve(0)) },
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
	try {
		return fn();
	} finally {
		if (prev === undefined) {
			delete g['Deno'];
		} else {
			g['Deno'] = prev;
		}
	}
}
