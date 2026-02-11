/**
 * Tests for createAdapter — auto-detecting adapter factory.
 *
 * Uses the `globals` parameter to inject controlled globalThis shapes,
 * verifying that the correct adapter is created for each runtime.
 * Adapter identity is tested via the RuntimeAdapter contract (shape),
 * not internal implementation details.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAdapter } from './adapter.ts';
import { createAdapter } from './auto.ts';
import type { GlobalForDetect } from './detect.ts';
import { RUNTIMES } from './detect.ts';

// ===================================================================
// Helpers
// ===================================================================

/**
 * Install a minimal mock Deno namespace on globalThis for the duration of `fn`.
 *
 * `createDenoAdapter()` reads from `globalThis.Deno` when no explicit
 * namespace is provided. In vitest (Node), there is no real Deno global,
 * so Deno-path tests in `createAdapter` must install a mock temporarily.
 */
function withMockDenoGlobal<T>(fn: () => T): T {
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
		version: { deno: '2.0.0' },
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

/**
 * Assert that a value satisfies the RuntimeAdapter interface shape.
 * Checks all required fields exist with correct types.
 */
function assertAdapterShape(adapter: RuntimeAdapter): void {
	expect(adapter).toBeDefined();
	expect(adapter.argv).toBeDefined();
	expect(adapter.env).toBeDefined();
	expect(typeof adapter.cwd).toBe('string');
	expect(typeof adapter.stdout).toBe('function');
	expect(typeof adapter.stderr).toBe('function');
	expect(typeof adapter.stdin).toBe('function');
	expect(typeof adapter.isTTY).toBe('boolean');
	expect(typeof adapter.stdinIsTTY).toBe('boolean');
	expect(typeof adapter.exit).toBe('function');
}

// ===================================================================
// createAdapter — runtime dispatch
// ===================================================================

describe('createAdapter — runtime dispatch', () => {
	// -------------------------------------------------------------------
	// Node.js
	// -------------------------------------------------------------------

	it('creates adapter for Node.js runtime', () => {
		const globals: GlobalForDetect = {
			process: { versions: { node: '22.0.0' } },
		};
		const adapter = createAdapter(globals);
		assertAdapterShape(adapter);
	});

	// -------------------------------------------------------------------
	// Bun
	// -------------------------------------------------------------------

	it('creates adapter for Bun runtime', () => {
		const globals: GlobalForDetect = {
			Bun: { version: '1.1.0' },
			process: { versions: { node: '22.0.0' } },
		};
		const adapter = createAdapter(globals);
		assertAdapterShape(adapter);
	});

	// -------------------------------------------------------------------
	// Deno
	// -------------------------------------------------------------------

	it('creates adapter for Deno runtime', () => {
		withMockDenoGlobal(() => {
			const globals: GlobalForDetect = {
				Deno: { version: { deno: '2.0.0' } },
			};
			const adapter = createAdapter(globals);
			assertAdapterShape(adapter);
		});
	});

	// -------------------------------------------------------------------
	// Unknown (falls back to Node)
	// -------------------------------------------------------------------

	it('creates adapter for unknown runtime (Node fallback)', () => {
		const globals: GlobalForDetect = {};
		const adapter = createAdapter(globals);
		assertAdapterShape(adapter);
	});

	it('creates adapter when process exists but versions.node is missing', () => {
		const globals: GlobalForDetect = {
			process: { versions: {} },
		};
		const adapter = createAdapter(globals);
		assertAdapterShape(adapter);
	});
});

// ===================================================================
// createAdapter — exhaustiveness
// ===================================================================

describe('createAdapter — exhaustiveness', () => {
	it('handles every Runtime variant without returning undefined', () => {
		// Exhaustiveness is enforced at compile-time via `default: never`.
		// This test verifies runtime behavior: every known Runtime value
		// produces a valid RuntimeAdapter.
		const globalsForRuntime: Record<string, GlobalForDetect> = {
			node: { process: { versions: { node: '22.0.0' } } },
			bun: { Bun: { version: '1.1.0' }, process: { versions: { node: '22.0.0' } } },
			deno: { Deno: { version: { deno: '2.0.0' } } },
			unknown: {},
		};

		withMockDenoGlobal(() => {
			for (const runtime of RUNTIMES) {
				const adapter = createAdapter(globalsForRuntime[runtime]);
				expect(adapter, `createAdapter returned undefined for runtime '${runtime}'`).toBeDefined();
				assertAdapterShape(adapter);
			}
		});
	});
});

// ===================================================================
// createAdapter — default (no globals override)
// ===================================================================

describe('createAdapter — default globalThis', () => {
	it('creates adapter without explicit globals', () => {
		// Running in Node.js via vitest — should create Node adapter
		const adapter = createAdapter();
		assertAdapterShape(adapter);
	});

	it('returns adapter with real process argv', () => {
		const adapter = createAdapter();
		// vitest runs on Node — argv should have at least 2 entries
		expect(adapter.argv.length).toBeGreaterThanOrEqual(2);
	});

	it('returns adapter with real process cwd', () => {
		const adapter = createAdapter();
		// cwd should be a non-empty absolute path
		expect(adapter.cwd.length).toBeGreaterThan(0);
	});
});

// ===================================================================
// createAdapter — adapter is functional
// ===================================================================

describe('createAdapter — adapter functionality', () => {
	it('stdout writer is callable', () => {
		const adapter = createAdapter();
		// Should not throw when called
		expect(() => adapter.stdout('')).not.toThrow();
	});

	it('stderr writer is callable', () => {
		const adapter = createAdapter();
		expect(() => adapter.stderr('')).not.toThrow();
	});

	it('env contains expected Node.js variables', () => {
		const adapter = createAdapter();
		// PATH is always present but may be cased as "Path" on Windows
		const hasPath = adapter.env.PATH !== undefined || adapter.env.Path !== undefined;
		expect(hasPath).toBe(true);
	});
});
