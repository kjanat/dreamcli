/**
 * Unit tests for manifest auto-discovery and CLI name inference.
 *
 * Tests the discoverManifest() walk-up, field extraction, edge cases
 * (malformed JSON, missing fields, non-object roots), and inferCliName()
 * resolution order (bin → name → undefined).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isCLIError } from '#internals/core/errors/index.ts';
import type { PackageJsonAdapter } from './package-json.ts';
import { discoverManifest, inferCliName, packageRepositoryUrl } from './package-json.ts';

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

// === discoverManifest — default package.json discovery

describe('discoverManifest — package.json defaults', () => {
	// --- walk-up resolution

	describe('walk-up resolution', () => {
		it('walks up to parent directory', async () => {
			const adapter = createAdapter(
				{
					'/projects/package.json': '{"name":"root","version":"2.0.0"}',
				},
				'/projects/myapp/src',
			);

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter);
			expect(result?.name).toBe('inner');
		});

		it('returns null when no package.json found', async () => {
			const adapter = createAdapter({});

			const result = await discoverManifest(adapter);
			expect(result).toBeNull();
		});

		it('walks up to root directory', async () => {
			const adapter = createAdapter(
				{
					'/package.json': '{"name":"root-pkg","version":"0.1.0"}',
				},
				'/a/b/c/d',
			);

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter, { startDir: '/anchor' });
			expect(result).toEqual({ name: 'anchored', version: '7.0.0' });
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
			const result = await discoverManifest(adapter, { startDir: '/pkg/dist/cli.js' });
			expect(result?.version).toBe('9.9.9');
			expect(probed).toEqual([
				'/pkg/dist/cli.js/package.json',
				'/pkg/dist/package.json',
				'/pkg/package.json',
			]);
		});

		it('falls back to adapter.cwd when startDir is omitted', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '{"version":"1.2.3"}',
			});

			const result = await discoverManifest(adapter, {});
			expect(result?.version).toBe('1.2.3');
		});

		it('returns null when startDir chain has no package.json', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '{"version":"1.2.3"}',
			});

			const result = await discoverManifest(adapter, { startDir: '/no/such/dir' });
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

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter);
			expect(result?.bin).toBe('./dist/cli.js');
		});

		it('skips a metadata-less manifest and keeps looking (returns null when none exists)', async () => {
			// A package.json with no recognized metadata fields is not a discovery
			// hit: the walk-up continues so a sibling/parent manifest can win.
			const adapter = createAdapter({
				'/projects/myapp/package.json': '{}',
			});

			const result = await discoverManifest(adapter);
			expect(result).toBeNull();
		});

		it('ignores non-string name/version/description', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': JSON.stringify({
					name: 123,
					version: true,
					description: ['array'],
				}),
			});

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter);
			expect(result?.bin).toBeUndefined();
		});

		it('ignores array bin field', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': JSON.stringify({
					name: 'myapp',
					bin: ['./dist/cli.js'],
				}),
			});

			const result = await discoverManifest(adapter);
			expect(result?.bin).toBeUndefined();
		});

		it('extracts homepage and string repository', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': JSON.stringify({
					homepage: 'https://myapp.dev',
					repository: 'github:me/myapp',
				}),
			});

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter);
			expect(result?.homepage).toBeUndefined();
			expect(result?.repository).toBeUndefined();
		});
	});

	// --- error resilience

	describe('error resilience', () => {
		it('returns null for array root', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '[1,2,3]',
			});

			const result = await discoverManifest(adapter);
			expect(result).toBeNull();
		});

		it('returns null for string root', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '"just a string"',
			});

			const result = await discoverManifest(adapter);
			expect(result).toBeNull();
		});

		it('returns null for null root', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': 'null',
			});

			const result = await discoverManifest(adapter);
			expect(result).toBeNull();
		});

		it('returns null for number root', async () => {
			const adapter = createAdapter({
				'/projects/myapp/package.json': '42',
			});

			const result = await discoverManifest(adapter);
			expect(result).toBeNull();
		});

		it('returns null when readFile throws (e.g. permission error)', async () => {
			const adapter: PackageJsonAdapter = {
				cwd: '/projects/myapp',
				readFile: () => Promise.reject(new Error('EACCES: permission denied')),
			};

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter);
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

			const result = await discoverManifest(adapter);
			expect(result?.name).toBe('win-app');
		});

		it('terminates at Windows drive root', async () => {
			const adapter = createAdapter({}, 'C:\\Users\\dev');

			const result = await discoverManifest(adapter);
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

	describe('{ require: true }', () => {
		it('narrows the return type to string', () => {
			// Assignment to `string` (no undefined, no assertion) IS the test.
			const url: string = packageRepositoryUrl(
				{ repository: 'github:me/myapp' },
				{ require: true },
			);
			expect(url).toBe('https://github.com/me/myapp');
			expectTypeOf(
				packageRepositoryUrl({ repository: 'github:me/myapp' }, { require: true }),
			).toEqualTypeOf<string>();
			expectTypeOf(packageRepositoryUrl({ repository: 'github:me/myapp' })).toEqualTypeOf<
				string | undefined
			>();
		});

		it('throws INVALID_REPOSITORY when the field is missing', () => {
			try {
				packageRepositoryUrl({}, { require: true });
				expect.unreachable('expected INVALID_REPOSITORY');
			} catch (error) {
				if (!isCLIError(error)) throw error;
				expect(error.code).toBe('INVALID_REPOSITORY');
				expect(error.message).toContain("no 'repository' field");
			}
		});

		it('throws INVALID_REPOSITORY for unrecognised locators, naming the value', () => {
			expect(() => packageRepositoryUrl({ repository: 'not a repo' }, { require: true })).toThrow(
				/not a recognisable locator: "not a repo"/,
			);
			expect(() =>
				packageRepositoryUrl({ repository: { type: 'git' } }, { require: true }),
			).toThrow(/not a recognisable locator/);
		});

		it('require: false keeps the undefined-returning behavior', () => {
			expect(packageRepositoryUrl({}, { require: false })).toBeUndefined();
		});
	});
});

// === discoverManifest — generalized multi-file discovery

describe('discoverManifest', () => {
	it('defaults to package.json when no files are given', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '{"name":"myapp","version":"1.0.0"}',
		});

		expect(await discoverManifest(adapter)).toEqual({ name: 'myapp', version: '1.0.0' });
	});

	it('discovers deno.json when requested', async () => {
		const adapter = createAdapter({
			'/projects/myapp/deno.json': '{"name":"@scope/myapp","version":"3.1.0"}',
		});

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toEqual({
			name: '@scope/myapp',
			version: '3.1.0',
		});
	});

	it('falls back to jsr.json when deno.json is absent', async () => {
		const adapter = createAdapter({
			'/projects/myapp/jsr.json': '{"name":"@scope/myapp","version":"4.2.0"}',
		});

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toEqual({
			name: '@scope/myapp',
			version: '4.2.0',
		});
	});

	it('honours per-directory file priority (deno.json beats jsr.json in same dir)', async () => {
		const adapter = createAdapter({
			'/projects/myapp/deno.json': '{"version":"1.0.0"}',
			'/projects/myapp/jsr.json': '{"version":"9.9.9"}',
		});

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toEqual({
			version: '1.0.0',
		});
	});

	it('nearest directory wins over file order higher up', async () => {
		// jsr.json is nearer (cwd); deno.json sits higher. Nearest dir wins.
		const adapter = createAdapter(
			{
				'/projects/myapp/jsr.json': '{"version":"1.0.0"}',
				'/projects/deno.json': '{"version":"2.0.0"}',
			},
			'/projects/myapp',
		);

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toEqual({
			version: '1.0.0',
		});
	});

	it('walks up from an explicit startDir anchor', async () => {
		const adapter = createAdapter(
			{ '/lib/cli/deno.json': '{"version":"7.0.0"}' },
			'/somewhere/else',
		);

		expect(
			await discoverManifest(adapter, { startDir: '/lib/cli/bin', files: ['deno.json'] }),
		).toEqual({ version: '7.0.0' });
	});

	it('returns null when no candidate file is found', async () => {
		const adapter = createAdapter({ '/projects/myapp/package.json': '{"version":"1.0.0"}' });

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toBeNull();
	});

	it('falls through to jsr.json when deno.json in the same dir is malformed', async () => {
		const adapter = createAdapter({
			'/projects/myapp/deno.json': '{bad',
			'/projects/myapp/jsr.json': '{"version":"2.3.4"}',
		});

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toEqual({
			version: '2.3.4',
		});
	});

	it('walks up when the nearest dir holds only a malformed candidate', async () => {
		const adapter = createAdapter(
			{
				'/projects/myapp/deno.json': '{bad',
				'/projects/deno.json': '{"version":"5.0.0"}',
			},
			'/projects/myapp',
		);

		expect(await discoverManifest(adapter, { files: ['deno.json'] })).toEqual({
			version: '5.0.0',
		});
	});

	it('falls through to jsr.json when reading deno.json throws in the same dir', async () => {
		const adapter: PackageJsonAdapter = {
			cwd: '/projects/myapp',
			readFile: async (path: string) => {
				if (path === '/projects/myapp/deno.json') {
					throw new Error('EACCES: permission denied');
				}
				if (path === '/projects/myapp/jsr.json') {
					return '{"version":"6.7.8"}';
				}
				return null;
			},
		};

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toEqual({
			version: '6.7.8',
		});
	});

	it('returns null without reading when files is empty', async () => {
		let reads = 0;
		const adapter: PackageJsonAdapter = {
			cwd: '/projects/myapp',
			readFile: async () => {
				reads++;
				return null;
			},
		};

		expect(await discoverManifest(adapter, { files: [] })).toBeNull();
		expect(reads).toBe(0);
	});

	it('skips a config-only deno.json and uses jsr.json metadata in the same dir', async () => {
		// deno.json carries only config (tasks/imports), no CLI metadata — it
		// must NOT shadow the sibling jsr.json that holds the real version.
		const adapter = createAdapter({
			'/projects/myapp/deno.json':
				'{"tasks":{"dev":"deno run main.ts"},"imports":{"@std/":"jsr:@std/"}}',
			'/projects/myapp/jsr.json': '{"name":"@s/p","version":"1.2.3"}',
		});

		expect(await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] })).toEqual({
			name: '@s/p',
			version: '1.2.3',
		});
	});

	it('walks past a metadata-less deno.json to a real manifest in a parent dir', async () => {
		// A config-only deno.json in cwd must not halt the walk-up.
		const adapter = createAdapter(
			{
				'/projects/myapp/deno.json': '{"tasks":{"dev":"deno run main.ts"}}',
				'/projects/deno.json': '{"version":"2.0.0"}',
			},
			'/projects/myapp',
		);

		expect(await discoverManifest(adapter, { files: ['deno.json'] })).toEqual({
			version: '2.0.0',
		});
	});

	// --- metadata acceptance via non-name/version fields
	// manifestHasMetadata accepts a hit on ANY recognized field, not just
	// name/version/description. A manifest carrying only repository/homepage/bin
	// must still be returned so deriveHelpLinks can surface its links — guarding
	// against a regression that drops one of those OR-clauses.

	it('accepts a manifest whose only field is repository', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '{"repository":"github:me/myapp"}',
		});

		expect(await discoverManifest(adapter)).toEqual({ repository: 'github:me/myapp' });
	});

	it('accepts a manifest whose only field is homepage', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '{"homepage":"https://myapp.dev"}',
		});

		expect(await discoverManifest(adapter)).toEqual({ homepage: 'https://myapp.dev' });
	});

	it('accepts a manifest whose only field is bin', async () => {
		const adapter = createAdapter({
			'/projects/myapp/package.json': '{"bin":{"mycli":"./dist/cli.js"}}',
		});

		expect(await discoverManifest(adapter)).toEqual({ bin: { mycli: './dist/cli.js' } });
	});

	it('skips a repository/homepage/bin-less manifest and keeps walking up', async () => {
		// A manifest with ONLY non-metadata fields (no name/version/description/
		// bin/homepage/repository) is not a hit — the nearer dir must not shadow a
		// real manifest higher up.
		const adapter = createAdapter(
			{
				'/projects/myapp/package.json': '{"private":true,"dependencies":{"x":"1.0.0"}}',
				'/projects/package.json': '{"repository":"github:me/root"}',
			},
			'/projects/myapp',
		);

		expect(await discoverManifest(adapter)).toEqual({ repository: 'github:me/root' });
	});

	// --- JSONC tolerance (deno.json commonly carries comments / trailing commas)

	it('parses a deno.json with line and block comments', async () => {
		const adapter = createAdapter({
			'/projects/myapp/deno.json': `{
				// the package version
				"name": "@scope/app",
				/* block comment */
				"version": "1.2.3"
			}`,
		});

		expect(await discoverManifest(adapter, { files: ['deno.json'] })).toEqual({
			name: '@scope/app',
			version: '1.2.3',
		});
	});

	it('parses a manifest with trailing commas', async () => {
		const adapter = createAdapter({
			'/projects/myapp/deno.json': '{"name":"app","version":"2.0.0",}',
		});

		expect(await discoverManifest(adapter, { files: ['deno.json'] })).toEqual({
			name: 'app',
			version: '2.0.0',
		});
	});

	it('does NOT strip comment markers inside string values (URL safety)', async () => {
		// `//` in https:// and a `/*` inside a string must survive — the stripper is
		// string-aware. A trailing comma + a real comment exercise both passes.
		const adapter = createAdapter({
			'/projects/myapp/deno.json': `{
				"version": "9.9.9", // ship it
				"homepage": "https://example.com/a",
				"repository": "git+https://github.com/me/repo.git",
			}`,
		});

		expect(await discoverManifest(adapter, { files: ['deno.json'] })).toEqual({
			version: '9.9.9',
			homepage: 'https://example.com/a',
			repository: 'git+https://github.com/me/repo.git',
		});
	});

	it('discovers a deno.jsonc candidate', async () => {
		const adapter = createAdapter({
			'/projects/myapp/deno.jsonc': '{\n  "version": "3.3.3" // jsonc\n}',
		});

		expect(await discoverManifest(adapter, { files: ['deno.jsonc'] })).toEqual({
			version: '3.3.3',
		});
	});

	it('still returns null for genuinely malformed content', async () => {
		const adapter = createAdapter({
			'/projects/myapp/deno.json': '{ not valid: at all ]',
		});

		expect(await discoverManifest(adapter, { files: ['deno.json'] })).toBeNull();
	});
});

// === inferCliName — scope-stripping control

describe('inferCliName — scope handling', () => {
	it('strips the scope by default', () => {
		expect(inferCliName({ name: '@scope/mycli' })).toBe('mycli');
	});

	it('keeps the scope when stripScope is false', () => {
		expect(inferCliName({ name: '@scope/mycli' }, { stripScope: false })).toBe('@scope/mycli');
	});

	it('strips when stripScope is explicitly true', () => {
		expect(inferCliName({ name: '@scope/mycli' }, { stripScope: true })).toBe('mycli');
	});

	it('bin keys ignore stripScope (never scoped)', () => {
		expect(inferCliName({ bin: { tool: './c.js' }, name: '@scope/x' }, { stripScope: false })).toBe(
			'tool',
		);
	});
});
