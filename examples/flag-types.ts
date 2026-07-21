#!/usr/bin/env bun
/**
 * The v3 flag-type family in one command.
 *
 * Demonstrates: `flag.url()`, `flag.path()` with directory creation,
 * `flag.date()`, `flag.duration()`, `flag.bytes()`, `flag.count()`,
 * `flag.keyValue()`, string constraints, and array `.separator()`/`.unique()`.
 *
 * Usage:
 *   npx tsx examples/flag-types.ts --endpoint https://api.example.com --name backup
 *   npx tsx examples/flag-types.ts --name backup --out ./artifacts --timeout 1h30m --max-size 512mb
 *   npx tsx examples/flag-types.ts --name backup --since 2026-01-01 --region us,eu --region us
 *   npx tsx examples/flag-types.ts --name backup --label env=prod --label team=core -vvv
 *   npx tsx examples/flag-types.ts --help
 */

import { cli, command, flag } from '@kjanat/dreamcli';

const snapshot = command('snapshot')
	.description('Create a snapshot with richly typed inputs')
	// URL — parses into a `URL`, protocol allowlist optional.
	.flag('endpoint', flag.url({ protocols: ['https'] }).describe('Upload endpoint'))
	// String constraints — checked at parse AND env/config/prompt resolution.
	.flag(
		'name',
		flag
			.string({ nonEmpty: true, pattern: /^[a-z][a-z0-9-]*$/ })
			.required()
			.describe('Snapshot name (lowercase, kebab)'),
	)
	// Path — missing directory is created (mkdir -p) at resolution time.
	.flag(
		'out',
		flag
			.path({ type: 'directory', create: true })
			.default('./snapshots')
			.describe('Output directory, created when missing'),
	)
	// Date — strict ISO-8601 into a `Date`; lenient Date.parse inputs rejected.
	.flag('since', flag.date().describe('Only include changes since this date'))
	// Duration — '90s', '1h30m', '250ms', or bare milliseconds → milliseconds.
	.flag('timeout', flag.duration().default(30_000).describe('Upload timeout'))
	// Bytes — '512mb', '1.5gb' (binary units) or bare bytes → bytes.
	.flag(
		'max-size',
		flag
			.bytes()
			.default(256 * 1024 ** 2)
			.describe('Maximum snapshot size'),
	)
	// Count — occurrence counter: -v -vv -vvv → 1, 2, 3.
	.flag('verbose', flag.count().alias('v').describe('Increase verbosity'))
	// KeyValue — repeated KEY=VALUE merges into Record<string, string>.
	.flag('label', flag.keyValue().describe('Attach metadata labels'))
	// Array — separator splits each occurrence, unique dedupes the result.
	.flag(
		'region',
		flag
			.array(flag.enum(['us', 'eu', 'ap']))
			.separator(',')
			.unique()
			.describe('Target regions'),
	)
	.action(({ flags, out }) => {
		out.status(`snapshot '${flags.name}' -> ${flags.out}`);
		out.json({
			name: flags.name,
			endpoint: flags.endpoint?.href,
			out: flags.out,
			since: flags.since?.toISOString(),
			timeoutMs: flags.timeout,
			maxSizeBytes: flags['max-size'],
			verbosity: flags.verbose,
			labels: flags.label,
			regions: flags.region,
		});
	});

void cli('snapshot').version('1.0.0').default(snapshot).run();
