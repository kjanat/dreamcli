import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { arg } from './arg.ts';
import { command } from './command.ts';
import { flag } from './flag.ts';
import { middleware } from './middleware.ts';

// --- Factory function

describe('middleware()', () => {
	it('creates a middleware with _handler property', () => {
		const m = middleware(async ({ next }) => next({}));
		expect(m._handler).toBeTypeOf('function');
	});

	it('handler receives correct params shape', () => {
		const m = middleware(async (params) => {
			expect(params).toHaveProperty('args');
			expect(params).toHaveProperty('flags');
			expect(params).toHaveProperty('ctx');
			expect(params).toHaveProperty('out');
			expect(params).toHaveProperty('next');
			await params.next({});
		});
		expect(m._handler).toBeTypeOf('function');
	});
});

// --- Type inference — compile-time

describe('middleware type inference', () => {
	it('next() constrains additions type', () => {
		// The handler's next() parameter must match Output — this is a
		// compile-time assertion: if the type were wrong, this wouldn't compile.
		const m = middleware(async ({ next }) => next({ user: 'alice' }));
		expect(m._handler).toBeTypeOf('function');
	});

	it('explicit Output generic constrains next()', () => {
		interface User {
			id: string;
			name: string;
		}
		// Explicit generic ensures next() requires { user: User }
		const m = middleware<{ user: User }>(async ({ next }) => {
			const user: User = { id: '1', name: 'alice' };
			return next({ user });
		});
		expect(m._handler).toBeTypeOf('function');
	});

	it('CommandBuilder.middleware() widens C correctly', () => {
		// The key type-level test: middleware widens the ctx type.
		// Verified through the action handler's ctx parameter type.
		const auth = middleware<{ user: string }>(async ({ next }) => next({ user: 'alice' }));

		command('test')
			.middleware(auth)
			.action(({ ctx }) => {
				// ctx.user is string — compile-time assertion
				const u: string = ctx.user;
				expect(u).toBe(u); // prevent unused
			});
	});
});

// === CommandBuilder.middleware()

describe('CommandBuilder.middleware()', () => {
	// --- runtime

	describe('runtime', () => {
		it('adds middleware handler to schema', () => {
			const m = middleware(async ({ next }) => next({}));
			const cmd = command('test').middleware(m);
			expect(cmd.schema.middleware).toHaveLength(1);
		});

		it('accumulates multiple middleware in order', () => {
			const first = middleware(async ({ next }) => next({ a: 1 }));
			const second = middleware(async ({ next }) => next({ b: 2 }));
			const cmd = command('test').middleware(first).middleware(second);
			expect(cmd.schema.middleware).toHaveLength(2);
			expect(cmd.schema.middleware[0]).toBe(first._handler);
			expect(cmd.schema.middleware[1]).toBe(second._handler);
		});

		it('returns a new builder (immutability)', () => {
			const m = middleware(async ({ next }) => next({}));
			const a = command('test');
			const b = a.middleware(m);
			expect(a).not.toBe(b);
			expect(a.schema.middleware).toEqual([]);
		});

		it('drops handler when middleware added (type safety)', () => {
			const m = middleware(async ({ next }) => next({}));
			const handler = vi.fn();
			const a = command('test').action(handler);
			expect(a.handler).toBe(handler);
			expect(a.schema.hasAction).toBe(true);

			const b = a.middleware(m);
			expect(b.handler).toBeUndefined();
			expect(b.schema.hasAction).toBe(false);
		});

		it('preserves existing metadata when adding middleware', () => {
			const m = middleware(async ({ next }) => next({}));
			const cmd = command('deploy')
				.description('Deploy')
				.alias('d')
				.flag('force', flag.boolean())
				.middleware(m);

			expect(cmd.schema.description).toBe('Deploy');
			expect(cmd.schema.aliases).toEqual(['d']);
			expect(cmd.schema.flags.force).toBeDefined();
		});

		it('empty middleware array by default', () => {
			const cmd = command('test');
			expect(cmd.schema.middleware).toEqual([]);
		});
	});

	// --- type inference

	describe('type inference', () => {
		it('widens C via single middleware', () => {
			const auth = middleware<{ user: string }>(async ({ next }) => next({ user: 'alice' }));

			command('test')
				.middleware(auth)
				.action(({ ctx }) => {
					// After middleware, ctx.user should be string (not never)
					const u: string = ctx.user;
					expect(u).toBe(u); // prevent unused
				});
		});

		it('widens C via multiple middleware (intersection)', () => {
			const auth = middleware<{ user: string }>(async ({ next }) => next({ user: 'alice' }));
			const trace = middleware<{ traceId: string }>(async ({ next }) => next({ traceId: '123' }));

			command('test')
				.middleware(auth)
				.middleware(trace)
				.action(({ ctx }) => {
					const u: string = ctx.user;
					const t: string = ctx.traceId;
					expect(u).toBe(u);
					expect(t).toBe(t);
				});
		});

		it('ctx without middleware is Record<string, never>', () => {
			command('test').action(({ ctx }) => {
				expectTypeOf(ctx).toEqualTypeOf<Readonly<Record<string, never>>>();
			});
		});

		it('composes with flags and args', () => {
			const auth = middleware<{ user: string }>(async ({ next }) => next({ user: 'alice' }));

			command('test')
				.flag('force', flag.boolean())
				.arg('target', arg.string())
				.middleware(auth)
				.action(({ args, flags, ctx }) => {
					const target: string = args.target;
					const force: boolean = flags.force;
					const user: string = ctx.user;
					expect(target).toBe(target);
					expect(force).toBe(force);
					expect(user).toBe(user);
				});
		});
	});
});

// --- Middleware execution via runCommand

describe('execution via runCommand', () => {
	describe('context flow', () => {
		it('adds context to the action handler', async () => {
			const auth = middleware(async ({ next }) => next({ user: 'alice' }));
			let receivedCtx: unknown;

			const cmd = command('test')
				.middleware(auth)
				.action(({ ctx }) => {
					receivedCtx = ctx;
				});

			const result = await runCommand(cmd, []);
			expect(result.exitCode).toBe(0);
			expect(receivedCtx).toEqual({ user: 'alice' });
		});

		it('accumulates context across middleware', async () => {
			const auth = middleware(async ({ next }) => next({ user: 'alice' }));
			const trace = middleware(async ({ next }) => next({ traceId: '123' }));
			let receivedCtx: unknown;

			const cmd = command('test')
				.middleware(auth)
				.middleware(trace)
				.action(({ ctx }) => {
					receivedCtx = ctx;
				});

			await runCommand(cmd, []);
			expect(receivedCtx).toEqual({ user: 'alice', traceId: '123' });
		});

		it('receives resolved flags and args', async () => {
			let receivedFlags: unknown;
			let receivedArgs: unknown;

			// biome-ignore lint/complexity/noBannedTypes: testing empty additions
			const spy = middleware<{}>(async ({ args, flags, next }) => {
				receivedFlags = flags;
				receivedArgs = args;
				await next({});
			});

			const cmd = command('test')
				.flag('force', flag.boolean())
				.arg('target', arg.string())
				.middleware(spy)
				.action(() => {});

			await runCommand(cmd, ['production', '--force']);
			expect(receivedFlags).toEqual({ force: true });
			expect(receivedArgs).toEqual({ target: 'production' });
		});

		it('passes upstream context downstream', async () => {
			const auth = middleware(async ({ next }) => next({ user: 'alice' }));
			let downstreamCtx: unknown;

			// biome-ignore lint/complexity/noBannedTypes: testing empty additions
			const logger = middleware<{}>(async ({ ctx, next }) => {
				downstreamCtx = ctx;
				await next({});
			});

			const cmd = command('test')
				.middleware(auth)
				.middleware(logger)
				.action(() => {});

			await runCommand(cmd, []);
			expect(downstreamCtx).toEqual({ user: 'alice' });
		});

		it('starts with empty ctx without middleware', async () => {
			let receivedCtx: unknown;

			const cmd = command('test').action(({ ctx }) => {
				receivedCtx = ctx;
			});

			const result = await runCommand(cmd, []);
			expect(result.exitCode).toBe(0);
			expect(receivedCtx).toEqual({});
		});

		it('works with env/config resolution', async () => {
			const auth = middleware(async ({ next }) => next({ user: 'alice' }));
			let receivedFlags: unknown;
			let receivedCtx: unknown;

			const cmd = command('test')
				.flag('region', flag.string().env('DEPLOY_REGION'))
				.middleware(auth)
				.action(({ flags, ctx }) => {
					receivedFlags = flags;
					receivedCtx = ctx;
				});

			const result = await runCommand(cmd, [], { env: { DEPLOY_REGION: 'eu' } });
			expect(result.exitCode).toBe(0);
			expect(receivedFlags).toEqual({ region: 'eu' });
			expect(receivedCtx).toEqual({ user: 'alice' });
		});
	});

	describe('control flow', () => {
		it('executes in registration order', async () => {
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

			await runCommand(cmd, []);
			expect(order).toEqual([
				'first-before',
				'second-before',
				'action',
				'second-after',
				'first-after',
			]);
		});

		it('short-circuits by throwing CLIError', async () => {
			const guard = middleware(async (_params) => {
				throw new CLIError('Forbidden', { code: 'FORBIDDEN', exitCode: 3 });
			});

			const handler = vi.fn();
			const cmd = command('test').middleware(guard).action(handler);

			const result = await runCommand(cmd, []);
			expect(result.exitCode).toBe(3);
			expect(result.error?.code).toBe('FORBIDDEN');
			expect(handler).not.toHaveBeenCalled();
		});

		it('short-circuits without next()', async () => {
			// biome-ignore lint/complexity/noBannedTypes: testing empty additions
			const gate = middleware<{}>(async ({ out }) => {
				out.log('stopped');
				// intentionally not calling next()
			});

			const handler = vi.fn();
			const cmd = command('test').middleware(gate).action(handler);

			const result = await runCommand(cmd, []);
			expect(result.exitCode).toBe(0);
			expect(handler).not.toHaveBeenCalled();
			expect(result.stdout.join('')).toContain('stopped');
		});

		it('wraps the action', async () => {
			// biome-ignore lint/complexity/noBannedTypes: testing empty additions
			const wrapper = middleware<{}>(async ({ out, next }) => {
				out.info('before');
				await next({});
				out.info('after');
			});

			const cmd = command('test')
				.middleware(wrapper)
				.action(({ out }) => {
					out.log('during');
				});

			const result = await runCommand(cmd, []);
			const output = result.stdout.join('');
			const beforeIdx = output.indexOf('before');
			const duringIdx = output.indexOf('during');
			const afterIdx = output.indexOf('after');
			expect(beforeIdx).toBeLessThan(duringIdx);
			expect(duringIdx).toBeLessThan(afterIdx);
		});
	});

	describe('output', () => {
		it('uses the output channel', async () => {
			// biome-ignore lint/complexity/noBannedTypes: testing empty additions
			const logger = middleware<{}>(async ({ out, next }) => {
				out.info('middleware running');
				await next({});
			});

			const cmd = command('test')
				.middleware(logger)
				.action(({ out }) => {
					out.log('action done');
				});

			const result = await runCommand(cmd, []);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('middleware running');
			expect(result.stdout.join('')).toContain('action done');
		});
	});
});
