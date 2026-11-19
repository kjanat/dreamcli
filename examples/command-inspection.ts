#!/usr/bin/env bun
/**
 * Preview a report before exporting it.
 *
 * The host pauses for two seconds after inspecting the format and its source. Approval resumes
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
		const approved = host.env.EXPORT_APPROVED === 'yes';
		const previewSeconds = 2;
		const output = createOutput({ stdout: host.stdout, stderr: host.stderr, isTTY: host.isTTY });
		const source = result.provenance.flags.format;
		const selectedBy =
			source?.stage === 'env'
				? 'REPORT_FORMAT'
				: source?.stage === 'cli'
					? '--format'
					: 'the default';
		const format = result.flags.format === 'tsv' ? 'tab-separated' : 'comma-separated';
		host.stderr(
			`Inspection complete. The export would write a ${format} report (selected by ${selectedBy}).\n`,
		);

		const countdown = (seconds: number) =>
			`Previewing for ${seconds}s before the approval decision...`;
		const preview = output.spinner(countdown(previewSeconds), { fallback: 'static' });
		for (let remaining = previewSeconds; remaining > 0; remaining--) {
			if (remaining < previewSeconds) preview.update(countdown(remaining));
			await new Promise<void>((resolve) => setTimeout(resolve, 1000));
		}
		if (approved) {
			preview.succeed('Approved. Resuming the inspected command and writing the report to stdout.');
			const run = await result.execute();
			run.stdout.forEach(host.stdout);
			run.stderr.forEach(host.stderr);
			exitCode = run.exitCode;
		} else {
			preview.succeed(
				'Preview complete. Export skipped. Run again with EXPORT_APPROVED=yes to write the report.',
			);
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
