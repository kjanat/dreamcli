/**
 * Tests for `cli(name, { flags })` settings and negatable help rendering.
 *
 * @module dreamcli/core/cli/cli-flag-settings.test
 */

import { describe, expect, it } from 'vitest';
import { formatHelp } from '#internals/core/help/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
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

describe('kebab flag spelling in help', () => {
	function spellingApp(options?: { flags?: { caseParity?: boolean } }) {
		return cli('demo', options)
			.help({ flagSpelling: 'kebab' })
			.command(
				command('build')
					.flag('wasmPath', flag.string().describe('Plugin path'))
					.flag('dryRun', flag.boolean().negatable())
					.action(() => {}),
			);
	}

	it('renders command help in kebab-case while handlers keep camelCase keys', async () => {
		let seen: unknown;
		const app = cli('demo')
			.help({ flagSpelling: 'kebab' })
			.command(
				command('build')
					.flag('wasmPath', flag.string())
					.flag('dryRun', flag.boolean().negatable())
					.action(({ flags }) => {
						seen = flags;
					}),
			);
		const help = (await app.execute(['build', '--help'])).stdout.join('');
		expect(help).toContain('--wasm-path <string>');
		expect(help).toContain('--[no-]dry-run');
		expect(help).not.toContain('wasmPath');

		const result = await app.execute(['build', '--wasm-path', 'a.wasm', '--no-dry-run']);
		expect(result.exitCode).toBe(0);
		expect(seen).toEqual({ wasmPath: 'a.wasm', dryRun: false });
	});

	it('keeps declared spellings when the CLI disables case parity', async () => {
		const help = (
			await spellingApp({ flags: { caseParity: false } }).execute(['build', '--help'])
		).stdout.join('');
		expect(help).toContain('--wasmPath <string>');
		expect(help).toContain('--[no-]dryRun');
	});

	it('follows a runtime caseParity override', async () => {
		const help = (
			await spellingApp().execute(['build', '--help'], { flags: { caseParity: false } })
		).stdout.join('');
		expect(help).toContain('--wasmPath <string>');
	});

	it('applies to a default command inlined in root help', async () => {
		const app = cli('demo')
			.help({ flagSpelling: 'kebab' })
			.default(
				command('serve')
					.flag('logLevel', flag.string())
					.action(() => {}),
			);
		const help = (await app.execute(['--help'])).stdout.join('');
		expect(help).toContain('--log-level <string>');
	});

	it('is accepted as a runtime help option', async () => {
		const app = cli('demo').command(
			command('build')
				.flag('wasmPath', flag.string())
				.action(() => {}),
		);
		const declared = (await app.execute(['build', '--help'])).stdout.join('');
		expect(declared).toContain('--wasmPath <string>');
		const kebab = (
			await app.execute(['build', '--help'], { help: { flagSpelling: 'kebab' } })
		).stdout.join('');
		expect(kebab).toContain('--wasm-path <string>');
	});

	it('follows the run-level parser settings in standalone runCommand help', async () => {
		const build = command('build')
			.flag('wasmPath', flag.string())
			.action(() => {});
		const kebab = await runCommand(build, ['--help'], { help: { flagSpelling: 'kebab' } });
		expect(kebab.stdout.join('')).toContain('--wasm-path <string>');
		const strict = await runCommand(build, ['--help'], {
			help: { flagSpelling: 'kebab' },
			flags: { caseParity: false },
		});
		expect(strict.stdout.join('')).toContain('--wasmPath <string>');
	});
});
