/**
 * End-to-end middleware + context type safety tests.
 *
 * Exercises the full pipeline: argv → parse → resolve → middleware → action
 * via both `runCommand()` (testkit) and `cli().execute()` (CLI dispatch).
 *
 * Focus areas:
 * - Multi-middleware context composition with complex types
 * - Typed ctx in action handlers (compile-time assertions)
 * - Error middleware (catch, rethrow, transform)
 * - Middleware ordering and wrap-around patterns
 * - Context isolation between commands
 * - Middleware interplay with env/config/default resolution
 * - Middleware + JSON mode + TTY mode end-to-end
 */

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { cli } from '../cli/index.ts';
import { CLIError } from '../errors/index.ts';
import { arg } from '../schema/arg.ts';
import { command } from '../schema/command.ts';
import { flag } from '../schema/flag.ts';
import { middleware } from '../schema/middleware.ts';
import { runCommand } from './index.ts';

// ---------------------------------------------------------------------------
// Shared middleware definitions — realistic patterns
// ---------------------------------------------------------------------------

interface User {
	readonly id: string;
	readonly name: string;
	readonly role: 'admin' | 'user';
}

const authMiddleware = middleware<{ user: User }>(async ({ next }) => {
	const user: User = { id: 'u-1', name: 'Alice', role: 'admin' };
	return next({ user });
});

const traceMiddleware = middleware<{ traceId: string; startTime: number }>(async ({ next }) => {
	return next({ traceId: 'trace-abc-123', startTime: Date.now() });
});

const tenantMiddleware = middleware<{ tenantId: string }>(async ({ flags, next }) => {
	const tenantId = typeof flags.tenant === 'string' ? flags.tenant : 'default-tenant';
	return next({ tenantId });
});

// ---------------------------------------------------------------------------
// Multi-middleware context composition — runCommand path
// ---------------------------------------------------------------------------

describe('e2e: multi-middleware context composition (runCommand)', () => {
	it('three middleware compose a rich context object', async () => {
		let receivedCtx: unknown;

		const cmd = command('deploy')
			.flag('tenant', flag.string().default('acme'))
			.arg('target', arg.string())
			.middleware(authMiddleware)
			.middleware(traceMiddleware)
			.middleware(tenantMiddleware)
			.action(({ ctx, args, flags }) => {
				receivedCtx = { ctx, args, flags };
			});

		const result = await runCommand(cmd, ['production', '--tenant', 'corp']);

		expect(result.exitCode).toBe(0);
		const captured = receivedCtx as {
			ctx: { user: User; traceId: string; startTime: number; tenantId: string };
			args: { target: string };
			flags: { tenant: string };
		};
		expect(captured.ctx.user).toEqual({ id: 'u-1', name: 'Alice', role: 'admin' });
		expect(captured.ctx.traceId).toBe('trace-abc-123');
		expect(captured.ctx.startTime).toBeTypeOf('number');
		expect(captured.ctx.tenantId).toBe('corp');
		expect(captured.args.target).toBe('production');
		expect(captured.flags.tenant).toBe('corp');
	});

	it('middleware context carries through to action even with env/config resolution', async () => {
		let receivedCtx: unknown;
		let receivedFlags: unknown;

		const cmd = command('deploy')
			.flag('region', flag.string().env('DEPLOY_REGION').default('us'))
			.flag('verbose', flag.boolean().default(false))
			.middleware(authMiddleware)
			.middleware(traceMiddleware)
			.action(({ ctx, flags }) => {
				receivedCtx = ctx;
				receivedFlags = flags;
			});

		const result = await runCommand(cmd, ['--verbose'], {
			env: { DEPLOY_REGION: 'eu' },
		});

		expect(result.exitCode).toBe(0);
		expect((receivedCtx as { user: User }).user.name).toBe('Alice');
		expect((receivedCtx as { traceId: string }).traceId).toBe('trace-abc-123');
		expect((receivedFlags as { region: string }).region).toBe('eu');
		expect((receivedFlags as { verbose: boolean }).verbose).toBe(true);
	});

	it('downstream middleware receives upstream context', async () => {
		const contexts: Array<Record<string, unknown>> = [];

		const first = middleware<{ step: number }>(async ({ ctx, next }) => {
			contexts.push({ ...ctx });
			return next({ step: 1 });
		});

		const second = middleware<{ label: string }>(async ({ ctx, next }) => {
			contexts.push({ ...ctx });
			return next({ label: 'two' });
		});

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const third = middleware<{}>(async ({ ctx, next }) => {
			contexts.push({ ...ctx });
			return next({});
		});

		const cmd = command('test')
			.middleware(first)
			.middleware(second)
			.middleware(third)
			.action(() => {});

		await runCommand(cmd, []);

		// first middleware sees empty ctx
		expect(contexts[0]).toEqual({});
		// second middleware sees { step: 1 }
		expect(contexts[1]).toEqual({ step: 1 });
		// third middleware sees { step: 1, label: 'two' }
		expect(contexts[2]).toEqual({ step: 1, label: 'two' });
	});
});

// ---------------------------------------------------------------------------
// Typed context in action handlers — compile-time assertions
// ---------------------------------------------------------------------------

describe('e2e: typed ctx in action handlers', () => {
	it('ctx type narrows through middleware chain', () => {
		// This test is primarily a compile-time assertion — if it compiles, the
		// type system correctly narrows ctx through the middleware chain.
		command('test')
			.middleware(authMiddleware)
			.middleware(traceMiddleware)
			.action(({ ctx }) => {
				// Compile-time: ctx should have user, traceId, startTime
				expectTypeOf(ctx.user).toMatchTypeOf<User>();
				expectTypeOf(ctx.traceId).toBeString();
				expectTypeOf(ctx.startTime).toBeNumber();
			});
	});

	it('ctx without middleware is Record<string, never>', () => {
		command('test').action(({ ctx }) => {
			expectTypeOf(ctx).toEqualTypeOf<Readonly<Record<string, never>>>();
		});
	});

	it('single middleware narrows ctx to its output type', () => {
		command('test')
			.middleware(authMiddleware)
			.action(({ ctx }) => {
				expectTypeOf(ctx.user).toMatchTypeOf<User>();
				expectTypeOf(ctx.user.role).toMatchTypeOf<'admin' | 'user'>();
			});
	});

	it('middleware + flags + args all correctly typed in action', () => {
		command('test')
			.flag('force', flag.boolean())
			.flag('count', flag.number().default(1))
			.arg('name', arg.string())
			.middleware(authMiddleware)
			.middleware(traceMiddleware)
			.action(({ args, flags, ctx }) => {
				expectTypeOf(args.name).toBeString();
				expectTypeOf(flags.force).toBeBoolean();
				expectTypeOf(flags.count).toBeNumber();
				expectTypeOf(ctx.user).toMatchTypeOf<User>();
				expectTypeOf(ctx.traceId).toBeString();
			});
	});
});

// ---------------------------------------------------------------------------
// Error middleware patterns
// ---------------------------------------------------------------------------

describe('e2e: error middleware patterns', () => {
	it('middleware CLIError propagates with exit code and structured error', async () => {
		const guard = middleware<{ user: User }>(async (_params) => {
			throw new CLIError('Unauthorized', {
				code: 'AUTH_REQUIRED',
				exitCode: 2,
				suggest: 'Run `mycli login` first',
				details: { requiredRole: 'admin' },
			});
		});

		const handler = vi.fn();
		const cmd = command('secret').middleware(guard).action(handler);

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(2);
		expect(result.error).toBeInstanceOf(CLIError);
		expect(result.error?.code).toBe('AUTH_REQUIRED');
		expect(result.error?.suggest).toBe('Run `mycli login` first');
		expect(result.error?.details).toEqual({ requiredRole: 'admin' });
		expect(handler).not.toHaveBeenCalled();
	});

	it('non-CLIError in middleware is wrapped as UNEXPECTED_ERROR', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const broken = middleware<{}>(async (_params) => {
			throw new TypeError('Cannot read property of undefined');
		});

		const cmd = command('test')
			.middleware(broken)
			.action(() => {});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('UNEXPECTED_ERROR');
		expect(result.error?.message).toContain('Cannot read property of undefined');
	});

	it('error in later middleware skips action and earlier after-hooks', async () => {
		const order: string[] = [];

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const outer = middleware<{}>(async ({ next }) => {
			order.push('outer-before');
			await next({});
			order.push('outer-after');
		});

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const failing = middleware<{}>(async (_params) => {
			order.push('failing');
			throw new CLIError('boom', { code: 'BOOM' });
		});

		const cmd = command('test')
			.middleware(outer)
			.middleware(failing)
			.action(() => {
				order.push('action');
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(1);
		// outer-before runs, failing runs and throws, outer-after does NOT run
		// (error propagates out of the continuation chain)
		expect(order).toEqual(['outer-before', 'failing']);
	});

	it('middleware can catch downstream errors and transform them', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const errorTransformer = middleware<{}>(async ({ next }) => {
			try {
				await next({});
			} catch (err: unknown) {
				if (err instanceof CLIError && err.code === 'ORIGINAL') {
					throw new CLIError('Transformed error', {
						code: 'TRANSFORMED',
						exitCode: 42,
						cause: err,
					});
				}
				throw err;
			}
		});

		const cmd = command('test')
			.middleware(errorTransformer)
			.action(() => {
				throw new CLIError('Original error', { code: 'ORIGINAL', exitCode: 1 });
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(42);
		expect(result.error?.code).toBe('TRANSFORMED');
		expect(result.error?.message).toBe('Transformed error');
	});

	it('middleware short-circuit by not calling next still returns exitCode 0', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const earlyReturn = middleware<{}>(async ({ out }) => {
			out.json({ status: 'cached', message: 'Using cached result' });
			// Intentionally not calling next()
		});

		const handler = vi.fn();
		const cmd = command('build').middleware(earlyReturn).action(handler);

		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		expect(handler).not.toHaveBeenCalled();
		const output = result.stdout.join('');
		expect(JSON.parse(output.trim())).toEqual({
			status: 'cached',
			message: 'Using cached result',
		});
	});
});

// ---------------------------------------------------------------------------
// Middleware ordering and wrap-around patterns
// ---------------------------------------------------------------------------

describe('e2e: middleware ordering and wrap-around', () => {
	it('onion model: three middleware wrap action in correct order', async () => {
		const events: string[] = [];

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const logging = middleware<{}>(async ({ next }) => {
			events.push('log:enter');
			await next({});
			events.push('log:exit');
		});

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const timing = middleware<{}>(async ({ next }) => {
			events.push('time:enter');
			await next({});
			events.push('time:exit');
		});

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const auth = middleware<{}>(async ({ next }) => {
			events.push('auth:enter');
			await next({});
			events.push('auth:exit');
		});

		const cmd = command('test')
			.middleware(logging)
			.middleware(timing)
			.middleware(auth)
			.action(() => {
				events.push('action');
			});

		await runCommand(cmd, []);

		expect(events).toEqual([
			'log:enter',
			'time:enter',
			'auth:enter',
			'action',
			'auth:exit',
			'time:exit',
			'log:exit',
		]);
	});

	it('middleware can measure action duration (timing wrapper pattern)', async () => {
		let afterRan = false;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const timer = middleware<{}>(async ({ out, next }) => {
			out.info('timer:start');
			await next({});
			out.info('timer:end');
			afterRan = true;
		});

		const cmd = command('work')
			.middleware(timer)
			.action(({ out }) => {
				out.log('doing work');
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(afterRan).toBe(true);
		const stdout = result.stdout.join('');
		const startIdx = stdout.indexOf('timer:start');
		const workIdx = stdout.indexOf('doing work');
		const endIdx = stdout.indexOf('timer:end');
		expect(startIdx).toBeLessThan(workIdx);
		expect(workIdx).toBeLessThan(endIdx);
	});

	it('context additions from middleware are cumulative, not replaced', async () => {
		const a = middleware<{ a: number }>(async ({ next }) => next({ a: 1 }));
		const b = middleware<{ b: number }>(async ({ next }) => next({ b: 2 }));
		const c = middleware<{ c: number }>(async ({ next }) => next({ c: 3 }));

		let receivedCtx: unknown;

		const cmd = command('test')
			.middleware(a)
			.middleware(b)
			.middleware(c)
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		await runCommand(cmd, []);

		expect(receivedCtx).toEqual({ a: 1, b: 2, c: 3 });
	});
});

// ---------------------------------------------------------------------------
// Full CLI dispatch path — e2e through cli().execute()
// ---------------------------------------------------------------------------

describe('e2e: middleware through CLI dispatch', () => {
	it('realistic auth + tracing pipeline via cli.execute()', async () => {
		let receivedCtx: unknown;

		const deploy = command('deploy')
			.description('Deploy application')
			.flag('env', flag.string().default('staging'))
			.arg('service', arg.string())
			.middleware(authMiddleware)
			.middleware(traceMiddleware)
			.action(({ ctx, args, flags, out }) => {
				receivedCtx = ctx;
				out.log(`Deploying ${args.service} to ${flags.env}`);
			});

		const app = cli('mycli').command(deploy);
		const result = await app.execute(['deploy', 'api', '--env', 'production']);

		expect(result.exitCode).toBe(0);
		const ctx = receivedCtx as { user: User; traceId: string; startTime: number };
		expect(ctx.user.name).toBe('Alice');
		expect(ctx.traceId).toBe('trace-abc-123');
		expect(result.stdout.join('')).toContain('Deploying api to production');
	});

	it('middleware error in CLI dispatch renders as JSON in --json mode', async () => {
		const failingAuth = middleware(async (_params) => {
			throw new CLIError('Token expired', {
				code: 'TOKEN_EXPIRED',
				exitCode: 2,
				suggest: 'Run `mycli auth refresh`',
			});
		});

		const cmd = command('deploy')
			.middleware(failingAuth)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['deploy', '--json']);

		expect(result.exitCode).toBe(2);
		const output = result.stdout.join('');
		const parsed = JSON.parse(output.trim());
		expect(parsed.error.code).toBe('TOKEN_EXPIRED');
		expect(parsed.error.suggest).toBe('Run `mycli auth refresh`');
	});

	it('middleware error in CLI dispatch renders as text in normal mode', async () => {
		const failingAuth = middleware(async (_params) => {
			throw new CLIError('Token expired', {
				code: 'TOKEN_EXPIRED',
				exitCode: 2,
				suggest: 'Run `mycli auth refresh`',
			});
		});

		const cmd = command('deploy')
			.middleware(failingAuth)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['deploy']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Token expired');
		expect(result.stderr.join('')).toContain('Run `mycli auth refresh`');
	});

	it('multiple commands have independent middleware chains', async () => {
		let deployCtx: unknown;
		let statusCtx: unknown;

		const deploy = command('deploy')
			.middleware(authMiddleware)
			.middleware(traceMiddleware)
			.action(({ ctx }) => {
				deployCtx = ctx;
			});

		const status = command('status')
			.middleware(traceMiddleware)
			.action(({ ctx }) => {
				statusCtx = ctx;
			});

		const app = cli('mycli').command(deploy).command(status);

		await app.execute(['deploy']);
		await app.execute(['status']);

		// deploy has auth + trace middleware
		const dCtx = deployCtx as { user: User; traceId: string };
		expect(dCtx.user.name).toBe('Alice');
		expect(dCtx.traceId).toBe('trace-abc-123');

		// status only has trace middleware — no user
		const sCtx = statusCtx as Record<string, unknown>;
		expect(sCtx.traceId).toBe('trace-abc-123');
		expect(sCtx).not.toHaveProperty('user');
	});

	it('--help bypasses middleware chain entirely', async () => {
		const middlewareCalled = vi.fn();

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const mw = middleware<{}>(async ({ next }) => {
			middlewareCalled();
			await next({});
		});

		const cmd = command('deploy')
			.description('Deploy the app')
			.middleware(mw)
			.action(() => {});

		const app = cli('mycli').command(cmd);
		const result = await app.execute(['deploy', '--help']);

		expect(result.exitCode).toBe(0);
		expect(middlewareCalled).not.toHaveBeenCalled();
		expect(result.stdout.join('')).toContain('Deploy the app');
	});
});

// ---------------------------------------------------------------------------
// Middleware + output modes (JSON, TTY) e2e
// ---------------------------------------------------------------------------

describe('e2e: middleware + output modes', () => {
	it('middleware output in JSON mode: log→stderr, json→stdout', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const logger = middleware<{}>(async ({ out, next }) => {
			out.log('log from middleware');
			out.info('info from middleware');
			await next({});
		});

		const cmd = command('test')
			.middleware(logger)
			.action(({ out }) => {
				out.json({ result: 'ok' });
			});

		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		// In JSON mode, log/info go to stderr
		expect(result.stderr.join('')).toContain('log from middleware');
		expect(result.stderr.join('')).toContain('info from middleware');
		// json() goes to stdout
		const stdout = result.stdout.join('');
		expect(JSON.parse(stdout.trim())).toEqual({ result: 'ok' });
	});

	it('middleware can inspect isTTY and adapt behavior', async () => {
		let ttyInMiddleware: boolean | undefined;
		let ttyInAction: boolean | undefined;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const spy = middleware<{}>(async ({ out, next }) => {
			ttyInMiddleware = out.isTTY;
			await next({});
		});

		const cmd = command('test')
			.middleware(spy)
			.action(({ out }) => {
				ttyInAction = out.isTTY;
			});

		await runCommand(cmd, [], { isTTY: true });
		expect(ttyInMiddleware).toBe(true);
		expect(ttyInAction).toBe(true);

		await runCommand(cmd, [], { isTTY: false });
		expect(ttyInMiddleware).toBe(false);
		expect(ttyInAction).toBe(false);
	});

	it('middleware + table output in JSON mode emits JSON array', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const logger = middleware<{}>(async ({ out, next }) => {
			out.info('fetching data');
			await next({});
		});

		const cmd = command('list')
			.middleware(logger)
			.action(({ out }) => {
				out.table([
					{ name: 'api', status: 'running' },
					{ name: 'web', status: 'stopped' },
				]);
			});

		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		const stdout = result.stdout.join('');
		const parsed = JSON.parse(stdout.trim());
		expect(parsed).toEqual([
			{ name: 'api', status: 'running' },
			{ name: 'web', status: 'stopped' },
		]);
	});

	it('middleware + verbosity=quiet suppresses info but not log', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const logger = middleware<{}>(async ({ out, next }) => {
			out.info('debug info');
			out.log('important message');
			await next({});
		});

		const cmd = command('test')
			.middleware(logger)
			.action(({ out }) => {
				out.log('action output');
			});

		const result = await runCommand(cmd, [], { verbosity: 'quiet' });

		expect(result.exitCode).toBe(0);
		const stdout = result.stdout.join('');
		expect(stdout).toContain('important message');
		expect(stdout).toContain('action output');
		expect(stdout).not.toContain('debug info');
	});
});

// ---------------------------------------------------------------------------
// Middleware + resolution chain interplay
// ---------------------------------------------------------------------------

describe('e2e: middleware + resolution chain', () => {
	it('middleware sees values after full env + config + default resolution', async () => {
		let middlewareFlags: unknown;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const spy = middleware<{}>(async ({ flags, next }) => {
			middlewareFlags = flags;
			await next({});
		});

		const cmd = command('deploy')
			.flag('region', flag.string().env('REGION').default('us'))
			.flag('count', flag.number().default(3))
			.flag('force', flag.boolean())
			.middleware(spy)
			.action(() => {});

		// CLI flag overrides env which overrides default
		await runCommand(cmd, ['--force'], {
			env: { REGION: 'eu' },
		});

		expect(middlewareFlags).toEqual({
			region: 'eu', // from env
			count: 3, // from default
			force: true, // from CLI
		});
	});

	it('middleware sees config-resolved values', async () => {
		let middlewareFlags: unknown;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const spy = middleware<{}>(async ({ flags, next }) => {
			middlewareFlags = flags;
			await next({});
		});

		const cmd = command('deploy')
			.flag('region', flag.string().config('deploy.region').default('us'))
			.middleware(spy)
			.action(() => {});

		await runCommand(cmd, [], {
			config: { deploy: { region: 'ap' } },
		});

		expect(middlewareFlags).toEqual({ region: 'ap' });
	});

	it('middleware can use resolved args for conditional logic', async () => {
		let authorized = false;

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const roleGuard = middleware<{}>(async ({ args, next }) => {
			const target = args.target;
			if (target === 'production') {
				throw new CLIError('Production deploys require admin approval', {
					code: 'FORBIDDEN',
					exitCode: 3,
				});
			}
			authorized = true;
			await next({});
		});

		const cmd = command('deploy')
			.arg('target', arg.string())
			.middleware(roleGuard)
			.action(() => {});

		// staging succeeds
		const staging = await runCommand(cmd, ['staging']);
		expect(staging.exitCode).toBe(0);
		expect(authorized).toBe(true);

		// production fails
		authorized = false;
		const prod = await runCommand(cmd, ['production']);
		expect(prod.exitCode).toBe(3);
		expect(prod.error?.code).toBe('FORBIDDEN');
		expect(authorized).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('e2e: middleware edge cases', () => {
	it('middleware with async work still preserves context', async () => {
		const asyncAuth = middleware<{ user: string }>(async ({ next }) => {
			// Simulate async work (e.g. token validation, DB lookup)
			await Promise.resolve();
			await Promise.resolve();
			return next({ user: 'async-alice' });
		});

		let receivedCtx: unknown;

		const cmd = command('test')
			.middleware(asyncAuth)
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({ user: 'async-alice' });
	});

	it('middleware context does not leak across separate runCommand calls', async () => {
		const auth = middleware<{ user: string }>(async ({ next }) => {
			return next({ user: 'alice' });
		});

		let ctxA: unknown;
		let ctxB: unknown;

		const cmdA = command('a')
			.middleware(auth)
			.action(({ ctx }) => {
				ctxA = ctx;
			});

		const cmdB = command('b').action(({ ctx }) => {
			ctxB = ctx;
		});

		await runCommand(cmdA, []);
		await runCommand(cmdB, []);

		expect(ctxA).toEqual({ user: 'alice' });
		expect(ctxB).toEqual({}); // no middleware, clean ctx
	});

	it('later middleware can override earlier context properties', async () => {
		const first = middleware<{ value: string }>(async ({ next }) => {
			return next({ value: 'first' });
		});

		const second = middleware<{ value: string }>(async ({ next }) => {
			return next({ value: 'second' });
		});

		let receivedCtx: unknown;

		const cmd = command('test')
			.middleware(first)
			.middleware(second)
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		await runCommand(cmd, []);
		// Later middleware's additions are spread after earlier ones,
		// so 'second' wins for overlapping keys
		expect(receivedCtx).toEqual({ value: 'second' });
	});

	it('middleware with zero-property additions still chains correctly', async () => {
		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const noOp = middleware<{}>(async ({ next }) => next({}));
		const auth = middleware<{ user: string }>(async ({ next }) => next({ user: 'alice' }));

		let receivedCtx: unknown;

		const cmd = command('test')
			.middleware(noOp)
			.middleware(auth)
			.middleware(noOp)
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		await runCommand(cmd, []);
		expect(receivedCtx).toEqual({ user: 'alice' });
	});

	it('many middleware (10) compose without stack issues', async () => {
		let receivedCtx: unknown;

		// Build 10 middleware that each add a unique key to context.
		// Use explicit chaining to avoid type-level reassignment issues.
		const mw = (idx: number) =>
			middleware<Record<string, number>>(async ({ next }) => next({ [`m${idx}`]: idx }));

		const cmd = command('test')
			.middleware(mw(0))
			.middleware(mw(1))
			.middleware(mw(2))
			.middleware(mw(3))
			.middleware(mw(4))
			.middleware(mw(5))
			.middleware(mw(6))
			.middleware(mw(7))
			.middleware(mw(8))
			.middleware(mw(9))
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		const ctx = receivedCtx as Record<string, number>;
		for (let i = 0; i < 10; i++) {
			expect(ctx[`m${i}`]).toBe(i);
		}
	});
});
