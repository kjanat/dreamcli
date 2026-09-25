/**
 * Tests for the runtime adapter interface, Node adapter, and test adapter.
 */

import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { RuntimeAdapter } from './adapter.ts';
import { createTestAdapter, ExitError, exitAfterFlush } from './adapter.ts';
import type { NodeProcess } from './node.ts';
import { createNodeAdapter } from './node.ts';

// --- Test helpers

/** Empty async iterator — yields nothing, returns immediately. */
async function* emptyAsyncIterator(): AsyncGenerator<Uint8Array> {}

/** Node stream writer that completes each write immediately. */
function immediateWrite(_data: string, callback?: (error?: Error | null) => void): boolean {
	callback?.();
	return true;
}

/** Error carrying a Node system error code. */
function systemError(code: string): Error {
	return Object.assign(new Error(`write ${code}`), { code });
}

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
		versions: overrides?.versions ?? { node: '22.22.2' },
		cwd: overrides?.cwd ?? (() => '/'),
		platform: overrides?.platform ?? 'linux',
		stdin: overrides?.stdin ?? mockStdin(),
		stdout: overrides?.stdout ?? { write: immediateWrite },
		stderr: overrides?.stderr ?? { write: immediateWrite },
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

// --- createTestAdapter

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

	it('accepts custom terminal size', () => {
		const adapter = createTestAdapter({ terminalSize: { columns: 120, rows: 30 } });
		expect(adapter.getTerminalSize()).toEqual({ columns: 120, rows: 30 });
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

// --- ExitError

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

// --- createNodeAdapter

describe('exitAfterFlush', () => {
	function adapterWith(flush: () => Promise<void>): RuntimeAdapter {
		return { ...createTestAdapter(), flush };
	}

	it('exits with the given code after a successful flush', async () => {
		await expect(
			exitAfterFlush(
				adapterWith(() => Promise.resolve()),
				3,
			),
		).rejects.toMatchObject({
			code: 3,
		});
	});

	it('exits 1 when a successful run cannot flush its output', async () => {
		const failing = adapterWith(() => Promise.reject(new Error('write ENOSPC')));

		await expect(exitAfterFlush(failing, 0)).rejects.toMatchObject({ code: 1 });
	});

	it.each([2, 7])('keeps code %i when the flush fails', async (code) => {
		const failing = adapterWith(() => Promise.reject(new Error('write ENOSPC')));

		await expect(exitAfterFlush(failing, code)).rejects.toMatchObject({ code });
	});

	it('calls exit once and lets its error propagate unchanged', async () => {
		const codes: number[] = [];
		const adapter = {
			...adapterWith(() => Promise.resolve()),
			exit: (code: number): never => {
				codes.push(code);
				throw new ExitError(code);
			},
		};

		await expect(exitAfterFlush(adapter, 0)).rejects.toMatchObject({ code: 0 });
		expect(codes).toEqual([0]);
	});

	it('exits with the given code when the adapter has no flush', async () => {
		await expect(exitAfterFlush(createTestAdapter(), 0)).rejects.toMatchObject({ code: 0 });
	});
});

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

		expect(writeFn).toHaveBeenCalledWith('hello world', expect.any(Function));
	});

	it('routes stderr writes to process.stderr.write', () => {
		const writeFn = vi.fn();
		const mockProc = mockNodeProcess({ stderr: { write: writeFn } });

		const adapter = createNodeAdapter(mockProc);
		adapter.stderr('error message');

		expect(writeFn).toHaveBeenCalledWith('error message', expect.any(Function));
	});

	it('flush waits for pending stdout and stderr writes', async () => {
		const callbacks: Array<(error?: Error | null) => void> = [];
		const write = vi.fn((_data: string, callback?: (error?: Error | null) => void) => {
			if (callback !== undefined) callbacks.push(callback);
		});
		const adapter = createNodeAdapter(mockNodeProcess({ stdout: { write }, stderr: { write } }));
		adapter.stdout('output');
		adapter.stderr('error');

		let flushed = false;
		const flushing = adapter.flush?.().then(() => {
			flushed = true;
		});
		await Promise.resolve();
		expect(flushed).toBe(false);

		callbacks[0]?.();
		await Promise.resolve();
		expect(flushed).toBe(false);

		callbacks[1]?.();
		await flushing;
		expect(flushed).toBe(true);
	});

	it('flush resolves when a write fails with EPIPE', async () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: { write: (_data, callback) => callback?.(systemError('EPIPE')) },
			}),
		);
		adapter.stdout('output');

		await expect(adapter.flush?.()).resolves.toBeUndefined();
	});

	it('flush ignores errors that follow EPIPE on the same stream', async () => {
		const errors = [systemError('EPIPE'), systemError('ERR_STREAM_DESTROYED')];
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: { write: (_data, callback) => callback?.(errors.shift()) },
			}),
		);
		adapter.stdout('first');
		adapter.stdout('second');

		await expect(adapter.flush?.()).resolves.toBeUndefined();
	});

	it.each(['ENOSPC', 'EIO'])(
		'flush rejects with %s only after the other stream settles',
		async (code) => {
			const failure = systemError(code);
			let stdoutCallback: ((error?: Error | null) => void) | undefined;
			let stderrCallback: ((error?: Error | null) => void) | undefined;
			const adapter = createNodeAdapter(
				mockNodeProcess({
					stdout: {
						write: (_data, callback) => {
							stdoutCallback = callback;
						},
					},
					stderr: {
						write: (_data, callback) => {
							stderrCallback = callback;
						},
					},
				}),
			);
			adapter.stdout('output');
			adapter.stderr('error');

			let settled = false;
			const flushing = adapter.flush?.().finally(() => {
				settled = true;
			});
			stdoutCallback?.(failure);
			await Promise.resolve();
			expect(settled).toBe(false);

			stderrCallback?.();
			await expect(flushing).rejects.toBe(failure);
		},
	);

	it('flush rejects after a failure that happened before it was called', async () => {
		const failure = systemError('ENOSPC');
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: { write: (_data, callback) => callback?.(failure) },
			}),
		);
		adapter.stdout('output');

		await expect(adapter.flush?.()).rejects.toBe(failure);
		await expect(adapter.flush?.()).rejects.toBe(failure);
	});

	it('flush reports the first failure on a stream', async () => {
		const first = systemError('ENOSPC');
		const errors = [first, systemError('EIO')];
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: { write: (_data, callback) => callback?.(errors.shift()) },
			}),
		);
		adapter.stdout('first');
		adapter.stdout('second');

		await expect(adapter.flush?.()).rejects.toBe(first);
	});

	it('flush waits for the other stream when a real Writable fails and emits its error late', async () => {
		const failure = systemError('ENOSPC');
		let errorEmitted = false;
		const stdout = new Writable({
			write: (_chunk, _encoding, callback) => callback(failure),
			destroy: (error, callback) => {
				setTimeout(() => callback(error), 20);
			},
		});
		stdout.on('error', () => {
			errorEmitted = true;
		});
		let stderrCallback: ((error?: Error | null) => void) | undefined;
		const stderrWrites: string[] = [];
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout,
				stderr: {
					write: (data, callback) => {
						stderrWrites.push(data);
						stderrCallback = callback;
					},
				},
			}),
		);
		adapter.stdout('output');
		adapter.stderr('remaining');

		let settled = false;
		const flushing = adapter.flush?.().finally(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(errorEmitted).toBe(true);
		expect(settled).toBe(false);
		expect(stderrWrites).toEqual(['remaining']);

		stderrCallback?.();
		await expect(flushing).rejects.toBe(failure);
	});

	it('flush rejects before a real Writable emits its late error', async () => {
		const failure = systemError('ENOSPC');
		let errorEmitted = false;
		const stdout = new Writable({
			write: (_chunk, _encoding, callback) => callback(failure),
			destroy: (error, callback) => {
				setTimeout(() => callback(error), 20);
			},
		});
		stdout.on('error', () => {
			errorEmitted = true;
		});
		const adapter = createNodeAdapter(mockNodeProcess({ stdout }));
		adapter.stdout('output');

		await expect(adapter.flush?.()).rejects.toBe(failure);
		expect(errorEmitted).toBe(false);
	});

	it('shares stream failures between adapters on the same stream', async () => {
		const listeners: Array<(error: Error) => void> = [];
		const stdout: NodeProcess['stdout'] = {
			on: (_event: string, listener: (error: Error) => void) => {
				listeners.push(listener);
			},
			write: immediateWrite,
		};
		const first = createNodeAdapter(mockNodeProcess({ stdout }));
		const second = createNodeAdapter(mockNodeProcess({ stdout }));
		const failure = systemError('EIO');

		listeners[0]?.(failure);

		expect(listeners).toHaveLength(1);
		await expect(first.flush?.()).rejects.toBe(failure);
		await expect(second.flush?.()).rejects.toBe(failure);
	});

	it('keeps write bookkeeping consistent when stream.write throws synchronously', async () => {
		const failure = new Error('write threw');
		let stderrCallback: ((error?: Error | null) => void) | undefined;
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: {
					write: () => {
						throw failure;
					},
				},
				stderr: {
					write: (_data, callback) => {
						stderrCallback = callback;
					},
				},
			}),
		);

		expect(() => adapter.stdout('output')).toThrow(failure);
		adapter.stderr('error');
		const flushing = adapter.flush?.();
		stderrCallback?.();

		await expect(flushing).resolves.toBeUndefined();
	});

	it('records stream error events without throwing', async () => {
		const listeners: Array<(error: Error) => void> = [];
		const on = (_event: string, listener: (error: Error) => void): void => {
			listeners.push(listener);
		};
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: { on, write: immediateWrite },
				stderr: { on, write: immediateWrite },
			}),
		);
		const failure = systemError('EIO');

		expect(listeners).toHaveLength(2);
		expect(() => listeners[0]?.(systemError('EPIPE'))).not.toThrow();
		expect(() => listeners[1]?.(failure)).not.toThrow();
		await expect(adapter.flush?.()).rejects.toBe(failure);
	});

	it('attaches the error listener once per stream', () => {
		const events: string[] = [];
		const stdout: NodeProcess['stdout'] = {
			on: (event: string) => {
				events.push(event);
			},
			write: immediateWrite,
		};
		createNodeAdapter(mockNodeProcess({ stdout }));
		createNodeAdapter(mockNodeProcess({ stdout }));

		expect(events).toEqual(['error']);
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

	it('reads terminal size from getWindowSize when stdout is a TTY', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: {
					isTTY: true,
					getWindowSize: () => [132, 43],
					write: vi.fn(),
				},
			}),
		);

		expect(adapter.getTerminalSize()).toEqual({ columns: 132, rows: 43 });
	});

	it('falls back to columns and rows when getWindowSize is unavailable', () => {
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: {
					isTTY: true,
					columns: 100,
					rows: 24,
					write: vi.fn(),
				},
			}),
		);

		expect(adapter.getTerminalSize()).toEqual({ columns: 100, rows: 24 });
	});

	it('subscribes to stdout resize events when supported', () => {
		const subscribed: Array<{ readonly event: string; readonly listener: unknown }> = [];
		const unsubscribed: Array<{ readonly event: string; readonly listener: unknown }> = [];
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdout: {
					isTTY: true,
					write: vi.fn(),
					on: (event, listener) => {
						subscribed.push({ event, listener });
					},
					off: (event, listener) => {
						unsubscribed.push({ event, listener });
					},
				},
			}),
		);
		const onResize = (): void => {};

		const cleanup = adapter.onTerminalResize(onResize);
		expect(subscribed).toContainEqual({ event: 'resize', listener: onResize });

		cleanup?.();
		expect(unsubscribed).toEqual([{ event: 'resize', listener: onResize }]);
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

// --- RuntimeAdapter satisfies interface contract

describe('RuntimeAdapter interface', () => {
	it('test adapter satisfies RuntimeAdapter', () => {
		const adapter: RuntimeAdapter = createTestAdapter();
		expect(adapter.argv).toBeDefined();
		expect(adapter.env).toBeDefined();
		expect(adapter.cwd).toBeDefined();
		expect(adapter.stdout).toBeDefined();
		expect(adapter.stderr).toBeDefined();
		expect(adapter.isTTY).toBeDefined();
		expect(adapter.getTerminalSize).toBeDefined();
		expect(adapter.onTerminalResize).toBeDefined();
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
		expect(adapter.getTerminalSize).toBeDefined();
		expect(adapter.onTerminalResize).toBeDefined();
		expect(adapter.exit).toBeDefined();
	});
});

// --- Integration: CLIBuilder.run() with adapter injection

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

	it('exits with a handler-requested non-zero code without error output', async () => {
		const stdoutLines: string[] = [];
		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'cli.js', 'check'],
			stdout: (s) => stdoutLines.push(s),
			stderr: (s) => stderrLines.push(s),
		});
		const app = cli('mycli').command(
			command('check').action(({ out }) => {
				out.log('degraded');
				out.setExitCode(7);
			}),
		);

		const run = app.run({ adapter });
		await expect(run).rejects.toThrow(ExitError);
		await expect(run).rejects.toMatchObject({ code: 7 });

		expect(stdoutLines).toEqual(['degraded\n']);
		expect(stderrLines).toEqual([]);
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

// --- createTestAdapter — stdin fields

describe('createTestAdapter stdin', () => {
	it('default stdin returns null (EOF)', async () => {
		const adapter = createTestAdapter();
		const result = await adapter.stdin();
		expect(result).toBeNull();
	});

	it('readStdin consumes stdinData once', async () => {
		const adapter = createTestAdapter({ stdinData: 'stdin-target' });

		expect(await adapter.readStdin()).toBe('stdin-target');
		expect(await adapter.readStdin()).toBeNull();
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

	it('readStdin returns null when stdinIsTTY is true', async () => {
		const adapter = createTestAdapter({
			stdinData: 'stdin-target',
			stdinIsTTY: true,
		});

		expect(await adapter.readStdin()).toBeNull();
		expect(await adapter.readStdin()).toBeNull();
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

// --- createNodeAdapter — stdin fields

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

	it('readStdin returns empty string for empty non-TTY stdin', async () => {
		const adapter = createNodeAdapter(mockNodeProcess({ stdin: mockStdin({ isTTY: false }) }));
		expect(await adapter.readStdin()).toBe('');
	});

	it('preserves buffered remainder across sequential stdin() reads', async () => {
		const encoder = new TextEncoder();
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdin: mockStdin({
					[Symbol.asyncIterator]: async function* (): AsyncGenerator<Uint8Array> {
						yield encoder.encode('first\nsecond\n');
					},
				}),
			}),
		);

		expect(await adapter.stdin()).toBe('first');
		expect(await adapter.stdin()).toBe('second');
		expect(await adapter.stdin()).toBeNull();
	});

	it('handles UTF-8 characters split across chunks', async () => {
		const bytes = new TextEncoder().encode('🙂\nok\n');
		const adapter = createNodeAdapter(
			mockNodeProcess({
				stdin: mockStdin({
					[Symbol.asyncIterator]: async function* (): AsyncGenerator<Uint8Array> {
						yield bytes.slice(0, 2);
						yield bytes.slice(2);
					},
				}),
			}),
		);

		expect(await adapter.stdin()).toBe('🙂');
		expect(await adapter.stdin()).toBe('ok');
		expect(await adapter.stdin()).toBeNull();
	});
});

// === RuntimeAdapter interface — contracts

describe('RuntimeAdapter interface — contracts', () => {
	// --- stdin contract

	describe('stdin', () => {
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

	// --- CLIBuilder.run() — auto-prompter from adapter stdin

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
			const { createTestPrompter } = await import('#internals/core/prompt/test-prompter.ts');
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

	// --- createTestAdapter — filesystem fields

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

	// --- createNodeAdapter — filesystem fields

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

		it('configDir defaults to /.config when linux homedir is root', () => {
			const adapter = createNodeAdapter(
				mockNodeProcess({
					env: { HOME: '/' },
				}),
			);
			expect(adapter.configDir).toBe('/.config');
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
			expect(content).toContain('@kjanat/dreamcli');
		});

		it('readFile returns null for nonexistent files', async () => {
			const adapter = createNodeAdapter();
			const result = await adapter.readFile('/tmp/dreamcli-test-nonexistent-file-12345');
			expect(result).toBeNull();
		});
	});

	// --- filesystem contract

	describe('filesystem', () => {
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
});

// --- Public surface exports

describe('public surface', () => {
	it('exports RuntimeAdapter type and factories from runtime barrel', async () => {
		const mod = await import('./index.ts');
		expect(mod.createTestAdapter).toBeDefined();
		expect(mod.createNodeAdapter).toBeDefined();
		expect(mod.ExitError).toBeDefined();
	});

	it('exports adapter factories from runtime barrel', async () => {
		const mod = await import('#dreamcli/runtime');
		expect(mod.createNodeAdapter).toBeDefined();
		expect(mod.ExitError).toBeDefined();
	});

	it('exports test adapter from testkit barrel', async () => {
		const mod = await import('#dreamcli/testkit');
		expect(mod.createTestAdapter).toBeDefined();
	});
});
