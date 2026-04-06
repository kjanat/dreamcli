#!/usr/bin/env bun
/**
 * Verifies that `package.json` and `deno.json` declare the same version.
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

async function readDenoJson(): Promise<VersionFile> {
	try {
		return (await Bun.file('deno.json').json()) as VersionFile;
	} catch (error) {
		return failToLoad('deno.json', error);
	}
}

const pkg = await readPackageJson();
const deno = await readDenoJson();

if (!pkg.version) {
	console.error('✗ package.json missing "version"');
	process.exit(1);
}
if (!deno.version) {
	console.error('✗ deno.json missing "version"');
	process.exit(1);
}

if (pkg.version !== deno.version) {
	console.error(`✗ version mismatch — package.json: ${pkg.version}, deno.json: ${deno.version}`);
	process.exit(1);
}

console.log(`✓ versions in sync: ${pkg.version}`);
