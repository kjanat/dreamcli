/**
 * Tests for the runtime adapter interface, Node adapter, and test adapter.
 */

import { describe, expect, it, vi } from 'vitest';
import { cli } from '../core/cli/index.ts';
import { arg } from '../core/schema/arg.ts';
import { command } from '../core/schema/command.ts';
import { flag } from '../core/schema/flag.ts';
import type { RuntimeAdapter } from './adapter.ts';
import { createTestAdapter, ExitError } from './adapter.ts';
import type { NodeProcess } from './node.ts';
import { createNodeAdapter } from './node.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Empty async iterator — yields nothing, returns immediately. */
async function* emptyAsyncIterator(): AsyncGenerator<Uint8Array> {}

/** Minimal stdin stub with async iterator (yields nothing). */
function mockStdin(overrides?: Partial<NodeProcess['stdin']>): NodeProcess['stdin'] {
	return {
		[Symbol.asyncIterator]: emptyAsyncIterator,
		...overrides,
	};
}

/** Create a minimal mock NodeProcess with optional overrides. */
function mockNodeProcess(
	overrides?: Omit<Partial<NodeProcess>, 'stdin'> & { stdin?: NodeProcess['stdin'] },
): NodeProcess {
	return {
		argv: overrides?.argv ?? [],
		env: overrides?.env ?? {},
		versions: overrides?.versions ?? { node: '22.0.0' },
		cwd: overrides?.cwd ?? (() => '/'),
		platform: overrides?.platform ?? 'linux',
		stdin: overrides?.stdin ?? mockStdin(),
		stdout: overrides?.stdout ?? { write: vi.fn() },
		stderr: overrides?.stderr ?? { write: vi.fn() },
		exit: overrides?.exit ?? (vi.fn() as unknown as (code: number) => never),
	};
}

function deployCommand() {
	return command('deploy')
		.description('Deploy to an environment')
		.arg('target', arg.string())
		.flag('force', flag.boolean().alias('f'))
		.action(({ args, flags, out }) => {
			out.log(`Deploying ${args.target}`);
			if (flags.force) out.log('(forced)');
		});
}

// ---------------------------------------------------------------------------
// createTestAdapter
// ---------------------------------------------------------------------------

describe('createTestAdapter', () => {
	it('returns a RuntimeAdapter with all required fields', () => {
		const adapter = createTestAdapter();

		expect(adapter.argv).toEqual(['node', 'test']);
		expect(adapter.env).toEqual({});
		expect(adapter.cwd).toBe('/test');
		expect(adapter.isTTY).toBe(false);
		expect(typeof adapter.stdout).toBe('function');
		expect(typeof adapter.stderr).toBe('function');
		expect(typeof adapter.exit).toBe('function');
	});

	it('accepts custom argv', () => {
		const adapter = createTestAdapter({ argv: ['node', 'cli.js', 'deploy', '--force'] });
		expect(adapter.argv).toEqual(['node', 'cli.js', 'deploy', '--force']);
	});

	it('accepts custom env', () => {
		const adapter = createTestAdapter({ env: { FOO: 'bar', EMPTY: undefined } });
		expect(adapter.env).toEqual({ FOO: 'bar', EMPTY: undefined });
	});

	it('accepts custom cwd', () => {
		const adapter = createTestAdapter({ cwd: '/home/user/project' });
		expect(adapter.cwd).toBe('/home/user/project');
	});

	it('accepts custom stdout/stderr writers', () => {
		const stdoutLines: string[] = [];
		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			stdout: (s) => stdoutLines.push(s),
			stderr: (s) => stderrLines.push(s),
		});

		adapter.stdout('hello');
		adapter.stderr('oops');

		expect(stdoutLines).toEqual(['hello']);
		expect(stderrLines).toEqual(['oops']);
	});

	it('accepts custom isTTY', () => {
		const adapter = createTestAdapter({ isTTY: true });
		expect(adapter.isTTY).toBe(true);
	});

	it('default exit throws ExitError', () => {
		const adapter = createTestAdapter();
		expect(() => adapter.exit(0)).toThrow(ExitError);
		expect(() => adapter.exit(1)).toThrow(ExitError);
	});

	it('ExitError preserves exit code', () => {
		const adapter = createTestAdapter();
		try {
			adapter.exit(42);
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(42);
			expect((e as ExitError).message).toBe('Process exited with code 42');
			expect((e as ExitError).name).toBe('ExitError');
		}
	});

	it('accepts custom exit function', () => {
		const codes: number[] = [];
		const adapter = createTestAdapter({
			exit: ((code: number) => {
				codes.push(code);
			}) as (code: number) => never,
		});

		// Custom exit doesn't throw, so it technically breaks the `never` contract
		// but that's fine for testing assertions
		adapter.exit(5);
		expect(codes).toEqual([5]);
	});

	it('default stdout/stderr are noop (no errors)', () => {
		const adapter = createTestAdapter();
		// Should not throw
		adapter.stdout('test');
		adapter.stderr('test');
	});
});

// ---------------------------------------------------------------------------
// ExitError
// ---------------------------------------------------------------------------

describe('ExitError', () => {
	it('is an Error subclass', () => {
		const err = new ExitError(1);
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(ExitError);
	});

	it('has name ExitError', () => {
		const err = new ExitError(0);
		expect(err.name).toBe('ExitError');
	});

	it('stores exit code', () => {
		expect(new ExitError(0).code).toBe(0);
		expect(new ExitError(1).code).toBe(1);
		expect(new ExitError(127).code).toBe(127);
	});

	it('has descriptive message', () => {
		expect(new ExitError(0).message).toBe('Process exited with code 0');
		expect(new ExitError(2).message).toBe('Process exited with code 2');
	});
});

// ---------------------------------------------------------------------------
// createNodeAdapter
// ---------------------------------------------------------------------------

describe('createNodeAdapter', () => {
	it('creates adapter from mock NodeProcess', () => {
		const mockProc: NodeProcess = {
			argv: ['node', 'cli.js', 'deploy'],
			env: { NODE_ENV: 'test' },
			cwd: () => '/mock/cwd',
			platform: 'linux',
			stdin: mockStdin({ isTTY: true }),
			stdout: {
				isTTY: true,
				write: vi.fn(),
			},
			stderr: {
				write: vi.fn(),
			},
			exit: vi.fn() as unknown as (code: number) => never,
		};

		const adapter = createNodeAdapter(mockProc);

		expect(adapter.argv).toEqual(['node', 'cli.js', 'deploy']);
		expect(adapter.env).toEqual({ NODE_ENV: 'test' });
		expect(adapter.cwd).toBe('/mock/cwd');
		expect(adapter.isTTY).toBe(true);
		expect(adapter.stdinIsTTY).toBe(true);
	});

	it('routes stdout writes to process.stdout.write', () => {
		const writeFn = vi.fn();
		const mockProc = mockNodeProcess({ stdout: { isTTY: false, write: writeFn } });

		const adapter = createNodeAdapter(mockProc);
		adapter.stdout('hello world');

		expect(writeFn).toHaveBeenCalledWith('hello world');
	});

	it('routes stderr writes to process.stderr.write', () => {
		const writeFn = vi.fn();
		const mockProc = mockNodeProcess({ stderr: { write: writeFn } });

		const adapter = createNodeAdapter(mockProc);
		adapter.stderr('error message');

		expect(writeFn).toHaveBeenCalledWith('error message');
	});

	it('throws for unsupported Node.js versions', () => {
		const mockProc = mockNodeProcess({ versions: { node: '21.9.0' } });
		expect(() => createNodeAdapter(mockProc)).toThrow('dreamcli requires Node.js >= 22');
	});

	it('delegates exit to process.exit', () => {
		const exitFn = vi.fn() as unknown as (code: number) => never;
		const mockProc = mockNodeProcess({ exit: exitFn });

		const adapter = createNodeAdapter(mockProc);
		adapter.exit(42);

		expect(exitFn).toHaveBeenCalledWith(42);
	});

	it('isTTY is false when stdout.isTTY is undefined', () => {
		const adapter = createNodeAdapter(mockNodeProcess());
		expect(adapter.isTTY).toBe(false);
	});

	it('isTTY is false when stdout.isTTY is false', () => {
		const mockProc = mockNodeProcess({ stdout: { isTTY: false, write: vi.fn() } });
		const adapter = createNodeAdapter(mockProc);
		expect(adapter.isTTY).toBe(false);
	});

	it('uses globalThis.process when no proc argument given', () => {
		// This test verifies the default path — on Node.js,
		// globalThis.process is always available.
		const adapter = createNodeAdapter();
		expect(Array.isArray(adapter.argv)).toBe(true);
		expect(typeof adapter.cwd).toBe('string');
		expect(typeof adapter.isTTY).toBe('boolean');
	});
});

// ---------------------------------------------------------------------------
// RuntimeAdapter satisfies interface contract
// ---------------------------------------------------------------------------

describe('RuntimeAdapter interface', () => {
	it('test adapter satisfies RuntimeAdapter', () => {
		const adapter: RuntimeAdapter = createTestAdapter();
		expect(adapter.argv).toBeDefined();
		expect(adapter.env).toBeDefined();
		expect(adapter.cwd).toBeDefined();
		expect(adapter.stdout).toBeDefined();
		expect(adapter.stderr).toBeDefined();
		expect(adapter.isTTY).toBeDefined();
		expect(adapter.exit).toBeDefined();
	});

	it('node adapter satisfies RuntimeAdapter', () => {
		const adapter: RuntimeAdapter = createNodeAdapter();
		expect(adapter.argv).toBeDefined();
		expect(adapter.env).toBeDefined();
		expect(adapter.cwd).toBeDefined();
		expect(adapter.stdout).toBeDefined();
		expect(adapter.stderr).toBeDefined();
		expect(typeof adapter.isTTY).toBe('boolean');
		expect(adapter.exit).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Integration: CLIBuilder.run() with adapter injection
// ---------------------------------------------------------------------------

describe('CLIBuilder.run() with adapter', () => {
	it('uses injected adapter for argv and output', async () => {
		const stdoutLines: string[] = [];
		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'deploy', 'production', '--force'],
			stdout: (s) => stdoutLines.push(s),
			stderr: (s) => stderrLines.push(s),
		});

		const app = cli('mycli').version('1.0.0').command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('Deploying production');
		expect(stdoutLines.join('')).toContain('(forced)');
	});

	it('exits with code 0 on --version', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', '--version'],
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('mycli').version('2.0.0').command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('2.0.0');
	});

	it('exits with code 0 on --help', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', '--help'],
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('mycli').version('1.0.0').command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('mycli');
		expect(stdoutLines.join('')).toContain('deploy');
	});

	it('exits with code 2 for unknown command', async () => {
		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'nonexistent'],
			stderr: (s) => stderrLines.push(s),
		});

		const app = cli('mycli').command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(2);
		}

		expect(stderrLines.join('')).toContain('Unknown command');
	});

	it('exits with code 0 when no args (shows help)', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js'],
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('mycli').command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('mycli');
	});

	it('slices argv correctly (removes binary + script)', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['/usr/bin/node', '/path/to/cli.js', 'deploy', 'staging'],
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('mycli').command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('Deploying staging');
	});
});

// ---------------------------------------------------------------------------
// createTestAdapter — stdin fields
// ---------------------------------------------------------------------------

describe('createTestAdapter stdin', () => {
	it('default stdin returns null (EOF)', async () => {
		const adapter = createTestAdapter();
		const result = await adapter.stdin();
		expect(result).toBeNull();
	});

	it('default stdinIsTTY is false', () => {
		const adapter = createTestAdapter();
		expect(adapter.stdinIsTTY).toBe(false);
	});

	it('accepts custom stdin ReadFn', async () => {
		const lines = ['hello', 'world'];
		let index = 0;
		const adapter = createTestAdapter({
			stdin: () => {
				const line = lines[index] ?? null;
				index += 1;
				return Promise.resolve(line);
			},
		});

		expect(await adapter.stdin()).toBe('hello');
		expect(await adapter.stdin()).toBe('world');
		expect(await adapter.stdin()).toBeNull();
	});

	it('accepts custom stdinIsTTY', () => {
		const adapter = createTestAdapter({ stdinIsTTY: true });
		expect(adapter.stdinIsTTY).toBe(true);
	});

	it('stdinIsTTY is independent of isTTY', () => {
		const a1 = createTestAdapter({ isTTY: true, stdinIsTTY: false });
		expect(a1.isTTY).toBe(true);
		expect(a1.stdinIsTTY).toBe(false);

		const a2 = createTestAdapter({ isTTY: false, stdinIsTTY: true });
		expect(a2.isTTY).toBe(false);
		expect(a2.stdinIsTTY).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// createNodeAdapter — stdin fields
// ---------------------------------------------------------------------------

describe('createNodeAdapter stdin', () => {
	it('stdinIsTTY is true when stdin.isTTY is true', () => {
		const adapter = createNodeAdapter(mockNodeProcess({ stdin: mockStdin({ isTTY: true }) }));
		expect(adapter.stdinIsTTY).toBe(true);
	});

	it('stdinIsTTY is false when stdin.isTTY is undefined', () => {
		const adapter = createNodeAdapter(mockNodeProcess());
		expect(adapter.stdinIsTTY).toBe(false);
	});

	it('stdinIsTTY is false when stdin.isTTY is false', () => {
		const adapter = createNodeAdapter(mockNodeProcess({ stdin: mockStdin({ isTTY: false }) }));
		expect(adapter.stdinIsTTY).toBe(false);
	});

	it('stdin is a ReadFn (function)', () => {
		const adapter = createNodeAdapter(mockNodeProcess());
		expect(typeof adapter.stdin).toBe('function');
	});
});

// ---------------------------------------------------------------------------
// RuntimeAdapter interface — stdin contract
// ---------------------------------------------------------------------------

describe('RuntimeAdapter interface — stdin', () => {
	it('test adapter satisfies RuntimeAdapter stdin fields', () => {
		const adapter: RuntimeAdapter = createTestAdapter();
		expect(typeof adapter.stdin).toBe('function');
		expect(typeof adapter.stdinIsTTY).toBe('boolean');
	});

	it('node adapter satisfies RuntimeAdapter stdin fields', () => {
		const adapter: RuntimeAdapter = createNodeAdapter();
		expect(typeof adapter.stdin).toBe('function');
		expect(typeof adapter.stdinIsTTY).toBe('boolean');
	});
});

// ---------------------------------------------------------------------------
// CLIBuilder.run() — auto-prompter from adapter stdin
// ---------------------------------------------------------------------------

describe('CLIBuilder.run() prompt gating', () => {
	it('does not auto-create prompter when stdinIsTTY is false', async () => {
		// Command with a prompt-configured required flag but no default.
		// Without a prompter and no CLI value, this should fail with a validation error.
		const cmd = command('greet')
			.flag('name', flag.string().required().prompt({ kind: 'input', message: 'Your name?' }))
			.action(({ flags, out }) => {
				out.log(`Hello ${flags.name}`);
			});

		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'greet'],
			stdinIsTTY: false, // non-interactive → no auto-prompter
			stderr: (s) => stderrLines.push(s),
		});

		const app = cli('mycli').command(cmd);

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(2);
		}

		// Should fail because no prompter was created (non-TTY stdin)
		expect(stderrLines.join('')).toContain('required');
	});

	it('auto-creates prompter when stdinIsTTY is true', async () => {
		// Command with a prompt-configured flag.
		// With stdinIsTTY=true, the auto-prompter reads from adapter.stdin.
		const cmd = command('greet')
			.flag('name', flag.string().required().prompt({ kind: 'input', message: 'Your name?' }))
			.action(({ flags, out }) => {
				out.log(`Hello ${flags.name}`);
			});

		const stdoutLines: string[] = [];
		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'greet'],
			stdinIsTTY: true,
			stdin: () => Promise.resolve('Alice'), // simulate user typing "Alice"
			stdout: (s) => stdoutLines.push(s),
			stderr: (s) => stderrLines.push(s),
		});

		const app = cli('mycli').command(cmd);

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('Hello Alice');
	});

	it('explicit prompter takes precedence over auto-prompter', async () => {
		const cmd = command('greet')
			.flag('name', flag.string().required().prompt({ kind: 'input', message: 'Your name?' }))
			.action(({ flags, out }) => {
				out.log(`Hello ${flags.name}`);
			});

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'greet'],
			stdinIsTTY: true,
			stdin: () => Promise.resolve('FromStdin'), // should NOT be used
			stdout: (s) => stdoutLines.push(s),
		});

		// Provide explicit prompter — should take precedence
		const { createTestPrompter } = await import('../core/prompt/index.ts');
		const explicitPrompter = createTestPrompter(['ExplicitAnswer']);

		const app = cli('mycli').command(cmd);

		try {
			await app.run({ adapter, prompter: explicitPrompter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('Hello ExplicitAnswer');
	});

	it('CLI value takes precedence over prompt even when stdinIsTTY is true', async () => {
		const cmd = command('greet')
			.flag('name', flag.string().required().prompt({ kind: 'input', message: 'Your name?' }))
			.action(({ flags, out }) => {
				out.log(`Hello ${flags.name}`);
			});

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'greet', '--name', 'CLIValue'],
			stdinIsTTY: true,
			stdin: () => Promise.resolve('FromStdin'),
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('mycli').command(cmd);

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		// CLI value wins — prompt never fires
		expect(stdoutLines.join('')).toContain('Hello CLIValue');
	});

	it('env auto-sourced from adapter still works with auto-prompter', async () => {
		const cmd = command('greet')
			.flag('name', flag.string().required().env('USER_NAME'))
			.action(({ flags, out }) => {
				out.log(`Hello ${flags.name}`);
			});

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'greet'],
			env: { USER_NAME: 'EnvUser' },
			stdinIsTTY: true,
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('mycli').command(cmd);

		try {
			await app.run({ adapter });
		} catch (e) {
			expect(e).toBeInstanceOf(ExitError);
			expect((e as ExitError).code).toBe(0);
		}

		// Env value resolves before prompt step
		expect(stdoutLines.join('')).toContain('Hello EnvUser');
	});

	it('auto-prompter uses adapter.stderr for prompt output', async () => {
		const cmd = command('greet')
			.flag('name', flag.string().required().prompt({ kind: 'input', message: 'Your name?' }))
			.action(({ flags, out }) => {
				out.log(`Hello ${flags.name}`);
			});

		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'greet'],
			stdinIsTTY: true,
			stdin: () => Promise.resolve('Bob'),
			stderr: (s) => stderrLines.push(s),
		});

		const app = cli('mycli').command(cmd);

		try {
			await app.run({ adapter });
		} catch {
			// exit expected
		}

		// The prompt message should be written to stderr (prompt output uses stderr
		// so it doesn't interfere with command stdout which may be piped)
		expect(stderrLines.join('')).toContain('Your name?');
	});
});

// ---------------------------------------------------------------------------
// createTestAdapter — filesystem fields
// ---------------------------------------------------------------------------

describe('createTestAdapter — filesystem', () => {
	it('default readFile returns null (file not found)', async () => {
		const adapter = createTestAdapter();
		const result = await adapter.readFile('/any/path');
		expect(result).toBeNull();
	});

	it('default homedir is /home/test', () => {
		const adapter = createTestAdapter();
		expect(adapter.homedir).toBe('/home/test');
	});

	it('default configDir is /home/test/.config', () => {
		const adapter = createTestAdapter();
		expect(adapter.configDir).toBe('/home/test/.config');
	});

	it('accepts custom readFile', async () => {
		const files = new Map([['/etc/myapp/config.json', '{"region":"eu"}']]);
		const adapter = createTestAdapter({
			readFile: (path) => Promise.resolve(files.get(path) ?? null),
		});

		expect(await adapter.readFile('/etc/myapp/config.json')).toBe('{"region":"eu"}');
		expect(await adapter.readFile('/nonexistent')).toBeNull();
	});

	it('accepts custom homedir', () => {
		const adapter = createTestAdapter({ homedir: '/Users/alice' });
		expect(adapter.homedir).toBe('/Users/alice');
	});

	it('accepts custom configDir', () => {
		const adapter = createTestAdapter({ configDir: '/Users/alice/.config' });
		expect(adapter.configDir).toBe('/Users/alice/.config');
	});
});

// ---------------------------------------------------------------------------
// createNodeAdapter — filesystem fields
// ---------------------------------------------------------------------------

describe('createNodeAdapter — filesystem', () => {
	it('readFile is a function', () => {
		const adapter = createNodeAdapter(mockNodeProcess());
		expect(typeof adapter.readFile).toBe('function');
	});

	it('homedir uses HOME env on linux', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				env: { HOME: '/home/alice' },
			}),
		);
		expect(adapter.homedir).toBe('/home/alice');
	});

	it('homedir uses USERPROFILE on win32', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				platform: 'win32',
				env: { USERPROFILE: 'C:\\Users\\alice' },
				cwd: () => 'C:\\',
			}),
		);
		expect(adapter.homedir).toBe('C:\\Users\\alice');
	});

	it('homedir falls back to / on linux when HOME unset', () => {
		const adapter = createNodeAdapter(mockNodeProcess());
		expect(adapter.homedir).toBe('/');
	});

	it('configDir uses XDG_CONFIG_HOME on linux', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				env: { HOME: '/home/alice', XDG_CONFIG_HOME: '/custom/config' },
			}),
		);
		expect(adapter.configDir).toBe('/custom/config');
	});

	it('configDir defaults to ~/.config on linux', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				env: { HOME: '/home/alice' },
			}),
		);
		expect(adapter.configDir).toBe('/home/alice/.config');
	});

	it('configDir uses APPDATA on win32', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				platform: 'win32',
				env: { USERPROFILE: 'C:\\Users\\alice', APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' },
				cwd: () => 'C:\\',
			}),
		);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('configDir defaults to AppData\\Roaming on win32', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				platform: 'win32',
				env: { USERPROFILE: 'C:\\Users\\alice' },
				cwd: () => 'C:\\',
			}),
		);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('configDir normalizes trailing separator in homedir on win32', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				platform: 'win32',
				env: { USERPROFILE: 'C:\\' },
				cwd: () => 'C:\\',
			}),
		);
		// Must not produce doubled backslash: C:\\\\AppData\\Roaming
		expect(adapter.configDir).toBe('C:\\AppData\\Roaming');
	});

	it('configDir normalizes trailing slash in homedir on win32', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				platform: 'win32',
				env: { USERPROFILE: 'C:\\Users\\alice\\' },
				cwd: () => 'C:\\',
			}),
		);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('configDir treats empty APPDATA as unset on win32', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				platform: 'win32',
				env: { USERPROFILE: 'C:\\Users\\alice', APPDATA: '' },
				cwd: () => 'C:\\',
			}),
		);
		expect(adapter.configDir).toBe('C:\\Users\\alice\\AppData\\Roaming');
	});

	it('readFile returns file contents for existing files', async () => {
		const adapter = createNodeAdapter();
		// Use the adapter's own cwd to find a file we know exists
		const content = await adapter.readFile(`${adapter.cwd}/package.json`);
		expect(content).not.toBeNull();
		expect(content).toContain('dreamcli');
	});

	it('readFile returns null for nonexistent files', async () => {
		const adapter = createNodeAdapter();
		const result = await adapter.readFile('/tmp/dreamcli-test-nonexistent-file-12345');
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// RuntimeAdapter interface — filesystem contract
// ---------------------------------------------------------------------------

describe('RuntimeAdapter interface — filesystem', () => {
	it('test adapter satisfies RuntimeAdapter filesystem fields', () => {
		const adapter: RuntimeAdapter = createTestAdapter();
		expect(typeof adapter.readFile).toBe('function');
		expect(typeof adapter.homedir).toBe('string');
		expect(typeof adapter.configDir).toBe('string');
	});

	it('node adapter satisfies RuntimeAdapter filesystem fields', () => {
		const adapter: RuntimeAdapter = createNodeAdapter();
		expect(typeof adapter.readFile).toBe('function');
		expect(typeof adapter.homedir).toBe('string');
		expect(typeof adapter.configDir).toBe('string');
	});
});

// ---------------------------------------------------------------------------
// Public surface exports
// ---------------------------------------------------------------------------

describe('public surface', () => {
	it('exports RuntimeAdapter type and factories from runtime barrel', async () => {
		const mod = await import('./index.ts');
		expect(mod.createTestAdapter).toBeDefined();
		expect(mod.createNodeAdapter).toBeDefined();
		expect(mod.ExitError).toBeDefined();
	});

	it('exports adapter factories from runtime barrel', async () => {
		const mod = await import('../runtime.ts');
		expect(mod.createNodeAdapter).toBeDefined();
		expect(mod.ExitError).toBeDefined();
	});

	it('exports test adapter from testkit barrel', async () => {
		const mod = await import('../testkit.ts');
		expect(mod.createTestAdapter).toBeDefined();
	});
});
