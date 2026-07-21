#!/usr/bin/env bun
/**
 * Help rendering configuration.
 *
 * Demonstrates: `.help()` theming, `flagOrder: 'declaration'`, a routable
 * default command (`.default(cmd, { route: true })`), and footer control.
 *
 * Usage:
 *   npx tsx examples/help-config.ts --help          # themed, declaration-ordered
 *   npx tsx examples/help-config.ts build --help    # default command by name
 *   npx tsx examples/help-config.ts --help --json   # definition document instead of text
 */

import { arg, cli, command, flag } from '@kjanat/dreamcli';

const build = command('build')
	.description('Build the project')
	.example(({ name }) => `${name} build src/ --minify`, 'Minified build')
	.arg('entry', arg.string().default('src/').describe('Entry directory'))
	// Declaration order is preserved in help via `flagOrder` below, so put
	// the flags users reach for first at the top.
	.flag('minify', flag.boolean().describe('Minify output'))
	.flag('sourcemap', flag.boolean().describe('Emit sourcemaps'))
	.flag('watch', flag.boolean().alias('w').describe('Rebuild on change'))
	.action(({ args, flags, out }) => {
		out.log(`building ${args.entry} minify=${flags.minify} watch=${flags.watch}`);
	});

void cli('builder')
	.version('1.0.0')
	.description('A build tool with configured help')
	.help({
		// 'declaration' keeps .flag() call order; default is 'alphabetical'.
		flagOrder: 'declaration',
		// Theme factory receives the gated palette — never invoked when color
		// is off, so custom themes cannot leak escapes into piped output.
		theme: (c) => ({ sectionTitle: c.magenta }),
		footer: false,
	})
	// route: true lists the default under Commands (tagged `(default)`) and
	// makes `builder build …` route by name alongside the bare `builder …`.
	.default(build, { route: true })
	.run();
