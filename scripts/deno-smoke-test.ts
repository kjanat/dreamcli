#!/usr/bin/env -S deno run --allow-read --allow-env
/**
 * Deno adapter smoke test.
 *
 * Runs under Deno to verify the built package works on a real Deno runtime.
 * This complements the vitest-based unit tests (which run under Node/Bun
 * with mock injection) by exercising the adapter against actual Deno APIs.
 *
 * Usage: deno run --allow-read --allow-env scripts/deno-smoke-test.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — a check failed
 */

import type { RuntimeAdapter } from '#dreamcli/runtime';

// Import from built output (not source) to verify the published shape.
// Use a file URL expression so repository typecheck does not require a prebuilt dist/.
const runtimeModuleUrl = new URL('../dist/runtime.mjs', import.meta.url).href;
const runtimeModule = await import(runtimeModuleUrl);

function failBoundary(message: string): never {
	throw new Error(`${message} (module: ${runtimeModuleUrl})`);
}

function assertRuntimeAdapter(value: unknown): RuntimeAdapter {
	if (typeof value !== 'object' || value === null) {
		return failBoundary('createDenoAdapter() did not return an adapter object');
	}

	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.stdout !== 'function' ||
		typeof candidate.stderr !== 'function' ||
		typeof candidate.stdin !== 'function' ||
		typeof candidate.readStdin !== 'function' ||
		typeof candidate.readFile !== 'function' ||
		typeof candidate.exit !== 'function' ||
		typeof candidate.cwd !== 'string' ||
		typeof candidate.homedir !== 'string' ||
		typeof candidate.configDir !== 'string' ||
		typeof candidate.isTTY !== 'boolean' ||
		typeof candidate.stdinIsTTY !== 'boolean' ||
		!Array.isArray(candidate.argv) ||
		typeof candidate.env !== 'object' ||
		candidate.env === null
	) {
		return failBoundary('createDenoAdapter() returned a value that does not match RuntimeAdapter');
	}

	return value as RuntimeAdapter;
}

if (typeof runtimeModule.createDenoAdapter !== 'function') {
	failBoundary('Expected createDenoAdapter export to be a function');
}

const createDenoAdapter = runtimeModule.createDenoAdapter;

let failures = 0;

function assert(condition: boolean, message: string): void {
	if (condition) {
		console.log(`  ✓ ${message}`);
	} else {
		console.error(`  ✗ ${message}`);
		failures += 1;
	}
}

// ───────────────────────────────────────────────────────────────────
// 1. Adapter creation
// ───────────────────────────────────────────────────────────────────

console.log('createDenoAdapter()');

const adapter = assertRuntimeAdapter(createDenoAdapter());

// ───────────────────────────────────────────────────────────────────
// 2. argv — should have synthetic prefix + Deno.args
// ───────────────────────────────────────────────────────────────────

console.log('\nargv');

assert(Array.isArray(adapter.argv), 'argv is an array');
assert(adapter.argv.length >= 2, 'argv has at least 2 entries (synthetic prefix)');
assert(adapter.argv[0] === 'deno', 'argv[0] is "deno"');
assert(adapter.argv[1] === 'run', 'argv[1] is "run"');

// ───────────────────────────────────────────────────────────────────
// 3. Environment
// ───────────────────────────────────────────────────────────────────

console.log('\nenv');

assert(typeof adapter.env === 'object', 'env is an object');
// PATH should be available (--allow-env granted)
const hasPath = adapter.env.PATH !== undefined || adapter.env.Path !== undefined;
assert(hasPath, 'env contains PATH');

// ───────────────────────────────────────────────────────────────────
// 4. cwd
// ───────────────────────────────────────────────────────────────────

console.log('\ncwd');

assert(typeof adapter.cwd === 'string', 'cwd is a string');
assert(adapter.cwd.length > 0, 'cwd is non-empty');

// ───────────────────────────────────────────────────────────────────
// 5. I/O functions
// ───────────────────────────────────────────────────────────────────

console.log('\nI/O');

assert(typeof adapter.stdout === 'function', 'stdout is a function');
assert(typeof adapter.stderr === 'function', 'stderr is a function');
assert(typeof adapter.stdin === 'function', 'stdin is a function');

// Exercise stdout/stderr — should not throw
adapter.stdout('');
adapter.stderr('');

// ───────────────────────────────────────────────────────────────────
// 6. TTY detection
// ───────────────────────────────────────────────────────────────────

console.log('\nTTY');

assert(typeof adapter.isTTY === 'boolean', 'isTTY is a boolean');
assert(typeof adapter.stdinIsTTY === 'boolean', 'stdinIsTTY is a boolean');

// ───────────────────────────────────────────────────────────────────
// 7. Filesystem
// ───────────────────────────────────────────────────────────────────

console.log('\nfilesystem');

assert(typeof adapter.readFile === 'function', 'readFile is a function');
assert(typeof adapter.homedir === 'string', 'homedir is a string');
assert(typeof adapter.configDir === 'string', 'configDir is a string');

// readFile should return contents for existing file
const pkg = await adapter.readFile('./package.json');
assert(pkg !== null, 'readFile returns content for existing file');
assert(typeof pkg === 'string' && pkg.includes('dreamcli'), 'readFile content contains "dreamcli"');

// readFile should return null for nonexistent file
const missing = await adapter.readFile('./nonexistent-file-12345.json');
assert(missing === null, 'readFile returns null for nonexistent file');

// ───────────────────────────────────────────────────────────────────
// 8. exit function
// ───────────────────────────────────────────────────────────────────

console.log('\nexit');

assert(typeof adapter.exit === 'function', 'exit is a function');

// ───────────────────────────────────────────────────────────────────
// Summary
// ───────────────────────────────────────────────────────────────────

console.log('');
if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	adapter.exit(1);
} else {
	console.log('All checks passed');
	adapter.exit(0);
}
