#!/usr/bin/env bun
/**
 * Mixed machine-readable JSON and human-readable side-channel output.
 *
 * Demonstrates: always-on `out.json()` machine output to stdout,
 * human-readable stderr side channels via `out.table(..., { format: 'text',
 * stream: 'stderr' })` / `out.error()`, plus `--json` for CLI-managed JSON
 * behavior such as structured errors.
 *
 * Usage:
 *   npx tsx examples/json-mode.ts list                  # JSON stdout + plain stderr side channel
 *   npx tsx examples/json-mode.ts list --format table   # JSON stdout + table stderr side channel
 *   npx tsx examples/json-mode.ts list --json           # same success output; CLI-managed errors stay JSON-safe
 *   npx tsx examples/json-mode.ts show web-api
 *   npx tsx examples/json-mode.ts show nonexistent     # structured error
 *   npx tsx examples/json-mode.ts show nonexistent --json  # JSON error
 */

import { arg, CLIError, cli, command, flag } from '@kjanat/dreamcli';

// --- Sample data ---

type Service = {
	readonly name: string;
	readonly status: 'healthy' | 'degraded' | 'down';
	readonly uptime: number;
};

const services: readonly Service[] = [
	{ name: 'web-api', status: 'healthy', uptime: 99.9 },
	{ name: 'worker', status: 'degraded', uptime: 95.2 },
	{ name: 'database', status: 'healthy', uptime: 99.99 },
	{ name: 'cache', status: 'down', uptime: 0 },
];

// --- Commands ---

const list = command('list')
	.description('List all services')
	.flag(
		'format',
		flag.enum(['table', 'plain']).default('plain').alias('f').describe('Output format'),
	)
	.action(({ flags, out }) => {
		// This example always emits machine-readable JSON to stdout. `--json`
		// still matters for DreamCLI-managed output such as structured errors.
		out.json(services);

		if (flags.format === 'table') {
			out.table(
				services,
				[
					{ key: 'name', header: 'Service' },
					{ key: 'status', header: 'Status' },
					{ key: 'uptime', header: 'Uptime %' },
				],
				{ format: 'text', stream: 'stderr' },
			);
		} else {
			for (const s of services) {
				out.error(`${s.name}: ${s.status} (${s.uptime}%)`);
			}
		}
	});

const show = command('show')
	.description('Show details for a service')
	.arg('name', arg.string().describe('Service name'))
	.action(({ args, out }) => {
		const service = services.find((s) => s.name === args.name);

		if (!service) {
			// CLIError with details serializes cleanly in --json mode.
			throw new CLIError(`Service '${args.name}' not found`, {
				code: 'NOT_FOUND',
				exitCode: 1,
				suggest: `Available: ${services.map((s) => s.name).join(', ')}`,
				details: { requested: args.name, available: services.map((s) => s.name) },
			});
		}

		out.json(service);
		out.error(`${service.name}: ${service.status} (uptime ${service.uptime}%)`);
	});

// --- CLI with --json support ---

void cli('services')
	.version('1.0.0')
	.description('Service status dashboard')
	.command(list)
	.command(show)
	.run();
