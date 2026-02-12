/**
 * Unit tests for package.json auto-discovery and CLI name inference.
 *
 * Tests the discoverPackageJson() walk-up, field extraction, edge cases
 * (malformed JSON, missing fields, non-object roots), and inferCliName()
 * resolution order (bin → name → undefined).
 */
import { describe, expect, it } from 'vitest';
import type { PackageJsonAdapter } from './package-json.ts';
import { discoverPackageJson, inferCliName } from './package-json.ts';

// ===================================================================
// Test helpers
// ===================================================================

/** Create a minimal adapter with a virtual filesystem. */
function createAdapter(
	files: Readonly<Record<string, string>>,
	cwd = '/projects/myapp',
): PackageJsonAdapter {
	return {
		cwd,
		readFile: async (path: string) => files[path] ?? null,
	};
}

// ===================================================================
// discoverPackageJson — walk-up resolution
// ===================================================================

describe('discoverPackageJson — walk-up resolution', () => {
	it('finds package.json in cwd', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '{"name":"myapp","version":"1.0.0"}',
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toEqual({
			name: 'myapp',
			version: '1.0.0',
			description: undefined,
			bin: undefined,
		});
	});

	it('walks up to parent directory', async () => {
		const adapter = createAdapter(
			{
				'/projects/package.json': '{"name":"root","version":"2.0.0"}',
			},
			'/projects/myapp/src',
		);

		const result = await discoverPackageJson(adapter);
		expect(result).toEqual({
			name: 'root',
			version: '2.0.0',
			description: undefined,
			bin: undefined,
		});
	});

	it('finds first package.json when multiple exist in ancestor chain', async () => {
		const adapter = createAdapter(
			{
				'/projects/myapp/package.json': '{"name":"inner","version":"1.0.0"}',
				'/projects/package.json': '{"name":"outer","version":"2.0.0"}',
			},
			'/projects/myapp/src',
		);

		const result = await discoverPackageJson(adapter);
		expect(result?.name).toBe('inner');
	});

	it('returns null when no package.json found', async () => {
		const adapter = createAdapter({});

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});

	it('walks up to root directory', async () => {
		const adapter = createAdapter(
			{
				'/package.json': '{"name":"root-pkg","version":"0.1.0"}',
			},
			'/a/b/c/d',
		);

		const result = await discoverPackageJson(adapter);
		expect(result?.name).toBe('root-pkg');
	});
});

// ===================================================================
// discoverPackageJson — field extraction
// ===================================================================

describe('discoverPackageJson — field extraction', () => {
	it('extracts all fields', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': JSON.stringify({
				name: '@scope/myapp',
				version: '3.2.1',
				description: 'My awesome app',
				bin: { mycli: './dist/cli.js' },
			}),
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toEqual({
			name: '@scope/myapp',
			version: '3.2.1',
			description: 'My awesome app',
			bin: { mycli: './dist/cli.js' },
		});
	});

	it('handles string bin field', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': JSON.stringify({
				name: 'myapp',
				bin: './dist/cli.js',
			}),
		});

		const result = await discoverPackageJson(adapter);
		expect(result?.bin).toBe('./dist/cli.js');
	});

	it('returns undefined for missing fields', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '{}',
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toEqual({
			name: undefined,
			version: undefined,
			description: undefined,
			bin: undefined,
		});
	});

	it('ignores non-string name/version/description', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': JSON.stringify({
				name: 123,
				version: true,
				description: ['array'],
			}),
		});

		const result = await discoverPackageJson(adapter);
		expect(result?.name).toBeUndefined();
		expect(result?.version).toBeUndefined();
		expect(result?.description).toBeUndefined();
	});

	it('ignores bin with non-string values', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': JSON.stringify({
				name: 'myapp',
				bin: { mycli: 123 },
			}),
		});

		const result = await discoverPackageJson(adapter);
		expect(result?.bin).toBeUndefined();
	});

	it('ignores array bin field', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': JSON.stringify({
				name: 'myapp',
				bin: ['./dist/cli.js'],
			}),
		});

		const result = await discoverPackageJson(adapter);
		expect(result?.bin).toBeUndefined();
	});
});

// ===================================================================
// discoverPackageJson — error resilience
// ===================================================================

describe('discoverPackageJson — error resilience', () => {
	it('returns null for malformed JSON', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '{bad json',
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});

	it('returns null for array root', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '[1,2,3]',
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});

	it('returns null for string root', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '"just a string"',
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});

	it('returns null for null root', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': 'null',
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});

	it('returns null for number root', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '42',
		});

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});

	it('returns null when readFile throws (e.g. permission error)', async () => {
		const adapter: PackageJsonAdapter = {
			cwd: '/projects/myapp',
			readFile: () => Promise.reject(new Error('EACCES: permission denied')),
		};

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});

	it('skips throwing directory and finds package.json in ancestor', async () => {
		let calls = 0;
		const adapter: PackageJsonAdapter = {
			cwd: '/projects/myapp/src',
			readFile: async (path: string) => {
				calls++;
				if (path === '/projects/myapp/src/package.json') {
					throw new Error('EACCES: permission denied');
				}
				if (path === '/projects/myapp/package.json') {
					return '{"name":"myapp","version":"2.0.0"}';
				}
				return null;
			},
		};

		const result = await discoverPackageJson(adapter);
		expect(result).not.toBeNull();
		expect(result?.name).toBe('myapp');
		expect(calls).toBeGreaterThanOrEqual(2);
	});
});

// ===================================================================
// discoverPackageJson — Windows paths
// ===================================================================

describe('discoverPackageJson — Windows paths', () => {
	it('walks up Windows paths', async () => {
		const adapter = createAdapter(
			{
				'C:\\Users\\dev\\package.json': '{"name":"win-app","version":"1.0.0"}',
			},
			'C:\\Users\\dev\\projects\\myapp',
		);

		const result = await discoverPackageJson(adapter);
		expect(result?.name).toBe('win-app');
	});

	it('terminates at Windows drive root', async () => {
		const adapter = createAdapter({}, 'C:\\Users\\dev');

		const result = await discoverPackageJson(adapter);
		expect(result).toBeNull();
	});
});

// ===================================================================
// inferCliName — resolution order
// ===================================================================

describe('inferCliName — resolution order', () => {
	it('prefers first bin key', () => {
		const name = inferCliName({
			name: 'pkg-name',
			version: undefined,
			description: undefined,
			bin: { mycli: './dist/cli.js', other: './dist/other.js' },
		});
		expect(name).toBe('mycli');
	});

	it('falls back to package name', () => {
		const name = inferCliName({
			name: 'my-tool',
			version: undefined,
			description: undefined,
			bin: undefined,
		});
		expect(name).toBe('my-tool');
	});

	it('strips scope from package name', () => {
		const name = inferCliName({
			name: '@scope/my-tool',
			version: undefined,
			description: undefined,
			bin: undefined,
		});
		expect(name).toBe('my-tool');
	});

	it('returns undefined when no name or bin', () => {
		const name = inferCliName({
			name: undefined,
			version: undefined,
			description: undefined,
			bin: undefined,
		});
		expect(name).toBeUndefined();
	});

	it('ignores string bin (not useful for name inference)', () => {
		const name = inferCliName({
			name: 'fallback',
			version: undefined,
			description: undefined,
			bin: './dist/cli.js',
		});
		// String bin has no key to extract — falls back to name
		expect(name).toBe('fallback');
	});

	it('ignores empty bin object', () => {
		const name = inferCliName({
			name: 'fallback',
			version: undefined,
			description: undefined,
			bin: {},
		});
		expect(name).toBe('fallback');
	});
});
