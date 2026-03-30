/**
 * Tests for the Bun runtime adapter.
 *
 * Since createBunAdapter delegates to createNodeAdapter (Bun provides a
 * Node-compatible process global), these tests verify the delegation
 * contract and that the adapter satisfies the RuntimeAdapter interface.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAdapter } from './adapter.ts';
import { createBunAdapter } from './bun.ts';
import type { NodeProcess } from './node.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Empty async iterator — yields nothing, returns immediately. */
async function* emptyAsyncIterator(): AsyncGenerator<Uint8Array> {}

/** Minimal stdin stub with async iterator (yields nothing). */
function mockStdin(overrides?: Partial<NodeProcess['stdin']>): NodeProcess['stdin'] {
	return {
		[Symbol.asyncIterator]: emptyAsyncIterator,
		...overrides,
	};
}

function mockProcess(
	overrides?: Omit<Partial<NodeProcess>, 'stdin'> & { stdin?: NodeProcess['stdin'] },
): NodeProcess {
	return {
		argv: overrides?.argv ?? ['bun', 'cli.ts'],
		env: overrides?.env ?? {},
		cwd: overrides?.cwd ?? (() => '/bun/project'),
		platform: overrides?.platform ?? 'linux',
		stdin: overrides?.stdin ?? mockStdin(),
		stdout: overrides?.stdout ?? { isTTY: false, write: vi.fn() },
		stderr: overrides?.stderr ?? { write: vi.fn() },
		exit: overrides?.exit ?? (vi.fn() as unknown as (code: number) => never),
	};
}

// ===================================================================
// createBunAdapter — basic contract
// ===================================================================

describe('createBunAdapter', () => {
	it('returns a RuntimeAdapter with all required fields', () => {
		const adapter: RuntimeAdapter = createBunAdapter(mockProcess());

		expect(adapter.argv).toBeDefined();
		expect(adapter.env).toBeDefined();
		expect(adapter.cwd).toBeDefined();
		expect(typeof adapter.stdout).toBe('function');
		expect(typeof adapter.stderr).toBe('function');
		expect(typeof adapter.stdin).toBe('function');
		expect(typeof adapter.isTTY).toBe('boolean');
		expect(typeof adapter.stdinIsTTY).toBe('boolean');
		expect(typeof adapter.exit).toBe('function');
	});

	it('satisfies RuntimeAdapter type', () => {
		// Compile-time check — assigning to typed variable
		const adapter: RuntimeAdapter = createBunAdapter(mockProcess());
		expect(adapter).toBeDefined();
	});
});

// ===================================================================
// createBunAdapter — delegates to process fields
// ===================================================================

describe('createBunAdapter — process delegation', () => {
	it('reads argv from process', () => {
		const proc = mockProcess({ argv: ['bun', 'run', 'cli.ts', 'deploy', '--force'] });
		const adapter = createBunAdapter(proc);
		expect(adapter.argv).toEqual(['bun', 'run', 'cli.ts', 'deploy', '--force']);
	});

	it('reads env from process', () => {
		const proc = mockProcess({ env: { BUN_ENV: 'production', API_KEY: 'secret' } });
		const adapter = createBunAdapter(proc);
		expect(adapter.env).toEqual({ BUN_ENV: 'production', API_KEY: 'secret' });
	});

	it('reads cwd from process.cwd()', () => {
		const proc = mockProcess({ cwd: () => '/home/user/bun-project' });
		const adapter = createBunAdapter(proc);
		expect(adapter.cwd).toBe('/home/user/bun-project');
	});

	it('routes stdout writes to process.stdout.write', () => {
		const writeFn = vi.fn();
		const proc = mockProcess({ stdout: { isTTY: false, write: writeFn } });
		const adapter = createBunAdapter(proc);

		adapter.stdout('hello from bun');
		expect(writeFn).toHaveBeenCalledWith('hello from bun');
	});

	it('routes stderr writes to process.stderr.write', () => {
		const writeFn = vi.fn();
		const proc = mockProcess({ stderr: { write: writeFn } });
		const adapter = createBunAdapter(proc);

		adapter.stderr('bun error');
		expect(writeFn).toHaveBeenCalledWith('bun error');
	});

	it('delegates exit to process.exit', () => {
		const exitFn = vi.fn() as unknown as (code: number) => never;
		const proc = mockProcess({ exit: exitFn });
		const adapter = createBunAdapter(proc);

		adapter.exit(1);
		expect(exitFn).toHaveBeenCalledWith(1);
	});
});

// ===================================================================
// createBunAdapter — TTY detection
// ===================================================================

describe('createBunAdapter — TTY detection', () => {
	it('isTTY is true when stdout.isTTY is true', () => {
		const proc = mockProcess({ stdout: { isTTY: true, write: vi.fn() } });
		const adapter = createBunAdapter(proc);
		expect(adapter.isTTY).toBe(true);
	});

	it('isTTY is false when stdout.isTTY is undefined', () => {
		const proc = mockProcess({ stdout: { write: vi.fn() } });
		const adapter = createBunAdapter(proc);
		expect(adapter.isTTY).toBe(false);
	});

	it('stdinIsTTY is true when stdin.isTTY is true', () => {
		const proc = mockProcess({ stdin: mockStdin({ isTTY: true }) });
		const adapter = createBunAdapter(proc);
		expect(adapter.stdinIsTTY).toBe(true);
	});

	it('stdinIsTTY is false when stdin.isTTY is undefined', () => {
		const proc = mockProcess({ stdin: mockStdin() });
		const adapter = createBunAdapter(proc);
		expect(adapter.stdinIsTTY).toBe(false);
	});
});

// ===================================================================
// createBunAdapter — stdin
// ===================================================================

describe('createBunAdapter — stdin', () => {
	it('stdin is a ReadFn (function)', () => {
		const proc = mockProcess();
		const adapter = createBunAdapter(proc);
		expect(typeof adapter.stdin).toBe('function');
	});
});
