/**
 * Tests for `cli(name, { flags })` settings and negatable help rendering.
 *
 * @module dreamcli/core/cli/cli-flag-settings.test
 */

import { describe, expect, it } from 'vitest';
import { formatHelp } from '#internals/core/help/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/index.ts';
import { cli } from './index.ts';

function buildApp(options?: { flags?: { caseParity?: boolean } }) {
	let seen: boolean | undefined;
	const app = cli('mycli', options).command(
		command('build')
			.flag('dry-run', flag.boolean())
			.action(({ flags }) => {
				seen = flags['dry-run'];
			}),
	);
	return { app, seen: () => seen };
}

describe('cli(name, { flags })', () => {
	it('case parity is on by default through the full CLI pipeline', async () => {
		const { app, seen } = buildApp();
		const result = await app.execute(['build', '--dryRun']);
		expect(result.exitCode).toBe(0);
		expect(seen()).toBe(true);
	});

	it('caseParity: false accepts declared spellings only', async () => {
		const { app } = buildApp({ flags: { caseParity: false } });
		const result = await app.execute(['build', '--dryRun']);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.join('')).toContain('Unknown flag --dryRun');
	});

	it('runtime options.flags overrides the factory setting', async () => {
		const { app, seen } = buildApp({ flags: { caseParity: false } });
		const result = await app.execute(['build', '--dryRun'], { flags: { caseParity: true } });
		expect(result.exitCode).toBe(0);
		expect(seen()).toBe(true);
	});

	it('the planner sees the runtime override during dispatch arity scanning', async () => {
		// A parity spelling of a value flag whose value collides with a
		// subcommand name: the planner must skip 'status' as the flag's value
		// (needs the runtime parity setting), not dispatch to the subcommand.
		let seen: string | undefined;
		const app = cli('mycli', { flags: { caseParity: false } })
			.command(command('status').action(() => {}))
			.default(
				command('serve')
					.flag('log-level', flag.string())
					.action(({ flags }) => {
						seen = flags['log-level'];
					}),
			);
		const result = await app.execute(['--logLevel', 'status'], { flags: { caseParity: true } });
		expect(result.exitCode).toBe(0);
		expect(seen).toBe('status');
	});
});

describe('negatable help rendering', () => {
	it('renders --[no-]<name> for the synthesized negated spelling', () => {
		const schema = command('build')
			.flag('sandbox', flag.boolean().default(true).negatable().describe('Run sandboxed'))
			.action(() => {}).schema;
		expect(formatHelp(schema)).toContain('--[no-]sandbox');
	});

	it('lists a custom negated alias as its own form', () => {
		const schema = command('build')
			.flag('color', flag.boolean().negatable({ alias: 'plain' }).describe('Colorize'))
			.action(() => {}).schema;
		const help = formatHelp(schema);
		expect(help).toContain('--color, --plain');
		expect(help).not.toContain('--[no-]color');
	});

	it('hides a hidden negated spelling from help', () => {
		const schema = command('build')
			.flag('sandbox', flag.boolean().negatable({ hidden: true }).describe('Run sandboxed'))
			.action(() => {}).schema;
		const help = formatHelp(schema);
		expect(help).toContain('--sandbox');
		expect(help).not.toContain('no-sandbox');
		expect(help).not.toContain('--[no-]');
	});
});
