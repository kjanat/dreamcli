#!/usr/bin/env bun
/**
 * Verifies that `package.json` and `deno.jsonc` declare the same version.
 *
 * Exit codes:
 *   0 — versions match
 *   1 — versions differ or a file is unreadable
 */

interface VersionFile {
	readonly version?: string;
}

function failToLoad(path: string, error: unknown): never {
	const details = error instanceof Error ? error.message : String(error);
	console.error(`✗ failed to load ${path}: ${details}`);
	process.exit(1);
}

async function readPackageJson(): Promise<VersionFile> {
	try {
		return (await Bun.file('package.json').json()) as VersionFile;
	} catch (error) {
		return failToLoad('package.json', error);
	}
}

async function readDenoJsonc(): Promise<VersionFile> {
	try {
		return Bun.JSON5.parse(await Bun.file('deno.jsonc').text()) as VersionFile;
	} catch (error) {
		return failToLoad('deno.jsonc', error);
	}
}

const pkg = await readPackageJson();
const deno = await readDenoJsonc();

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
