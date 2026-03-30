/**
 * Locks runtime compatibility docs and package metadata to the shared
 * runtime support matrix.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { formatRuntimeRequirement, SUPPORTED_RUNTIMES } from './support.ts';

function readUtf8(path: URL): Promise<string> {
	return readFile(path, 'utf8');
}

function parsePackageEngines(contents: string): Readonly<Record<string, string | undefined>> {
	const parsed = JSON.parse(contents);
	if (typeof parsed !== 'object' || parsed === null || !('engines' in parsed)) {
		throw new Error('package.json is missing engines');
	}

	const engines = parsed.engines;
	if (typeof engines !== 'object' || engines === null) {
		throw new Error('package.json engines must be an object');
	}

	const result: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(engines)) {
		result[key] = typeof value === 'string' ? value : undefined;
	}

	return result;
}

describe('runtime compatibility matrix', () => {
	it('matches package.json engines', async () => {
		const packageJson = await readUtf8(new URL('../../package.json', import.meta.url));
		const engines = parsePackageEngines(packageJson);

		for (const runtime of SUPPORTED_RUNTIMES) {
			expect(engines[runtime.runtime]).toBe(runtime.engineRange);
		}
	});

	it('documents the guide runtime support matrix', async () => {
		const docs = await readUtf8(new URL('../../docs/guide/runtime.md', import.meta.url));

		for (const runtime of SUPPORTED_RUNTIMES) {
			expect(docs).toContain(formatRuntimeRequirement(runtime.runtime));
			expect(docs).toContain(runtime.packageName);
		}
		expect(docs).toContain('Adapters validate these minimum versions during creation.');
	});

	it('documents the reference runtime support matrix', async () => {
		const docs = await readUtf8(new URL('../../docs/reference/runtime.md', import.meta.url));

		for (const runtime of SUPPORTED_RUNTIMES) {
			expect(docs).toContain(formatRuntimeRequirement(runtime.runtime));
			expect(docs).toContain(runtime.adapterName);
		}
	});

	it('mentions the same minimum versions in getting started', async () => {
		const docs = await readUtf8(new URL('../../docs/guide/getting-started.md', import.meta.url));

		for (const runtime of SUPPORTED_RUNTIMES) {
			expect(docs).toContain(formatRuntimeRequirement(runtime.runtime));
		}
	});
});
