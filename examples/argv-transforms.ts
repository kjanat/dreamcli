#!/usr/bin/env bun
/**
 * Migrate a legacy stdin switch.
 *
 * The notes CLI accepts a literal body or reads it from a pipe with `--body -`.
 * Existing scripts can still use `--from-stdin` and get a migration hint.
 *
 * Demonstrates: rewriting a switch into a flag and value, preserving literal
 * arguments after `--`, and passing a warning to the action through parse metadata.
 *
 * Usage:
 *   printf 'Released\n' | bun examples/argv-transforms.ts add changelog --from-stdin
 *   printf 'Released\n' | bun examples/argv-transforms.ts add changelog --body -
 *   bun examples/argv-transforms.ts add --body 'Literal title' -- --from-stdin
 */

import { arg, cli, command, flag, isMainModule, plugin } from '@kjanat/dreamcli';

const legacyStdin = plugin({
	transformArgv: ({ command, argv }) => {
		if (command.name !== 'add') return;
		const end = argv.indexOf('--');
		const options = end === -1 ? argv : argv.slice(0, end);
		if (!options.includes('--from-stdin')) return;
		return {
			argv: [
				...options.flatMap((token) => (token === '--from-stdin' ? ['--body', '-'] : [token])),
				...argv.slice(options.length),
			],
			metadata: { usedFromStdin: true },
		};
	},
});

const add = command('add')
	.description('Print a note from the command line or stdin')
	.arg('title', arg.string().required())
	.flag('body', flag.string().stdin({ when: 'dash', trim: true }).duplicates('error').required())
	.action(({ args, flags, parse, out }) => {
		if (parse.metadata.usedFromStdin === true) out.warn('Use --body - in place of --from-stdin.');
		out.log(`${args.title}: ${flags.body}`);
	});

export const notes = cli('notes').plugin(legacyStdin).command(add);
if (isMainModule(import.meta)) void notes.run();
