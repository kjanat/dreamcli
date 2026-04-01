/**
 * Tests for the Deno runtime adapter.
 *
 * Since tests run under Node/Bun (vitest), the Deno namespace isn't
 * available. All tests inject a mock `DenoNamespace` via the `ns`
 * parameter, verifying the adapter's behavior without requiring Deno.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAdapter } from './adapter.ts';
import type { DenoNamespace } from './deno.ts';
import { createDenoAdapter } from './deno.ts';

// ---
// Test helpers
// ---

/** Minimal readable stream that yields chunks then signals done. */
function mockReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const encoded = chunks.map((c) => encoder.encode(c));
	let index = 0;

	return {
		getReader() {
			return {
				read() {
					const value = encoded[index];
					if (value !== undefined) {
						index += 1;
						return Promise.resolve({ done: false as const, value });
					}
					return Promise.resolve({
						done: true as const,
						value: new Uint8Array(0),
					});
				},
				releaseLock() {},
			};
		},
	} as ReadableStream<Uint8Array>;
}

/** Create a minimal mock DenoNamespace with optional overrides. */
function mockDeno(overrides?: Partial<DenoNamespace>): DenoNamespace {
	return {
		build: overrides?.build ?? { os: 'linux' },
		version: overrides?.version ?? { deno: '2.6.0' },
		args: overrides?.args ?? [],
		env: overrides?.env ?? {
			get: () => undefined,
			toObject: () => ({}),
		},
		cwd: overrides?.cwd ?? (() => '/deno/project'),
		stdout: overrides?.stdout ?? {
			writeSync: vi.fn(() => 0),
			isTerminal: () => false,
		},
		stderr: overrides?.stderr ?? {
			writeSync: vi.fn(() => 0),
		},
		stdin: overrides?.stdin ?? {
			isTerminal: () => false,
			readable: mockReadableStream([]),
		},
		exit: overrides?.exit ?? (vi.fn() as unknown as (code: number) => never),
		readTextFile: overrides?.readTextFile ?? (() => Promise.reject(makeDenoError('NotFound'))),
	};
}

/** Create a Deno-style error with a `name` property. */
function makeDenoError(name: string, message?: string): Error {
	const err = new Error(message ?? name);
	err.name = name;
	return err;
}

// ===
// createDenoAdapter — basic contract
// ===

describe('createDenoAdapter — basic contract', () => {
	it('returns a RuntimeAdapter with all required fields', () => {
		const adapter: RuntimeAdapter = createDenoAdapter(mockDeno());

		expect(adapter.argv).toBeDefined();
		expect(adapter.env).toBeDefined();
		expect(adapter.cwd).toBeDefined();
		expect(typeof adapter.stdout).toBe('function');
		expect(typeof adapter.stderr).toBe('function');
		expect(typeof adapter.stdin).toBe('function');
		expect(typeof adapter.isTTY).toBe('boolean');
		expect(typeof adapter.stdinIsTTY).toBe('boolean');
		expect(typeof adapter.exit).toBe('function');
		expect(typeof adapter.readFile).toBe('function');
		expect(typeof adapter.homedir).toBe('string');
		expect(typeof adapter.configDir).toBe('string');
	});

	it('satisfies RuntimeAdapter type', () => {
		const adapter: RuntimeAdapter = createDenoAdapter(mockDeno());
		expect(adapter).toBeDefined();
	});

	it('throws for unsupported Deno versions', () => {
		const ns = mockDeno({ version: { deno: '2.5.4' } });
		expect(() => createDenoAdapter(ns)).toThrow('dreamcli requires Deno >= 2.6.0');
	});
});

// ===
// createDenoAdapter — argv synthesis
// ===

describe('createDenoAdapter — argv synthesis', () => {
	it('prepends synthetic binary+script to Deno.args', () => {
		const ns = mockDeno({ args: ['deploy', '--force'] });
		const adapter = createDenoAdapter(ns);
		expect(adapter.argv).toEqual(['deno', 'run', 'deploy', '--force']);
	});

	it('has 2 entries when Deno.args is empty', () => {
		const ns = mockDeno({ args: [] });
		const adapter = createDenoAdapter(ns);
		expect(adapter.argv).toEqual(['deno', 'run']);
	});

	it('preserves all user args in order', () => {
		const ns = mockDeno({ args: ['build', '--target', 'production', '--verbose'] });
		const adapter = createDenoAdapter(ns);
		expect(adapter.argv).toEqual(['deno', 'run', 'build', '--target', 'production', '--verbose']);
	});
});

// ===
// createDenoAdapter — environment
// ===

describe('createDenoAdapter — environment', () => {
	it('reads env from Deno.env.toObject()', () => {
		const ns = mockDeno({
			env: {
				get: (key: string) => ({ DENO_ENV: 'production' })[key],
				toObject: () => ({ DENO_ENV: 'production', API_KEY: 'secret' }),
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.env).toEqual({ DENO_ENV: 'production', API_KEY: 'secret' });
	});

	it('falls back to empty env on PermissionDenied', () => {
		const ns = mockDeno({
			env: {
				get: () => undefined,
				toObject: () => {
					throw makeDenoError('PermissionDenied');
				},
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.env).toEqual({});
	});

	it('propagates non-permission errors from env', () => {
		const ns = mockDeno({
			env: {
				get: () => undefined,
				toObject: () => {
					throw new TypeError('unexpected');
				},
			},
		});
		expect(() => createDenoAdapter(ns)).toThrow(TypeError);
	});
});

// ===
// createDenoAdapter — cwd
// ===

describe('createDenoAdapter — cwd', () => {
	it('reads cwd from Deno.cwd()', () => {
		const ns = mockDeno({ cwd: () => '/home/user/deno-project' });
		const adapter = createDenoAdapter(ns);
		expect(adapter.cwd).toBe('/home/user/deno-project');
	});

	it('falls back to / on PermissionDenied', () => {
		const ns = mockDeno({
			cwd: () => {
				throw makeDenoError('PermissionDenied');
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.cwd).toBe('/');
	});

	it('propagates non-permission cwd errors', () => {
		const ns = mockDeno({
			cwd: () => {
				throw new Error('disk error');
			},
		});
		expect(() => createDenoAdapter(ns)).toThrow('disk error');
	});
});

// ===
// createDenoAdapter — I/O
// ===

describe('createDenoAdapter — stdout/stderr', () => {
	it('routes stdout writes through TextEncoder to Deno.stdout.writeSync', () => {
		let captured: Uint8Array | undefined;
		const ns = mockDeno({
			stdout: {
				writeSync: (p: Uint8Array) => {
					captured = p;
					return p.length;
				},
				isTerminal: () => false,
			},
		});
		const adapter = createDenoAdapter(ns);

		adapter.stdout('hello deno');
		expect(captured).toBeDefined();
		expect(new TextDecoder().decode(captured)).toBe('hello deno');
	});

	it('routes stderr writes through TextEncoder to Deno.stderr.writeSync', () => {
		let captured: Uint8Array | undefined;
		const ns = mockDeno({
			stderr: {
				writeSync: (p: Uint8Array) => {
					captured = p;
					return p.length;
				},
			},
		});
		const adapter = createDenoAdapter(ns);

		adapter.stderr('deno error');
		expect(captured).toBeDefined();
		expect(new TextDecoder().decode(captured)).toBe('deno error');
	});
});

// ===
// createDenoAdapter — TTY detection
// ===

describe('createDenoAdapter — TTY detection', () => {
	it('isTTY is true when stdout.isTerminal() returns true', () => {
		const ns = mockDeno({
			stdout: { writeSync: vi.fn(() => 0), isTerminal: () => true },
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.isTTY).toBe(true);
	});

	it('isTTY is false when stdout.isTerminal() returns false', () => {
		const ns = mockDeno();
		const adapter = createDenoAdapter(ns);
		expect(adapter.isTTY).toBe(false);
	});

	it('stdinIsTTY is true when stdin.isTerminal() returns true', () => {
		const ns = mockDeno({
			stdin: { isTerminal: () => true, readable: mockReadableStream([]) },
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.stdinIsTTY).toBe(true);
	});

	it('stdinIsTTY is false when stdin.isTerminal() returns false', () => {
		const ns = mockDeno();
		const adapter = createDenoAdapter(ns);
		expect(adapter.stdinIsTTY).toBe(false);
	});
});

// ===
// createDenoAdapter — exit
// ===

describe('createDenoAdapter — exit', () => {
	it('delegates exit to Deno.exit', () => {
		const exitFn = vi.fn() as unknown as (code: number) => never;
		const ns = mockDeno({ exit: exitFn });
		const adapter = createDenoAdapter(ns);

		adapter.exit(42);
		expect(exitFn).toHaveBeenCalledWith(42);
	});
});

// ===
// createDenoAdapter — stdin line reading
// ===

describe('createDenoAdapter — stdin', () => {
	it('stdin is a ReadFn (function)', () => {
		const adapter = createDenoAdapter(mockDeno());
		expect(typeof adapter.stdin).toBe('function');
	});

	it('readStdin returns empty string for empty non-TTY stdin', async () => {
		const ns = mockDeno({
			stdin: { isTerminal: () => false, readable: mockReadableStream([]) },
		});
		const adapter = createDenoAdapter(ns);
		expect(await adapter.readStdin()).toBe('');
	});

	it('reads a line from stdin stream', async () => {
		const ns = mockDeno({
			stdin: { isTerminal: () => false, readable: mockReadableStream(['hello\n']) },
		});
		const adapter = createDenoAdapter(ns);
		const line = await adapter.stdin();
		expect(line).toBe('hello');
	});

	it('strips carriage return from line endings', async () => {
		const ns = mockDeno({
			stdin: { isTerminal: () => false, readable: mockReadableStream(['hello\r\n']) },
		});
		const adapter = createDenoAdapter(ns);
		const line = await adapter.stdin();
		expect(line).toBe('hello');
	});

	it('returns null on empty EOF', async () => {
		const ns = mockDeno({
			stdin: { isTerminal: () => false, readable: mockReadableStream([]) },
		});
		const adapter = createDenoAdapter(ns);
		const line = await adapter.stdin();
		expect(line).toBeNull();
	});

	it('returns buffered content on EOF without newline', async () => {
		const ns = mockDeno({
			stdin: { isTerminal: () => false, readable: mockReadableStream(['partial']) },
		});
		const adapter = createDenoAdapter(ns);
		const line = await adapter.stdin();
		expect(line).toBe('partial');
	});

	it('handles multi-chunk line assembly', async () => {
		const ns = mockDeno({
			stdin: { isTerminal: () => false, readable: mockReadableStream(['hel', 'lo\n']) },
		});
		const adapter = createDenoAdapter(ns);
		const line = await adapter.stdin();
		expect(line).toBe('hello');
	});
});

// ===
// createDenoAdapter — readFile
// ===

describe('createDenoAdapter — readFile', () => {
	it('returns file contents on success', async () => {
		const ns = mockDeno({
			readTextFile: (path: string) =>
				path === '/etc/config.json'
					? Promise.resolve('{"key":"val"}')
					: Promise.reject(makeDenoError('NotFound')),
		});
		const adapter = createDenoAdapter(ns);
		expect(await adapter.readFile('/etc/config.json')).toBe('{"key":"val"}');
	});

	it('returns null on NotFound', async () => {
		const ns = mockDeno({
			readTextFile: () => Promise.reject(makeDenoError('NotFound')),
		});
		const adapter = createDenoAdapter(ns);
		expect(await adapter.readFile('/nonexistent')).toBeNull();
	});

	it('returns null on PermissionDenied', async () => {
		const ns = mockDeno({
			readTextFile: () => Promise.reject(makeDenoError('PermissionDenied')),
		});
		const adapter = createDenoAdapter(ns);
		expect(await adapter.readFile('/secret')).toBeNull();
	});

	it('propagates other errors', async () => {
		const ns = mockDeno({
			readTextFile: () => Promise.reject(new Error('disk failure')),
		});
		const adapter = createDenoAdapter(ns);
		await expect(adapter.readFile('/broken')).rejects.toThrow('disk failure');
	});
});

// ===
// createDenoAdapter — homedir
// ===

describe('createDenoAdapter — homedir', () => {
	it('uses HOME env on Unix', () => {
		const ns = mockDeno({
			env: {
				get: (k: string) => ({ HOME: '/home/alice' })[k],
				toObject: () => ({ HOME: '/home/alice' }),
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.homedir).toBe('/home/alice');
	});

	it('uses USERPROFILE on Windows', () => {
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => ({ USERPROFILE: 'C:\\Users\\alice' })[k],
				toObject: () => ({ USERPROFILE: 'C:\\Users\\alice' }),
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.homedir).toBe('C:\\Users\\alice');
	});

	it('uses HOMEDRIVE+HOMEPATH when USERPROFILE unset', () => {
		const env: Record<string, string> = { HOMEDRIVE: 'D:', HOMEPATH: '\\Users\\bob' };
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.homedir).toBe('D:\\Users\\bob');
	});

	it('falls back to / when no home env set', () => {
		const ns = mockDeno();
		const adapter = createDenoAdapter(ns);
		expect(adapter.homedir).toBe('/');
	});
});

// ===
// createDenoAdapter — configDir
// ===

describe('createDenoAdapter — configDir', () => {
	it('uses XDG_CONFIG_HOME on Unix', () => {
		const env: Record<string, string> = { HOME: '/home/alice', XDG_CONFIG_HOME: '/custom/config' };
		const ns = mockDeno({
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('/custom/config');
	});

	it('defaults to ~/.config on Unix', () => {
		const env: Record<string, string> = { HOME: '/home/alice' };
		const ns = mockDeno({
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('/home/alice/.config');
	});

	it('uses APPDATA on Windows', () => {
		const env: Record<string, string> = {
			USERPROFILE: 'C:\\Users\\alice',
			APPDATA: 'C:\\Users\\alice\\AppData\\Roaming',
		};
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('defaults to AppData\\Roaming on Windows', () => {
		const env: Record<string, string> = {
			USERPROFILE: 'C:\\Users\\alice',
		};
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('uses HOMEDRIVE and HOMEPATH fallback on Windows', () => {
		const env: Record<string, string> = {
			HOMEDRIVE: 'C:',
			HOMEPATH: '\\Users\\alice',
		};
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('treats empty APPDATA as unset', () => {
		const env: Record<string, string> = {
			USERPROFILE: 'C:\\Users\\alice',
			APPDATA: '',
		};
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('normalizes trailing separator in Windows homedir', () => {
		const env: Record<string, string> = { USERPROFILE: 'C:\\' };
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('C:\\AppData\\Roaming');
	});

	it('normalizes trailing slash in Windows homedir', () => {
		const env: Record<string, string> = { USERPROFILE: 'C:\\Users\\alice\\' };
		const ns = mockDeno({
			build: { os: 'windows' },
			env: {
				get: (k: string) => env[k],
				toObject: () => env,
			},
		});
		const adapter = createDenoAdapter(ns);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});
});

// ===
// Public surface exports
// ===

describe('public surface — Deno adapter', () => {
	it('exports createDenoAdapter from runtime barrel', async () => {
		const mod = await import('./index.ts');
		expect(mod.createDenoAdapter).toBeDefined();
	});

	it('exports createDenoAdapter from runtime subpath', async () => {
		const mod = await import('#dreamcli/runtime');
		expect(mod.createDenoAdapter).toBeDefined();
	});
});
