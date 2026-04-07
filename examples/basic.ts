#!/usr/bin/env bun
/**
 * Basic single-command CLI.
 *
 * Demonstrates: typed positional args, typed flags, aliases, and default values.
 *
 * Usage:
 *   npx tsx examples/basic.ts Alice
 *   npx tsx examples/basic.ts Alice --loud --times 3
 *   npx tsx examples/basic.ts Alice -l -t 3
 *   npx tsx examples/basic.ts --help
 */

import { arg, cli, command, flag } from '@kjanat/dreamcli';

const greet = command('greet')
	.description('Greet someone')
	.example('greet Alice', 'Greet Alice once')
	.example('greet Alice --loud --times 3', 'Shout the greeting three times')
	.arg('name', arg.string().describe('Who to greet'))
	.flag('loud', flag.boolean().alias('l').describe('Shout the greeting'))
	.flag('times', flag.number().default(1).alias('t').describe('Repeat count'))
	.action(({ args, flags, out }) => {
		// args.name: string — required positional
		// flags.loud: boolean — defaults to false (all booleans do)
		// flags.times: number — defaults to 1 (never undefined)
		for (let i = 0; i < flags.times; i++) {
			const msg = `Hello, ${args.name}!`;
			out.log(flags.loud ? msg.toUpperCase() : msg);
		}
	});

void cli('greet').default(greet).run();
