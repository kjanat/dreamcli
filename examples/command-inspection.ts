#!/usr/bin/env bun
/**
 * Preview a report before exporting it.
 *
 * Watch DreamCLI match the command and resolve the report format from argv, the environment,
 * or the schema default.
 *
 * Demonstrates: inspecting with explicit environment inputs, handling errors
 * without printing framework diagnostics, and deferring an action.
 *
 * Usage:
 *   bun examples/command-inspection.ts export --format csv
 *   EXPORT_APPROVED=yes bun examples/command-inspection.ts export --format csv
 *   REPORT_FORMAT=tsv bun examples/command-inspection.ts export
 */

import { isatty } from 'node:tty';
import { cli, command, createOutput, flag, isMainModule } from '@kjanat/dreamcli';
import { createAdapter } from '@kjanat/dreamcli/runtime';

export const reports = cli('reports').command(
	command('export')
		.flag('format', flag.enum(['csv', 'tsv']).env('REPORT_FORMAT').default('csv'))
		.action(({ flags, out }) => {
			const separator = flags.format === 'csv' ? ',' : '\t';
			out.log(['package', 'version'].join(separator));
			out.log(['demo', '1.0.0'].join(separator));
		}),
);

if (isMainModule(import.meta)) {
	const host = createAdapter();
	const argv = host.argv.slice(2);
	const result = await reports.inspect(argv, { env: host.env });
	let exitCode = 0;
	if (result.kind === 'match') {
		const isTTY = isatty(2); // The trace goes to stderr, even when stdout is redirected to a file.
		const output = createOutput({ stdout: host.stdout, stderr: host.stderr, isTTY });
		const { cyan, green } = output.color;
		const preview = output.spinner(
			`${cyan('inspect()')} matched ${green(result.path.join(' '))}.`,
			{
				fallback: 'static',
			},
		);
		// Leave each line on screen long enough to read. Redirected output gets a plain transcript.
		const hold = () =>
			isTTY ? new Promise<void>((resolve) => setTimeout(resolve, 5_000)) : Promise.resolve();
		const source = result.provenance.flags.format;
		const occurrences = result.parse.flag('format').occurrences;
		const origin =
			source?.stage === 'env' && 'envVar' in source
				? `Read ${cyan(source.envVar)} from the environment.`
				: source?.stage === 'cli'
					? `Matched ${occurrences.map((item) => cyan(item.spelling)).join(', ')} in argv.`
					: `Used the ${cyan('schema default')} for format.`;
		await hold();
		if (isTTY) preview.update(origin);
		else host.stderr(`${origin}\n`);
		await hold();
		preview.succeed(`Resolved format = ${green(JSON.stringify(result.flags.format))}.`);
		if (host.env.EXPORT_APPROVED === 'yes') {
			const run = await result.execute();
			run.stdout.forEach(host.stdout);
			run.stderr.forEach(host.stderr);
			exitCode = run.exitCode;
		}
	} else if (result.kind === 'dispatch-error' || result.kind === 'command-error') {
		host.stderr(`${result.error.code}: ${result.error.message}\n`);
		exitCode = result.error.exitCode;
	} else {
		// Let DreamCLI format built-in requests for this terminal host.
		await reports.run({ adapter: host });
	}
	await host.flush?.();
	host.exit(exitCode);
}
