/**
 * Tests for createAdapter — auto-detecting adapter factory.
 *
 * Uses the `globals` parameter to inject controlled globalThis shapes,
 * verifying that the correct adapter is created for each runtime.
 * Adapter identity is tested via the RuntimeAdapter contract (shape),
 * not internal implementation details.
 */

import { describe, expect, it } from 'vitest';
import { CLIError, isCLIError } from '../core/errors/index.js';
import type { RuntimeAdapter } from './adapter.js';
import { createAdapter } from './auto.js';
import type { GlobalForDetect } from './detect.js';
import { RUNTIMES } from './detect.js';

// ===================================================================
// Helpers
// ===================================================================

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
	// Deno (throws CLIError — not yet supported)
	// -------------------------------------------------------------------

	it('throws CLIError for Deno runtime', () => {
		const globals: GlobalForDetect = {
			Deno: { version: { deno: '2.0.0' } },
		};
		expect(() => createAdapter(globals)).toThrow(CLIError);
	});

	it('Deno CLIError has UNSUPPORTED_RUNTIME code', () => {
		const globals: GlobalForDetect = {
			Deno: { version: { deno: '2.0.0' } },
		};
		try {
			createAdapter(globals);
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(isCLIError(e)).toBe(true);
			expect((e as CLIError).code).toBe('UNSUPPORTED_RUNTIME');
		}
	});

	it('Deno CLIError includes suggest field', () => {
		const globals: GlobalForDetect = {
			Deno: { version: { deno: '2.0.0' } },
		};
		try {
			createAdapter(globals);
			expect.unreachable('should have thrown');
		} catch (e) {
			expect((e as CLIError).suggest).toContain('createNodeAdapter');
		}
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
		// either produces a valid RuntimeAdapter or throws a CLIError
		// (Deno is not yet supported).
		const globalsForRuntime: Record<string, GlobalForDetect> = {
			node: { process: { versions: { node: '22.0.0' } } },
			bun: { Bun: { version: '1.1.0' }, process: { versions: { node: '22.0.0' } } },
			deno: { Deno: { version: { deno: '2.0.0' } } },
			unknown: {},
		};

		const unsupported = new Set(['deno']);

		for (const runtime of RUNTIMES) {
			if (unsupported.has(runtime)) {
				expect(
					() => createAdapter(globalsForRuntime[runtime]),
					`createAdapter should throw for unsupported runtime '${runtime}'`,
				).toThrow(CLIError);
			} else {
				const adapter = createAdapter(globalsForRuntime[runtime]);
				expect(adapter, `createAdapter returned undefined for runtime '${runtime}'`).toBeDefined();
				assertAdapterShape(adapter);
			}
		}
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
		// PATH is always present in Node.js environments
		expect(adapter.env.PATH).toBeDefined();
	});
});
