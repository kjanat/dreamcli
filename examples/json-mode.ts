/**
 * JSON mode and structured output.
 *
 * Demonstrates: --json flag, out.json(), out.table(),
 * structured error output, CLIError with details.
 *
 * Usage:
 *   npx tsx examples/json-mode.ts list
 *   npx tsx examples/json-mode.ts list --json          # JSON array to stdout
 *   npx tsx examples/json-mode.ts list --format table  # table output
 *   npx tsx examples/json-mode.ts show web-api
 *   npx tsx examples/json-mode.ts show nonexistent     # structured error
 *   npx tsx examples/json-mode.ts show nonexistent --json  # JSON error
 */

import { arg, CLIError, cli, command, flag } from 'dreamcli';

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
		// out.json() emits structured data to stdout.
		// In --json mode, ONLY out.json() goes to stdout; log/info go to stderr.
		out.json(services);

		// out.table() renders a formatted table in TTY, or falls back to plain.
		if (flags.format === 'table') {
			out.table(services, [
				{ key: 'name', header: 'Service' },
				{ key: 'status', header: 'Status' },
				{ key: 'uptime', header: 'Uptime %' },
			]);
		} else {
			for (const s of services) {
				out.log(`${s.name}: ${s.status} (${s.uptime}%)`);
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
		out.log(`${service.name}: ${service.status} (uptime ${service.uptime}%)`);
	});

// --- CLI with --json support ---

cli('services')
	.version('1.0.0')
	.description('Service status dashboard')
	.command(list)
	.command(show)
	.run();
