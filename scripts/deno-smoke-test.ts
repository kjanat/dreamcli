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

import type { RuntimeAdapter } from '../dist/runtime.mjs';
// Import from built output (not source) to verify the published shape
import { createDenoAdapter } from '../dist/runtime.mjs';

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

const adapter: RuntimeAdapter = createDenoAdapter();

assert(adapter !== null && adapter !== undefined, 'adapter is defined');

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
	Deno.exit(1);
} else {
	console.log('All checks passed');
}
