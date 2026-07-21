#!/usr/bin/env bun
/**
 * Output channel extras: colors, hyperlinks, and exit codes without throwing.
 *
 * Demonstrates: the gated `out.color` palette, OSC 8 hyperlinks behind
 * `out.isHyperlinkSupported`, and `out.setExitCode()` for "report and
 * continue" failures.
 *
 * Usage:
 *   npx tsx examples/output-extras.ts
 *   npx tsx examples/output-extras.ts | cat     # colors and links gate off
 *   NO_COLOR=1 npx tsx examples/output-extras.ts
 *   npx tsx examples/output-extras.ts; echo "exit: $?"
 */

import { cli, command, osc8 } from '@kjanat/dreamcli';

const targets = [
	{ name: 'web-api', ok: true, docs: 'https://example.com/web-api' },
	{ name: 'worker', ok: false, docs: 'https://example.com/worker' },
	{ name: 'cache', ok: true, docs: 'https://example.com/cache' },
];

const check = command('check')
	.description('Health-check all targets')
	.action(({ out }) => {
		for (const target of targets) {
			// Every formatter is an identity function when color is off
			// (piped, NO_COLOR, --json), so this is safe unconditionally.
			const mark = target.ok ? out.color.green('✔') : out.color.red('✖');
			// OSC 8 links garble piped output — gate on the resolved support
			// flag (honors NO_HYPERLINKS/FORCE_HYPERLINKS and --no-hyperlinks).
			const label = out.isHyperlinkSupported ? osc8(target.docs, target.name) : target.name;
			out.log(`${mark} ${label}`);
		}

		const failed = targets.filter((t) => !t.ok);
		if (failed.length > 0) {
			// Report everything, exit non-zero — without throwing away the
			// successful output the way a thrown CLIError would.
			out.setExitCode(1);
			out.status(`${failed.length} of ${targets.length} targets unhealthy`);
		}
	});

void cli('healthcheck').version('1.0.0').default(check).run();
