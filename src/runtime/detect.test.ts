/**
 * Tests for runtime detection — detectRuntime() and RUNTIMES constant.
 *
 * All tests use the `globals` parameter to inject controlled globalThis
 * shapes, avoiding mutation of the real `globalThis`.
 */

import { describe, expect, it } from 'vitest';
import type { GlobalForDetect, Runtime } from './detect.ts';
import { detectRuntime, RUNTIMES } from './detect.ts';

function currentHostRuntime(): Runtime {
	const globals = globalThis as unknown as GlobalForDetect;
	if (typeof globals.Bun?.version === 'string') return 'bun';
	if (typeof globals.Deno?.version?.deno === 'string') return 'deno';
	if (typeof globals.process?.versions?.node === 'string') return 'node';
	return 'unknown';
}

// === RUNTIMES constant

describe('RUNTIMES constant', () => {
	it('contains all four runtime values', () => {
		expect(RUNTIMES).toEqual(['node', 'bun', 'deno', 'unknown']);
	});

	it('is a four-element array', () => {
		expect(RUNTIMES).toHaveLength(4);
	});
});

// === detectRuntime — mocked globalThis

describe('detectRuntime — environment detection', () => {
	// -------------------------------------------------------------------
	// Node.js
	// -------------------------------------------------------------------

	it('detects Node.js from process.versions.node', () => {
		const globals: GlobalForDetect = {
			process: { versions: { node: '22.0.0' } },
		};
		expect(detectRuntime(globals)).toBe('node' satisfies Runtime);
	});

	it('detects Node.js with minimal process shape', () => {
		const globals: GlobalForDetect = {
			process: { versions: { node: '18.17.1' } },
		};
		expect(detectRuntime(globals)).toBe('node');
	});

	// -------------------------------------------------------------------
	// Bun
	// -------------------------------------------------------------------

	it('detects Bun from Bun.version', () => {
		const globals: GlobalForDetect = {
			Bun: { version: '1.1.0' },
		};
		expect(detectRuntime(globals)).toBe('bun' satisfies Runtime);
	});

	it('detects Bun even when process.versions.node is also present', () => {
		const globals: GlobalForDetect = {
			Bun: { version: '1.1.0' },
			process: { versions: { node: '22.0.0' } },
		};
		expect(detectRuntime(globals)).toBe('bun');
	});

	// -------------------------------------------------------------------
	// Deno
	// -------------------------------------------------------------------

	it('detects Deno from Deno.version.deno', () => {
		const globals: GlobalForDetect = {
			Deno: { version: { deno: '2.0.0' } },
		};
		expect(detectRuntime(globals)).toBe('deno' satisfies Runtime);
	});

	it('detects Deno even when process is also present', () => {
		// Some Deno compat layers add a `process` global
		const globals: GlobalForDetect = {
			Deno: { version: { deno: '2.0.0' } },
			process: { versions: { node: '20.0.0' } },
		};
		expect(detectRuntime(globals)).toBe('deno');
	});

	// -------------------------------------------------------------------
	// Unknown
	// -------------------------------------------------------------------

	it('returns unknown when no runtime markers are present', () => {
		const globals: GlobalForDetect = {};
		expect(detectRuntime(globals)).toBe('unknown' satisfies Runtime);
	});

	it('returns unknown when process exists but versions.node is missing', () => {
		const globals: GlobalForDetect = {
			process: { versions: {} },
		};
		expect(detectRuntime(globals)).toBe('unknown');
	});

	it('returns unknown when process exists but versions is missing', () => {
		const globals: GlobalForDetect = {
			process: {},
		};
		expect(detectRuntime(globals)).toBe('unknown');
	});

	it('returns unknown when Bun exists but version is missing', () => {
		const globals: GlobalForDetect = {
			Bun: {},
		};
		expect(detectRuntime(globals)).toBe('unknown');
	});

	it('returns unknown when Deno exists but version.deno is missing', () => {
		const globals: GlobalForDetect = {
			Deno: { version: {} },
		};
		expect(detectRuntime(globals)).toBe('unknown');
	});

	it('returns unknown when Deno exists but version is missing', () => {
		const globals: GlobalForDetect = {
			Deno: {},
		};
		expect(detectRuntime(globals)).toBe('unknown');
	});
});

// === detectRuntime — detection priority

describe('detectRuntime — priority order', () => {
	it('Bun takes precedence over Deno and Node', () => {
		const globals: GlobalForDetect = {
			Bun: { version: '1.0.0' },
			Deno: { version: { deno: '2.0.0' } },
			process: { versions: { node: '22.0.0' } },
		};
		expect(detectRuntime(globals)).toBe('bun');
	});

	it('Deno takes precedence over Node', () => {
		const globals: GlobalForDetect = {
			Deno: { version: { deno: '2.0.0' } },
			process: { versions: { node: '22.0.0' } },
		};
		expect(detectRuntime(globals)).toBe('deno');
	});
});

// === detectRuntime — default (real globalThis)

describe('detectRuntime — default globalThis', () => {
	it('detects current runtime without explicit globals', () => {
		const rt = detectRuntime();
		expect(rt).toBe(currentHostRuntime());
	});

	it('returns a value that is a member of RUNTIMES', () => {
		const rt = detectRuntime();
		expect((RUNTIMES as readonly string[]).includes(rt)).toBe(true);
	});
});
