#!/usr/bin/env bun
/**
 * __CLI_NAME__ - hello-world DreamCLI starter.
 *
 * Bun:
 *   bun __CLI_NAME__.ts
 *   bun __CLI_NAME__.ts Twilight --sparkle --times 2
 *   bun __CLI_NAME__.ts --help
 *
 * npm/tsx:
 *   npx tsx __CLI_NAME__.ts Twilight --sparkle --times 2
 *
 * Deno:
 *   deno run -A __CLI_NAME__.ts Twilight --sparkle --times 2
 */

import { arg, cli, command, flag, middleware } from '@kjanat/dreamcli';

const sparkle = middleware<{ sparkle: (message: string) => string }>(async ({ flags, next }) => {
	const sparkleEnabled = flags.sparkle === true;
	return next({
		sparkle: (message: string) => (sparkleEnabled ? `✨ ${message} ✨` : message),
	});
});

export const hello = command('hello')
	.description('Say hello with optional sparkle')
	.example(({ name }) => `${name} Twilight --sparkle --times 2`, 'Sparkly double greeting')
	.arg('name', arg.string().default('World').describe('Who to greet'))
	.flag('sparkle', flag.boolean().alias('s').env('SPARKLE').describe('Add sparkles'))
	// Constraints are enforced at every source, so the action needs no clamping.
	.flag('times', flag.number({ int: true, min: 0, max: 100 }).default(1).alias('n').describe('Repeat count'))
	.middleware(sparkle)
	.action(({ args, flags, ctx, out }) => {
		for (let i = 0; i < flags.times; i++) {
			out.log(ctx.sparkle(`Hello, ${args.name}!`));
		}

		// stderr, and silenced by --quiet: keeps stdout pipe-clean.
		out.status(`Greeted ${args.name} ${flags.times} time(s)`);
	});

export const app = cli('__CLI_NAME__').default(hello);

if (import.meta.main) {
	app.run();
}
