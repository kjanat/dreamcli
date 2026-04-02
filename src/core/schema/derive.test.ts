import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { arg } from './arg.ts';
import { command } from './command.ts';
import { flag } from './flag.ts';
import { middleware } from './middleware.ts';

// --- Type inference

describe('CommandBuilder.derive() — type inference', () => {
	it('validation-only derive preserves ctx type', () => {
		command('deploy')
			.flag('token', flag.string())
			.derive(({ flags }) => {
				expectTypeOf(flags.token).toEqualTypeOf<string | undefined>();
				return undefined;
			})
			.action(({ ctx }) => {
				expectTypeOf(ctx).toEqualTypeOf<Readonly<Record<string, never>>>();
			});
	});

	it('context-returning derive widens ctx', () => {
		command('deploy')
			.flag('token', flag.string().required())
			.arg('target', arg.string())
			.derive(({ args, flags }) => {
				expectTypeOf(args.target).toBeString();
				expectTypeOf(flags.token).toBeString();
				return {
					authHeader: `Bearer ${flags.token}`,
					targetName: args.target,
				};
			})
			.action(({ ctx }) => {
				expectTypeOf(ctx.authHeader).toBeString();
				expectTypeOf(ctx.targetName).toBeString();
			});
	});

	it('derive sees upstream middleware ctx and action sees both', () => {
		const auth = middleware<{ user: string }>(async ({ next }) => next({ user: 'alice' }));

		command('deploy')
			.flag('token', flag.string().required())
			.middleware(auth)
			.derive(({ ctx, flags }) => {
				expectTypeOf(ctx.user).toBeString();
				expectTypeOf(flags.token).toBeString();
				return { token: flags.token };
			})
			.action(({ ctx }) => {
				expectTypeOf(ctx.user).toBeString();
				expectTypeOf(ctx.token).toBeString();
			});
	});
});

// --- Runtime behavior

describe('CommandBuilder.derive() — runtime', () => {
	it('does not add handlers to schema.middleware', () => {
		const cmd = command('deploy').derive(() => ({ token: 'abc' }));
		expect(cmd.schema.middleware).toEqual([]);
	});

	it('drops handler when derive added', () => {
		const handler = vi.fn();
		const original = command('deploy').action(handler);
		const derived = original.derive(() => ({ token: 'abc' }));

		expect(original.handler).toBe(handler);
		expect(derived.handler).toBeUndefined();
		expect(derived.schema.hasAction).toBe(false);
	});

	it('passes derived context to the action handler', async () => {
		let receivedCtx: unknown;

		const cmd = command('deploy')
			.flag('token', flag.string().required())
			.derive(({ flags }) => ({ token: flags.token }))
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const result = await runCommand(cmd, ['--token', 'ghp_test']);
		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({ token: 'ghp_test' });
	});

	it('supports async derive handlers', async () => {
		let receivedCtx: unknown;

		const cmd = command('deploy')
			.flag('token', flag.string().required())
			.derive(async ({ flags }) => {
				await Promise.resolve();
				return { token: flags.token, traceId: 'trace-123' };
			})
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const result = await runCommand(cmd, ['--token', 'ghp_test']);
		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({ token: 'ghp_test', traceId: 'trace-123' });
	});

	it('supports validation-only derive handlers', async () => {
		let receivedCtx: unknown;

		const cmd = command('deploy')
			.flag('token', flag.string().required())
			.derive(({ flags }) => {
				if (!flags.token.startsWith('ghp_')) {
					throw new CLIError('Invalid token format', {
						code: 'INVALID_VALUE',
						exitCode: 2,
					});
				}
				return undefined;
			})
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const result = await runCommand(cmd, ['--token', 'ghp_valid']);
		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({});
	});

	it('receives fully resolved args and flags', async () => {
		let received: unknown;

		const cmd = command('deploy')
			.flag('region', flag.string().env('DEPLOY_REGION'))
			.arg('target', arg.string())
			.derive(({ args, flags }) => {
				received = { args, flags };
				return { ready: true };
			})
			.action(() => {});

		const result = await runCommand(cmd, ['production'], {
			env: { DEPLOY_REGION: 'eu' },
		});

		expect(result.exitCode).toBe(0);
		expect(received).toEqual({
			args: { target: 'production' },
			flags: { region: 'eu' },
		});
	});

	it('can short-circuit by throwing CLIError', async () => {
		const handler = vi.fn();
		const cmd = command('deploy')
			.flag('token', flag.string())
			.derive(({ flags }) => {
				if (flags.token === undefined) {
					throw new CLIError('Authentication required', {
						code: 'AUTH_REQUIRED',
						exitCode: 2,
					});
				}
				return { token: flags.token };
			})
			.action(handler);

		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('AUTH_REQUIRED');
		expect(handler).not.toHaveBeenCalled();
	});

	it('preserves registration order with middleware', async () => {
		const order: string[] = [];

		// biome-ignore lint/complexity/noBannedTypes: testing wrapper middleware without ctx additions
		const wrapper = middleware<{}>(async ({ next }) => {
			order.push('middleware-before');
			await next({});
			order.push('middleware-after');
		});

		const cmd = command('deploy')
			.middleware(wrapper)
			.derive(() => {
				order.push('derive');
				return { ready: true };
			})
			.action(() => {
				order.push('action');
			});

		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(order).toEqual(['middleware-before', 'derive', 'action', 'middleware-after']);
	});

	it('lets derive consume upstream middleware ctx', async () => {
		let receivedCtx: unknown;
		const auth = middleware<{ user: string }>(async ({ next }) => next({ user: 'alice' }));

		const cmd = command('deploy')
			.middleware(auth)
			.derive(({ ctx }) => {
				expect(ctx).toEqual({ user: 'alice' });
				return { traceId: 'trace-123' };
			})
			.action(({ ctx }) => {
				receivedCtx = ctx;
			});

		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(receivedCtx).toEqual({ user: 'alice', traceId: 'trace-123' });
	});
});
