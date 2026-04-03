#!/usr/bin/env bun
/**
 * Middleware patterns: auth guard, request timing, error handling.
 *
 * Demonstrates: middleware() with typed context, context accumulation,
 * short-circuit on error, wrap-around timing.
 *
 * Usage:
 *   npx tsx examples/middleware.ts deploy production
 *   npx tsx examples/middleware.ts deploy production --verbose
 */

import { arg, CLIError, cli, command, flag, middleware } from '@kjanat/dreamcli';

// --- Auth middleware — adds `user` to context ---

interface User {
	readonly id: string;
	readonly name: string;
	readonly role: 'admin' | 'user';
}

async function getAuthenticatedUser(): Promise<User | null> {
	// In real code, read a token from env/config/keychain and return null when missing.
	return { id: 'u-1', name: 'Alice', role: 'admin' };
}

const auth = middleware<{ user: User }>(async ({ next }) => {
	const user = await getAuthenticatedUser();

	if (!user) {
		// Short-circuits the chain — action never runs.
		throw new CLIError('Not authenticated', {
			code: 'AUTH_REQUIRED',
			suggest: 'Run `myapp login` first',
			exitCode: 2,
		});
	}

	return next({ user });
});

// --- Timing middleware — wraps the downstream chain ---

const timing = middleware<{ startTime: number }>(async ({ out, next }) => {
	const start = performance.now();
	await next({ startTime: start });

	// Code after `next()` runs after the action completes (onion model).
	const elapsed = (performance.now() - start).toFixed(0);
	out.info(`Completed in ${elapsed}ms`);
});

// --- Command using both middlewares ---

const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string().describe('Deploy target'))
	.flag('verbose', flag.boolean().alias('v').describe('Verbose output'))
	.middleware(auth)
	.middleware(timing)
	.action(({ args, flags, ctx, out }) => {
		// ctx.user and ctx.startTime are typed via middleware chain.
		out.log(`[${ctx.user.role}] ${ctx.user.name} deploying ${args.target}`);
		if (flags.verbose) {
			out.info(`User ID: ${ctx.user.id}`);
			out.info(`Started at: ${ctx.startTime.toFixed(0)}ms`);
		}
	});

void cli('myapp').default(deploy).run();
