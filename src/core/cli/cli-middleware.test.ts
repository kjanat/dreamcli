/**
 * Integration tests for middleware wired through CLIBuilder.execute() and .run().
 *
 * Verifies that middleware registered on commands is properly executed when
 * dispatched through the CLI entry point, not just via direct runCommand().
 */

import { describe, expect, it, vi } from 'vitest';
import { CLIError } from '../errors/index.ts';
import { arg } from '../schema/arg.ts';
import { command } from '../schema/command.ts';
import { flag } from '../schema/flag.ts';
import { middleware } from '../schema/middleware.ts';
import { cli } from './index.ts';

// ---------------------------------------------------------------------------
// Middleware flows through CLI dispatch
// ---------------------------------------------------------------------------

describe('middleware through CLI dispatch', () => {
	it('middleware adds context to action handler via cli.execute()', async () => {
		const auth = middleware(async ({ next }) => next({ user: 'alice' }));
		let receivedCtx: unknown;

		const cmd = command('greet')
			.middleware(auth)
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['greet']);

		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({ user: 'alice' });
	});

	it('multiple middleware compose context via CLI dispatch', async () => {
		const auth = middleware(async ({ next }) => next({ user: 'alice' }));
		const trace = middleware(async ({ next }) => next({ traceId: 'abc-123' }));
		let receivedCtx: unknown;

		const cmd = command('deploy')
			.arg('target', arg.string())
			.middleware(auth)
			.middleware(trace)
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['deploy', 'production']);

		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({ user: 'alice', traceId: 'abc-123' });
	});

	it('middleware executes in registration order via CLI dispatch', async () => {
		const order: string[] = [];

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const first = middleware<{}>(async ({ next }) => {
			order.push('first-before');
			await next({});
			order.push('first-after');
		});

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const second = middleware<{}>(async ({ next }) => {
			order.push('second-before');
			await next({});
			order.push('second-after');
		});

		const cmd = command('test')
			.middleware(first)
			.middleware(second)
			.action(() => {
				order.push('action');
			});

		const app = cli('mycli').command(cmd);
		await app.execute(['test']);

		expect(order).toEqual([
			'first-before',
			'second-before',
			'action',
			'second-after',
			'first-after',
		]);
	});
});

// ---------------------------------------------------------------------------
// Middleware receives resolved values
// ---------------------------------------------------------------------------

describe('middleware receives resolved flags/args via CLI dispatch', () => {
	it('middleware receives parsed flags and args', async () => {
		let receivedFlags: unknown;
		let receivedArgs: unknown;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const spy = middleware<{}>(async ({ args, flags, next }) => {
			receivedFlags = flags;
			receivedArgs = args;
			await next({});
		});

		const cmd = command('deploy')
			.flag('force', flag.boolean().alias('f'))
			.arg('target', arg.string())
			.middleware(spy)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		await app.execute(['deploy', 'production', '--force']);

		expect(receivedFlags).toEqual({ force: true });
		expect(receivedArgs).toEqual({ target: 'production' });
	});

	it('middleware receives env-resolved flags', async () => {
		let receivedFlags: unknown;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const spy = middleware<{}>(async ({ flags, next }) => {
			receivedFlags = flags;
			await next({});
		});

		const cmd = command('deploy')
			.flag('region', flag.string().env('DEPLOY_REGION'))
			.middleware(spy)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		await app.execute(['deploy'], { env: { DEPLOY_REGION: 'eu' } });

		expect(receivedFlags).toEqual({ region: 'eu' });
	});
});

// ---------------------------------------------------------------------------
// Middleware error handling via CLI
// ---------------------------------------------------------------------------

describe('middleware errors via CLI dispatch', () => {
	it('CLIError in middleware propagates with correct exit code', async () => {
		const guard = middleware(async (_params) => {
			throw new CLIError('Forbidden', { code: 'FORBIDDEN', exitCode: 3 });
		});

		const handler = vi.fn();
		const cmd = command('secret').middleware(guard).action(handler);

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['secret']);

		expect(result.exitCode).toBe(3);
		expect(result.error?.code).toBe('FORBIDDEN');
		expect(result.stderr.join('')).toContain('Forbidden');
		expect(handler).not.toHaveBeenCalled();
	});

	it('middleware short-circuit (no next call) via CLI dispatch', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const gate = middleware<{}>(async ({ out }) => {
			out.log('access denied');
			// intentionally not calling next()
		});

		const handler = vi.fn();
		const cmd = command('secret').middleware(gate).action(handler);

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['secret']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('access denied');
		expect(handler).not.toHaveBeenCalled();
	});

	it('middleware error renders as JSON in --json mode', async () => {
		const guard = middleware(async (_params) => {
			throw new CLIError('Not authenticated', {
				code: 'AUTH_REQUIRED',
				exitCode: 2,
				suggest: 'Run `mycli login`',
			});
		});

		const cmd = command('deploy')
			.middleware(guard)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['deploy', '--json']);

		expect(result.exitCode).toBe(2);
		const output = result.stdout.join('');
		const parsed = JSON.parse(output.trim());
		expect(parsed).toHaveProperty('error');
		expect(parsed.error.code).toBe('AUTH_REQUIRED');
	});
});

// ---------------------------------------------------------------------------
// Middleware + output channel integration
// ---------------------------------------------------------------------------

describe('middleware + output channel via CLI dispatch', () => {
	it('middleware can write to output channel', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const logger = middleware<{}>(async ({ out, next }) => {
			out.info('request started');
			await next({});
			out.info('request complete');
		});

		const cmd = command('ping')
			.middleware(logger)
			.action(({ out }) => {
				out.log('pong');
			});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['ping']);

		expect(result.exitCode).toBe(0);
		const stdout = result.stdout.join('');
		expect(stdout).toContain('request started');
		expect(stdout).toContain('pong');
		expect(stdout).toContain('request complete');
	});

	it('middleware output respects verbosity', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const logger = middleware<{}>(async ({ out, next }) => {
			out.info('verbose info');
			out.log('always visible');
			await next({});
		});

		const cmd = command('ping')
			.middleware(logger)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		const quiet = await app.execute(['ping'], { verbosity: 'quiet' });

		expect(quiet.stdout.join('')).toContain('always visible');
		expect(quiet.stdout.join('')).not.toContain('verbose info');
	});

	it('middleware output respects isTTY', async () => {
		let middlewareSawTTY: boolean | undefined;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const spy = middleware<{}>(async ({ out, next }) => {
			middlewareSawTTY = out.isTTY;
			await next({});
		});

		const cmd = command('test')
			.middleware(spy)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		await app.execute(['test'], { isTTY: true });
		expect(middlewareSawTTY).toBe(true);

		await app.execute(['test'], { isTTY: false });
		expect(middlewareSawTTY).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Middleware on different commands (independent middleware chains)
// ---------------------------------------------------------------------------

describe('independent middleware chains per command', () => {
	it('each command runs its own middleware', async () => {
		let deployCtx: unknown;
		let loginCtx: unknown;

		const deployAuth = middleware(async ({ next }) => next({ role: 'deployer' }));
		const loginAuth = middleware(async ({ next }) => next({ role: 'user' }));

		const deploy = command('deploy')
			.middleware(deployAuth)
			.action(({ ctx }) => {
				deployCtx = ctx;
			});

		const login = command('login')
			.middleware(loginAuth)
			.action(({ ctx }) => {
				loginCtx = ctx;
			});

		const app = cli('mycli').command(deploy).command(login);

		await app.execute(['deploy']);
		expect(deployCtx).toEqual({ role: 'deployer' });

		await app.execute(['login']);
		expect(loginCtx).toEqual({ role: 'user' });
	});
});

// ---------------------------------------------------------------------------
// Middleware with --help bypass
// ---------------------------------------------------------------------------

describe('middleware + --help interaction', () => {
	it('--help bypasses middleware (help shown, middleware not run)', async () => {
		const handler = vi.fn();
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const mw = middleware<{}>(async ({ next }) => {
			handler();
			await next({});
		});

		const cmd = command('deploy')
			.description('Deploy to production')
			.middleware(mw)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['deploy', '--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Deploy to production');
		expect(handler).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Backward compatibility: commands without middleware
// ---------------------------------------------------------------------------

describe('backward compatibility: no middleware', () => {
	it('commands without middleware still work through CLI dispatch', async () => {
		let receivedCtx: unknown;

		const cmd = command('test').action(({ ctx }) => {
			receivedCtx = ctx;
		});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['test']);

		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({});
	});
});
