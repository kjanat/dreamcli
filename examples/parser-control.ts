#!/usr/bin/env bun
/**
 * Parser-level controls: negation, duplicate policy, and spelling parity.
 *
 * Demonstrates: `flag.boolean().negatable()` for `--no-<name>`,
 * `.duplicates('error' | 'first' | 'last')` on singleton flags, and the
 * built-in kebab ↔ camel spelling parity.
 *
 * Usage:
 *   npx tsx examples/parser-control.ts --sandbox            # true
 *   npx tsx examples/parser-control.ts --no-sandbox         # false, same logical flag
 *   npx tsx examples/parser-control.ts --sandbox --no-sandbox   # last occurrence wins
 *   npx tsx examples/parser-control.ts --mode fast --mode safe  # error: duplicate
 *   npx tsx examples/parser-control.ts --dryRun              # camel spelling of --dry-run
 *   npx tsx examples/parser-control.ts --help                # shows --[no-]sandbox
 */

import { cli, command, flag } from '@kjanat/dreamcli';

const run = command('run')
	.description('Run a task with strict parser semantics')
	// Negatable — `--sandbox` and `--no-sandbox` are two spellings of ONE
	// logical flag; help renders `--[no-]sandbox`.
	.flag('sandbox', flag.boolean().default(true).negatable().describe('Isolate the task'))
	// Duplicates — config knobs should reject repeats instead of silently
	// keeping the last value.
	.flag(
		'mode',
		flag.enum(['fast', 'safe']).default('safe').duplicates('error').describe('Execution mode'),
	)
	// Spelling parity is on by default: `--dryRun` matches this kebab name
	// (and a camel-named flag would match its kebab spelling). Handler keys,
	// help, and completions stay canonical.
	.flag('dry-run', flag.boolean().describe('Print the plan without executing'))
	.action(({ flags, out }) => {
		out.log(`mode=${flags.mode} sandbox=${flags.sandbox} dryRun=${flags['dry-run']}`);
	});

// Opt out of parity per CLI with: cli('tasks', { flags: { caseParity: false } })
void cli('tasks').version('1.0.0').default(run).run();
