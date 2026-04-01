#!/usr/bin/env bun
/**
 * Verifies that `package.json` and `deno.jsonc` declare the same version.
 *
 * Exit codes:
 *   0 — versions match
 *   1 — versions differ or a file is unreadable
 */

const pkg = (await Bun.file('package.json').json()) as { version?: string };
const deno = Bun.JSON5.parse(await Bun.file('deno.jsonc').text()) as { version?: string };

if (!pkg.version) {
	console.error('✗ package.json missing "version"');
	process.exit(1);
}
if (!deno.version) {
	console.error('✗ deno.jsonc missing "version"');
	process.exit(1);
}

if (pkg.version !== deno.version) {
	console.error(`✗ version mismatch — package.json: ${pkg.version}, deno.jsonc: ${deno.version}`);
	process.exit(1);
}

console.log(`✓ versions in sync: ${pkg.version}`);
