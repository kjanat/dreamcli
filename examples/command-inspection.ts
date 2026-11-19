#!/usr/bin/env bun
/**
 * Preview a report before exporting it.
 *
 * An embedding host previews the resolved format and its source. Approval resumes
 * the same invocation and returns the report through DreamCLI's captured output.
 *
 * Demonstrates: inspecting with explicit environment inputs, handling errors
 * without printing framework diagnostics, and deferring an action.
 *
 * Usage:
 *   bun examples/command-inspection.ts export --format csv
 *   EXPORT_APPROVED=yes bun examples/command-inspection.ts export --format csv
 *   REPORT_FORMAT=tsv bun examples/command-inspection.ts export
 */

import { cli, command, flag, isMainModule } from '@kjanat/dreamcli';
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
		host.stderr(
			`Preview: ${result.flags.format} (from ${result.provenance.flags.format?.stage})\n`,
		);
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
