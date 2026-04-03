#!/usr/bin/env bun
/**
 * Spinner and progress bar usage.
 *
 * Demonstrates: out.spinner(), out.progress(), auto-disable in
 * non-TTY / --json mode, spinner.wrap() convenience.
 *
 * Usage:
 *   npx tsx examples/spinner-progress.ts
 *   npx tsx examples/spinner-progress.ts --json     # spinners suppressed, JSON output
 *   echo | npx tsx examples/spinner-progress.ts     # non-TTY: spinners silent
 */

import { cli, command, flag } from '@kjanat/dreamcli';

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const build = command('build')
	.description('Build the project (demonstrates spinners and progress)')
	.flag('steps', flag.number().default(5).describe('Number of build steps'))
	.action(async ({ flags, out }) => {
		// --- Spinner: indeterminate work ---
		const spinner = out.spinner('Preparing build environment...');
		await sleep(1000);
		spinner.update('Installing dependencies...');
		await sleep(800);
		spinner.succeed('Environment ready');

		// --- Spinner with wrap(): auto-succeed/fail ---
		const lint = out.spinner('Linting...');
		await lint.wrap(sleep(600), {
			succeed: 'Lint passed',
			fail: 'Lint failed',
		});

		// --- Progress bar: determinate work ---
		const progress = out.progress({ total: flags.steps, label: 'Compiling' });
		for (let i = 0; i < flags.steps; i++) {
			await sleep(300);
			progress.increment();
		}
		progress.done('Build complete');

		out.log(`Built ${flags.steps} modules`);
	});

void cli('build').default(build).run();
