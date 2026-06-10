/**
 * Unit tests for package.json auto-discovery and CLI name inference.
 *
 * Tests the discoverPackageJson() walk-up, field extraction, edge cases
 * (malformed JSON, missing fields, non-object roots), and inferCliName()
 * resolution order (bin → name → undefined).
 */
import { describe, expect, it } from 'vitest';
import type { PackageJsonAdapter } from './package-json.ts';
import { discoverPackageJson, inferCliName, packageRepositoryUrl } from './package-json.ts';

// === Test helpers

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

// === discoverPackageJson

describe('discoverPackageJson', () => {
	// --- walk-up resolution

	describe('walk-up resolution', () => {
		it('finds package.json in cwd', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '{"name":"myapp","version":"1.0.0"}',
			});

			const result = await discoverPackageJson(adapter);
			expect(result).toEqual({
				name: 'myapp',
				version: '1.0.0',
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

	// --- explicit startDir

	describe('explicit startDir', () => {
		it('walks from explicit startDir instead of adapter.cwd', async () => {
			const adapter = createAdapter(
				{
					'/anchor/package.json': '{"name":"anchored","version":"7.0.0"}',
					'/projects/myapp/package.json': '{"name":"cwd-pkg","version":"1.0.0"}',
				},
				'/projects/myapp',
			);

			const result = await discoverPackageJson(adapter, '/anchor');
			expect(result).toEqual({ name: 'anchored', version: '7.0.0' });
		});

		it('walks up from a startDir deeper than the package.json', async () => {
			const adapter = createAdapter(
				{
					'/anchor/package.json': '{"version":"3.0.0"}',
				},
				'/somewhere/else',
			);

			const result = await discoverPackageJson(adapter, '/anchor/dist/sub');
			expect(result?.version).toBe('3.0.0');
		});

		it('treats a file-like startDir as a directory first, then walks up', async () => {
			const probed: string[] = [];
			const adapter: PackageJsonAdapter = {
				cwd: '/test',
				readFile: async (path: string) => {
					probed.push(path);
					if (path === '/pkg/package.json') return '{"name":"pkg","version":"9.9.9"}';
					return null;
				},
			};

			// A file path (e.g. fileURLToPath(import.meta.url)) is probed as a
			// directory first (no hit), then the walk-up reaches the real parent.
			const result = await discoverPackageJson(adapter, '/pkg/dist/cli.js');
			expect(result?.version).toBe('9.9.9');
			expect(probed).toEqual([
				'/pkg/dist/cli.js/package.json',
				'/pkg/dist/package.json',
				'/pkg/package.json',
			]);
		});

		it('falls back to adapter.cwd when startDir is undefined', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '{"version":"1.2.3"}',
			});

			const result = await discoverPackageJson(adapter, undefined);
			expect(result?.version).toBe('1.2.3');
		});

		it('returns null when startDir chain has no package.json', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '{"version":"1.2.3"}',
			});

			const result = await discoverPackageJson(adapter, '/no/such/dir');
			expect(result).toBeNull();
		});
	});

	// --- field extraction

	describe('field extraction', () => {
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
			expect(result).toEqual({});
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

		it('extracts homepage and string repository', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': JSON.stringify({
					homepage: 'https://myapp.dev',
					repository: 'github:me/myapp',
				}),
			});

			const result = await discoverPackageJson(adapter);
			expect(result?.homepage).toBe('https://myapp.dev');
			expect(result?.repository).toBe('github:me/myapp');
		});

		it('extracts object repository (type/url/directory)', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': JSON.stringify({
					repository: {
						type: 'git',
						url: 'git+https://github.com/me/myapp.git',
						directory: 'packages/cli',
					},
				}),
			});

			const result = await discoverPackageJson(adapter);
			expect(result?.repository).toEqual({
				type: 'git',
				url: 'git+https://github.com/me/myapp.git',
				directory: 'packages/cli',
			});
		});

		it('ignores non-string homepage and malformed repository', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': JSON.stringify({
					homepage: 42,
					repository: { type: 7, url: false },
				}),
			});

			const result = await discoverPackageJson(adapter);
			expect(result?.homepage).toBeUndefined();
			expect(result?.repository).toBeUndefined();
		});
	});

	// --- error resilience

	describe('error resilience', () => {
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

	// --- Windows paths

	describe('Windows paths', () => {
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
});

// === inferCliName — resolution order

describe('inferCliName — resolution order', () => {
	it('prefers first bin key', () => {
		const name = inferCliName({
			name: 'pkg-name',
			bin: { mycli: './dist/cli.js', other: './dist/other.js' },
		});
		expect(name).toBe('mycli');
	});

	it('falls back to package name', () => {
		const name = inferCliName({
			name: 'my-tool',
		});
		expect(name).toBe('my-tool');
	});

	it('strips scope from package name', () => {
		const name = inferCliName({
			name: '@scope/my-tool',
		});
		expect(name).toBe('my-tool');
	});

	it('returns undefined when no name or bin', () => {
		const name = inferCliName({});
		expect(name).toBeUndefined();
	});

	it('ignores string bin (not useful for name inference)', () => {
		const name = inferCliName({
			name: 'fallback',
			bin: './dist/cli.js',
		});
		// String bin has no key to extract — falls back to name
		expect(name).toBe('fallback');
	});

	it('ignores empty bin object', () => {
		const name = inferCliName({
			name: 'fallback',
			bin: {},
		});
		expect(name).toBe('fallback');
	});
});

// === packageRepositoryUrl — repository field normalization

describe('packageRepositoryUrl — repository field normalization', () => {
	it('strips git+ prefix and .git suffix from https URLs', () => {
		expect(packageRepositoryUrl({ repository: 'git+https://github.com/me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('passes plain https URLs through (trailing slash removed)', () => {
		expect(packageRepositoryUrl({ repository: 'https://github.com/me/myapp/' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('resolves the object form via its url field', () => {
		expect(
			packageRepositoryUrl({
				repository: { type: 'git', url: 'git+https://github.com/me/myapp.git' },
			}),
		).toBe('https://github.com/me/myapp');
	});

	it('converts scp-style locators (git@host:path)', () => {
		expect(packageRepositoryUrl({ repository: 'git@github.com:me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('converts git:// and ssh:// URLs to https', () => {
		expect(packageRepositoryUrl({ repository: 'git://github.com/me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
		expect(packageRepositoryUrl({ repository: 'ssh://git@github.com/me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('expands github/gitlab/bitbucket shorthands', () => {
		expect(packageRepositoryUrl({ repository: 'github:me/myapp' })).toBe(
			'https://github.com/me/myapp',
		);
		expect(packageRepositoryUrl({ repository: 'gitlab:me/myapp' })).toBe(
			'https://gitlab.com/me/myapp',
		);
		expect(packageRepositoryUrl({ repository: 'bitbucket:me/myapp' })).toBe(
			'https://bitbucket.org/me/myapp',
		);
	});

	it('treats bare user/repo as a GitHub shorthand (npm convention)', () => {
		expect(packageRepositoryUrl({ repository: 'me/myapp' })).toBe('https://github.com/me/myapp');
	});

	it('returns undefined for missing, empty, or unrecognised locators', () => {
		expect(packageRepositoryUrl({})).toBeUndefined();
		expect(packageRepositoryUrl({ repository: '  ' })).toBeUndefined();
		expect(packageRepositoryUrl({ repository: 'not a repo' })).toBeUndefined();
		expect(packageRepositoryUrl({ repository: { type: 'git' } })).toBeUndefined();
	});
});
