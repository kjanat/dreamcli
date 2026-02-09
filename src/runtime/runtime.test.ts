/**
 * Tests for the runtime adapter interface, Node adapter, and test adapter.
 */

import { describe, expect, it, vi } from 'vitest';
import { cli } from '../core/cli/index.js';
import { arg } from '../core/schema/arg.js';
import { command } from '../core/schema/command.js';
import { flag } from '../core/schema/flag.js';
import type { RuntimeAdapter } from './adapter.js';
import { createTestAdapter, ExitError } from './adapter.js';
import type { NodeProcess } from './node.js';
import { createNodeAdapter } from './node.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
	});

	it('routes stdout writes to process.stdout.write', () => {
		const writeFn = vi.fn();
		const mockProc: NodeProcess = {
			argv: [],
			env: {},
			cwd: () => '/',
			stdout: { isTTY: false, write: writeFn },
			stderr: { write: vi.fn() },
			exit: vi.fn() as unknown as (code: number) => never,
		};

		const adapter = createNodeAdapter(mockProc);
		adapter.stdout('hello world');

		expect(writeFn).toHaveBeenCalledWith('hello world');
	});

	it('routes stderr writes to process.stderr.write', () => {
		const writeFn = vi.fn();
		const mockProc: NodeProcess = {
			argv: [],
			env: {},
			cwd: () => '/',
			stdout: { write: vi.fn() },
			stderr: { write: writeFn },
			exit: vi.fn() as unknown as (code: number) => never,
		};

		const adapter = createNodeAdapter(mockProc);
		adapter.stderr('error message');

		expect(writeFn).toHaveBeenCalledWith('error message');
	});

	it('delegates exit to process.exit', () => {
		const exitFn = vi.fn() as unknown as (code: number) => never;
		const mockProc: NodeProcess = {
			argv: [],
			env: {},
			cwd: () => '/',
			stdout: { write: vi.fn() },
			stderr: { write: vi.fn() },
			exit: exitFn,
		};

		const adapter = createNodeAdapter(mockProc);
		adapter.exit(42);

		expect(exitFn).toHaveBeenCalledWith(42);
	});

	it('isTTY is false when stdout.isTTY is undefined', () => {
		const mockProc: NodeProcess = {
			argv: [],
			env: {},
			cwd: () => '/',
			stdout: { write: vi.fn() },
			stderr: { write: vi.fn() },
			exit: vi.fn() as unknown as (code: number) => never,
		};

		const adapter = createNodeAdapter(mockProc);
		expect(adapter.isTTY).toBe(false);
	});

	it('isTTY is false when stdout.isTTY is false', () => {
		const mockProc: NodeProcess = {
			argv: [],
			env: {},
			cwd: () => '/',
			stdout: { isTTY: false, write: vi.fn() },
			stderr: { write: vi.fn() },
			exit: vi.fn() as unknown as (code: number) => never,
		};

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
// Public surface exports
// ---------------------------------------------------------------------------

describe('public surface', () => {
	it('exports RuntimeAdapter type and factories from runtime barrel', async () => {
		const mod = await import('./index.js');
		expect(mod.createTestAdapter).toBeDefined();
		expect(mod.createNodeAdapter).toBeDefined();
		expect(mod.ExitError).toBeDefined();
	});

	it('exports RuntimeAdapter type and factories from main barrel', async () => {
		const mod = await import('../index.js');
		expect(mod.createTestAdapter).toBeDefined();
		expect(mod.createNodeAdapter).toBeDefined();
		expect(mod.ExitError).toBeDefined();
	});
});
