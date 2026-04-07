import { parse as parseTOML } from '@iarna/toml';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { CLIError } from '#internals/core/errors/index.ts';
import type { ConfigAdapter, ConfigDiscoveryResult, FormatLoader } from './index.ts';
import { buildConfigSearchPaths, configFormat, discoverConfig } from './index.ts';

// === Test helpers

/** Create a minimal adapter stub with a virtual filesystem. */
function stubAdapter(
	files?: Readonly<Record<string, string>>,
	overrides?: Partial<ConfigAdapter>,
): ConfigAdapter {
	return {
		cwd: overrides?.cwd ?? '/project',
		configDir: overrides?.configDir ?? '/home/alice/.config',
		readFile: overrides?.readFile ?? (async (path: string) => files?.[path] ?? null),
	};
}

/** TOML-ish loader stub for testing custom loader support. */
const tomlLoader: FormatLoader = {
	extensions: ['toml'],
	parse: (content: string): Record<string, unknown> => {
		// Trivial key = "value" parser for tests only
		const result: Record<string, unknown> = {};
		for (const line of content.split('\n')) {
			const match = /^(\w+)\s*=\s*"(.+)"$/.exec(line.trim());
			if (match?.[1] !== undefined && match[2] !== undefined) {
				result[match[1]] = match[2];
			}
		}
		return result;
	},
};

// === buildConfigSearchPaths

describe('buildConfigSearchPaths', () => {
	it('returns 3 JSON paths in priority order', () => {
		const paths = buildConfigSearchPaths('myapp', '/project', '/home/alice/.config');
		expect(paths).toEqual([
			'/project/.myapp.json',
			'/project/myapp.config.json',
			'/home/alice/.config/myapp/config.json',
		]);
	});

	it('uses backslash when base paths contain backslash', () => {
		const paths = buildConfigSearchPaths(
			'myapp',
			'C:\\Users\\alice\\project',
			'C:\\Users\\alice\\AppData\\Roaming',
		);
		expect(paths).toEqual([
			'C:\\Users\\alice\\project\\.myapp.json',
			'C:\\Users\\alice\\project\\myapp.config.json',
			'C:\\Users\\alice\\AppData\\Roaming\\myapp\\config.json',
		]);
	});

	it('includes additional extensions from loaders', () => {
		const paths = buildConfigSearchPaths('myapp', '/project', '/home/.config', [tomlLoader]);
		expect(paths).toEqual([
			'/project/.myapp.json',
			'/project/.myapp.toml',
			'/project/myapp.config.json',
			'/project/myapp.config.toml',
			'/home/.config/myapp/config.json',
			'/home/.config/myapp/config.toml',
		]);
	});

	it('deduplicates extensions across loaders', () => {
		const extraJsonLoader: FormatLoader = {
			extensions: ['json'],
			parse: JSON.parse as (content: string) => Record<string, unknown>,
		};
		const paths = buildConfigSearchPaths('myapp', '/p', '/c', [extraJsonLoader]);
		expect(paths).toEqual(['/p/.myapp.json', '/p/myapp.config.json', '/c/myapp/config.json']);
	});
});

// === discoverConfig

describe('discoverConfig', () => {
	// --- path probing

	describe('path probing', () => {
		it('returns { found: false } when no config files exist', async () => {
			const adapter = stubAdapter();
			const result = await discoverConfig('myapp', adapter);
			expect(result).toEqual({ found: false });
		});

		it('finds dotfile in cwd first', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{"source":"dotfile"}',
				'/project/myapp.config.json': '{"source":"explicit"}',
			});
			const result = await discoverConfig('myapp', adapter);
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.path).toBe('/project/.myapp.json');
				expect(result.data).toEqual({ source: 'dotfile' });
				expect(result.format).toBe('json');
			}
		});

		it('finds explicit config when dotfile absent', async () => {
			const adapter = stubAdapter({
				'/project/myapp.config.json': '{"source":"explicit"}',
			});
			const result = await discoverConfig('myapp', adapter);
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.path).toBe('/project/myapp.config.json');
				expect(result.data).toEqual({ source: 'explicit' });
			}
		});

		it('falls back to XDG config dir', async () => {
			const adapter = stubAdapter({
				'/home/alice/.config/myapp/config.json': '{"source":"xdg"}',
			});
			const result = await discoverConfig('myapp', adapter);
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.path).toBe('/home/alice/.config/myapp/config.json');
				expect(result.data).toEqual({ source: 'xdg' });
			}
		});

		it('stops at first match (does not merge)', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{"a":1}',
				'/home/alice/.config/myapp/config.json': '{"b":2}',
			});
			const result = await discoverConfig('myapp', adapter);
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.data).toEqual({ a: 1 });
				expect(result.data).not.toHaveProperty('b');
			}
		});
	});

	// --- explicit configPath

	describe('explicit configPath', () => {
		it('loads the exact path when it exists', async () => {
			const adapter = stubAdapter({
				'/custom/path.json': '{"explicit":true}',
			});
			const result = await discoverConfig('myapp', adapter, {
				configPath: '/custom/path.json',
			});
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.path).toBe('/custom/path.json');
				expect(result.data).toEqual({ explicit: true });
			}
		});

		it('throws CONFIG_NOT_FOUND when explicit path missing', async () => {
			const adapter = stubAdapter();
			await expect(
				discoverConfig('myapp', adapter, { configPath: '/missing.json' }),
			).rejects.toThrow(CLIError);

			try {
				await discoverConfig('myapp', adapter, { configPath: '/missing.json' });
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(CLIError);
				const err = e as CLIError;
				expect(err.code).toBe('CONFIG_NOT_FOUND');
				expect(err.details).toEqual({ path: '/missing.json' });
			}
		});

		it('skips default search paths when configPath provided', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{"default":true}',
			});
			await expect(discoverConfig('myapp', adapter, { configPath: '/other.json' })).rejects.toThrow(
				CLIError,
			);
		});
	});

	// --- custom searchPaths

	describe('custom searchPaths', () => {
		it('uses custom search paths instead of defaults', async () => {
			const adapter = stubAdapter({
				'/custom/a.json': '{"from":"custom"}',
			});
			const result = await discoverConfig('myapp', adapter, {
				searchPaths: ['/custom/a.json', '/custom/b.json'],
			});
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.path).toBe('/custom/a.json');
			}
		});

		it('returns { found: false } when no custom paths match', async () => {
			const adapter = stubAdapter();
			const result = await discoverConfig('myapp', adapter, {
				searchPaths: ['/nope.json'],
			});
			expect(result).toEqual({ found: false });
		});
	});

	// --- parse errors

	describe('parse errors', () => {
		it('throws CONFIG_PARSE_ERROR for invalid JSON', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{not valid json',
			});

			try {
				await discoverConfig('myapp', adapter);
				expect.unreachable('should have thrown');
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(CLIError);
				const err = e as CLIError;
				expect(err.code).toBe('CONFIG_PARSE_ERROR');
				expect(err.details?.['path']).toBe('/project/.myapp.json');
				expect(err.details?.['format']).toBe('json');
				expect(typeof err.details?.['message']).toBe('string');
			}
		});

		it('throws CONFIG_PARSE_ERROR when JSON is an array', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '[1,2,3]',
			});

			try {
				await discoverConfig('myapp', adapter);
				expect.unreachable('should have thrown');
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(CLIError);
				const err = e as CLIError;
				expect(err.code).toBe('CONFIG_PARSE_ERROR');
				expect(err.details?.['message']).toBe('Config must be a JSON object');
			}
		});

		it('throws CONFIG_PARSE_ERROR when JSON is a primitive', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '"just a string"',
			});

			try {
				await discoverConfig('myapp', adapter);
				expect.unreachable('should have thrown');
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(CLIError);
				const err = e as CLIError;
				expect(err.code).toBe('CONFIG_PARSE_ERROR');
			}
		});

		it('throws CONFIG_PARSE_ERROR when JSON is null', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': 'null',
			});

			try {
				await discoverConfig('myapp', adapter);
				expect.unreachable('should have thrown');
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(CLIError);
				const err = e as CLIError;
				expect(err.code).toBe('CONFIG_PARSE_ERROR');
			}
		});
	});

	// --- custom loaders

	describe('custom loaders', () => {
		it('uses custom loader for matching extension', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.toml': 'region = "eu"\nverbose = "true"',
			});
			const result = await discoverConfig('myapp', adapter, {
				loaders: [tomlLoader],
			});
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.path).toBe('/project/.myapp.toml');
				expect(result.data).toEqual({ region: 'eu', verbose: 'true' });
				expect(result.format).toBe('toml');
			}
		});

		it('JSON takes priority over TOML at same path level', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{"source":"json"}',
				'/project/.myapp.toml': 'source = "toml"',
			});
			const result = await discoverConfig('myapp', adapter, {
				loaders: [tomlLoader],
			});
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.format).toBe('json');
			}
		});

		it('throws CONFIG_UNKNOWN_FORMAT for unregistered extension', async () => {
			const adapter = stubAdapter({
				'/custom/config.yaml': 'key: value',
			});

			try {
				await discoverConfig('myapp', adapter, {
					searchPaths: ['/custom/config.yaml'],
				});
				expect.unreachable('should have thrown');
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(CLIError);
				const err = e as CLIError;
				expect(err.code).toBe('CONFIG_UNKNOWN_FORMAT');
				expect(err.details?.['extension']).toBe('yaml');
			}
		});

		it('custom loader can override built-in JSON loader', async () => {
			const customJsonLoader: FormatLoader = {
				extensions: ['json'],
				parse: (content: string) => {
					const data = JSON.parse(content) as Record<string, unknown>;
					return { ...data, _custom: true };
				},
			};
			const adapter = stubAdapter({
				'/project/.myapp.json': '{"key":"value"}',
			});
			const result = await discoverConfig('myapp', adapter, {
				loaders: [customJsonLoader],
			});
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.data).toEqual({ key: 'value', _custom: true });
			}
		});

		it('wraps custom loader errors as CONFIG_PARSE_ERROR', async () => {
			const failingLoader: FormatLoader = {
				extensions: ['ini'],
				parse: () => {
					throw new Error('INI parse failed at line 3');
				},
			};
			const adapter = stubAdapter({
				'/custom/config.ini': 'bad content',
			});

			try {
				await discoverConfig('myapp', adapter, {
					loaders: [failingLoader],
					searchPaths: ['/custom/config.ini'],
				});
				expect.unreachable('should have thrown');
			} catch (e: unknown) {
				expect(e).toBeInstanceOf(CLIError);
				const err = e as CLIError;
				expect(err.code).toBe('CONFIG_PARSE_ERROR');
				expect(err.details?.['message']).toBe('INI parse failed at line 3');
				expect(err.cause).toBeInstanceOf(Error);
			}
		});
	});

	// --- adapter error propagation

	describe('adapter error propagation', () => {
		it('propagates non-ENOENT readFile errors', async () => {
			const adapter = stubAdapter(undefined, {
				readFile: async () => {
					throw new Error('EACCES: permission denied');
				},
			});

			await expect(discoverConfig('myapp', adapter)).rejects.toThrow('EACCES: permission denied');
		});
	});

	// --- type narrowing

	describe('type narrowing', () => {
		it('found discriminant narrows to ConfigFound', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{"x":1}',
			});
			const result: ConfigDiscoveryResult = await discoverConfig('myapp', adapter);

			if (result.found) {
				// These would fail typecheck if narrowing is wrong
				const _path: string = result.path;
				const _data: Readonly<Record<string, unknown>> = result.data;
				const _format: string = result.format;
				expect(_path).toBe('/project/.myapp.json');
				expect(_data).toEqual({ x: 1 });
				expect(_format).toBe('json');
			} else {
				expect.unreachable('should have found config');
			}
		});

		it('not-found result has no extra properties', async () => {
			const adapter = stubAdapter();
			const result: ConfigDiscoveryResult = await discoverConfig('myapp', adapter);

			expect(result.found).toBe(false);
			if (!result.found) {
				expect(Object.keys(result)).toEqual(['found']);
			}
		});
	});

	// --- content edge cases

	describe('content edge cases', () => {
		it('accepts empty JSON object', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{}',
			});
			const result = await discoverConfig('myapp', adapter);
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.data).toEqual({});
			}
		});

		it('preserves deeply nested config values', async () => {
			const adapter = stubAdapter({
				'/project/.myapp.json': '{"deploy":{"region":"eu","replicas":3},"verbose":true}',
			});
			const result = await discoverConfig('myapp', adapter);
			expect(result.found).toBe(true);
			if (result.found) {
				expect(result.data).toEqual({
					deploy: { region: 'eu', replicas: 3 },
					verbose: true,
				});
			}
		});
	});
});

// === configFormat — convenience factory

describe('configFormat — convenience factory', () => {
	it('creates a FormatLoader with given extensions and parse', () => {
		const parse = (content: string): Record<string, unknown> => JSON.parse(content);
		const loader = configFormat(['yaml', 'yml'], parse);
		expect(loader.extensions).toEqual(['yaml', 'yml']);
		expect(loader.parse).toBe(parse);
	});

	it('accepts Bun parser signatures at the type level', () => {
		type ConfigParser = Parameters<typeof configFormat>[1];
		type AcceptsBunYaml = typeof Bun.YAML.parse extends ConfigParser ? true : false;
		type AcceptsBunToml = typeof Bun.TOML.parse extends ConfigParser ? true : false;
		type AcceptsYamlPackage = typeof parseYaml extends ConfigParser ? true : false;
		type AcceptsIarnaToml = typeof parseTOML extends ConfigParser ? true : false;

		expectTypeOf<AcceptsBunYaml>().toEqualTypeOf<true>();
		expectTypeOf<AcceptsBunToml>().toEqualTypeOf<true>();
		expectTypeOf<AcceptsYamlPackage>().toEqualTypeOf<true>();
		expectTypeOf<AcceptsIarnaToml>().toEqualTypeOf<true>();
	});

	it('created loader works with discoverConfig', async () => {
		const iniLoader = configFormat(['ini'], (content: string): Record<string, unknown> => {
			const result: Record<string, unknown> = {};
			for (const line of content.split('\n')) {
				const match = /^(\w+)\s*=\s*(.+)$/.exec(line.trim());
				if (match?.[1] !== undefined && match[2] !== undefined) {
					result[match[1]] = match[2];
				}
			}
			return result;
		});

		const adapter = stubAdapter({
			'/project/.myapp.ini': 'region=eu\nverbose=true',
		});
		const result = await discoverConfig('myapp', adapter, { loaders: [iniLoader] });
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.format).toBe('ini');
			expect(result.data).toEqual({ region: 'eu', verbose: 'true' });
		}
	});

	it('works with Bun.YAML.parse for object-shaped config files', async () => {
		const bunRuntime = globalThis.Bun;
		if (bunRuntime === undefined) return;

		const adapter = stubAdapter({
			'/project/.myapp.yaml': 'deploy:\n  region: eu\nverbose: true\n',
		});
		const result = await discoverConfig('myapp', adapter, {
			loaders: [configFormat(['yaml', 'yml'], bunRuntime.YAML.parse)],
		});
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.format).toBe('yaml');
			expect(result.data).toEqual({ deploy: { region: 'eu' }, verbose: true });
		}
	});

	it('rejects non-object values from Bun.YAML.parse', async () => {
		const bunRuntime = globalThis.Bun;
		if (bunRuntime === undefined) return;

		const adapter = stubAdapter({
			'/project/.myapp.yaml': '---\nname: one\n---\nname: two\n',
		});

		try {
			await discoverConfig('myapp', adapter, {
				loaders: [configFormat(['yaml', 'yml'], bunRuntime.YAML.parse)],
			});
			expect.unreachable('should have thrown');
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(CLIError);
			const err = e as CLIError;
			expect(err.code).toBe('CONFIG_PARSE_ERROR');
			expect(err.details?.['format']).toBe('yaml');
			expect(err.details?.['message']).toBe('Config loader must return a plain object');
		}
	});

	it('works with Bun.TOML.parse for object-shaped config files', async () => {
		const bunRuntime = globalThis.Bun;
		if (bunRuntime === undefined) return;

		const adapter = stubAdapter({
			'/project/.myapp.toml': 'region = "eu"\nverbose = true\n',
		});
		const result = await discoverConfig('myapp', adapter, {
			loaders: [configFormat(['toml'], bunRuntime.TOML.parse)],
		});
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.format).toBe('toml');
			expect(result.data).toEqual({ region: 'eu', verbose: true });
		}
	});

	it('supports object-shaped YAML via parseYaml', async () => {
		const adapter = stubAdapter({
			'/project/.myapp.yaml': 'deploy:\n  region: eu\nverbose: true\n',
		});
		const result = await discoverConfig('myapp', adapter, {
			loaders: [configFormat(['yaml', 'yml'], parseYaml)],
		});
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.format).toBe('yaml');
			expect(result.data).toEqual({ deploy: { region: 'eu' }, verbose: true });
		}
	});

	it('rejects non-object values from parseYaml', async () => {
		const adapter = stubAdapter({
			'/project/.myapp.yaml': '- one\n- two\n',
		});

		try {
			await discoverConfig('myapp', adapter, {
				loaders: [configFormat(['yaml', 'yml'], parseYaml)],
			});
			expect.unreachable('should have thrown');
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(CLIError);
			const err = e as CLIError;
			expect(err.code).toBe('CONFIG_PARSE_ERROR');
			expect(err.details?.['format']).toBe('yaml');
			expect(err.details?.['message']).toBe('Config loader must return a plain object');
		}
	});

	it('accepts Object.create(null) results from custom loaders', async () => {
		const adapter = stubAdapter({ '/project/.myapp.toml': 'ignored' });
		const result = await discoverConfig('myapp', adapter, {
			loaders: [
				configFormat(['toml'], () => {
					const data = Object.create(null) as Record<string, unknown>;
					data['region'] = 'eu';
					return data;
				}),
			],
		});

		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.data).toEqual({ region: 'eu' });
		}
	});

	it('rejects class instances from custom loaders', async () => {
		class ConfigShape {
			readonly region = 'eu';
		}
		const adapter = stubAdapter({ '/project/.myapp.toml': 'ignored' });

		try {
			await discoverConfig('myapp', adapter, {
				loaders: [configFormat(['toml'], () => new ConfigShape())],
			});
			expect.unreachable('should have thrown');
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(CLIError);
			const err = e as CLIError;
			expect(err.code).toBe('CONFIG_PARSE_ERROR');
			expect(err.details?.['message']).toBe('Config loader must return a plain object');
		}
	});

	it('works with parseTOML from @iarna/toml for object-shaped config files', async () => {
		const adapter = stubAdapter({
			'/project/.myapp.toml': 'region = "eu"\nverbose = true\n',
		});
		const result = await discoverConfig('myapp', adapter, {
			loaders: [configFormat(['toml'], parseTOML)],
		});
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.format).toBe('toml');
			expect(result.data).toEqual({ region: 'eu', verbose: true });
		}
	});

	it('created loader appears in search paths', () => {
		const loader = configFormat(['toml', 'tml'], () => ({}));
		const paths = buildConfigSearchPaths('myapp', '/p', '/c', [loader]);
		expect(paths).toContain('/p/.myapp.toml');
		expect(paths).toContain('/p/.myapp.tml');
		expect(paths).toContain('/p/myapp.config.toml');
		expect(paths).toContain('/c/myapp/config.toml');
	});
});
