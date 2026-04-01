/**
 * Tests for nested subcommand dispatch through CLIBuilder.execute().
 *
 * Integration tests: exercises the full path from CLI entry → recursive
 * dispatch → propagated flag merging → command execution.
 */

import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command, group } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli } from './index.ts';

// ===================================================================
// Helpers
// ===================================================================

function migrateCommand() {
	return command('migrate')
		.description('Run database migrations')
		.flag('steps', flag.number().describe('Number of steps'))
		.action(({ flags, out }) => {
			out.log(`migrating ${flags.steps ?? 'all'} steps`);
		});
}

function seedCommand() {
	return command('seed')
		.description('Seed database')
		.action(({ out }) => {
			out.log('seeding');
		});
}

function dbGroup() {
	return group('db')
		.description('Database operations')
		.command(migrateCommand())
		.command(seedCommand());
}

function hasPropagatedVerbose(flags: { readonly verbose?: boolean }): boolean {
	return flags.verbose === true;
}

// ===================================================================
// Nested dispatch — basic
// ===================================================================

describe('CLIBuilder — nested dispatch', () => {
	it('dispatches to nested subcommand', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'migrate']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['migrating all steps\n']);
	});

	it('dispatches to nested subcommand with flags', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'migrate', '--steps', '3']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['migrating 3 steps\n']);
	});

	it('dispatches to different subcommand in same group', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'seed']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['seeding\n']);
	});

	it('shows help for group when no subcommand given', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('migrate');
		expect(output).toContain('seed');
	});

	it('errors on unknown subcommand', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'nope']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown command: nope');
	});
});

// ===================================================================
// Nested dispatch — 3 levels deep
// ===================================================================

describe('CLIBuilder — 3-level nesting', () => {
	it('dispatches through 3 levels', async () => {
		const up = command('up')
			.description('Run migrations up')
			.action(({ out }) => {
				out.log('migrating up');
			});

		const migrate = group('migrate').description('Migration commands').command(up);

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', 'up']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['migrating up\n']);
	});
});

// ===================================================================
// Nested dispatch — hybrid groups (group with own action + subcommands)
// ===================================================================

describe('CLIBuilder — hybrid group with action + subcommands', () => {
	it('runs group action when no subcommand given', async () => {
		const add = command('add')
			.arg('name', arg.string())
			.action(({ args, out }) => {
				out.log(`adding ${args.name}`);
			});

		const remote = command('remote')
			.description('Manage remotes')
			.command(add)
			.action(({ out }) => {
				out.log('listing remotes');
			});

		const app = cli('myapp').command(remote);
		const result = await app.execute(['remote']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['listing remotes\n']);
	});

	it('dispatches to subcommand when given', async () => {
		const add = command('add')
			.arg('name', arg.string())
			.action(({ args, out }) => {
				out.log(`adding ${args.name}`);
			});

		const remote = command('remote')
			.description('Manage remotes')
			.command(add)
			.action(({ out }) => {
				out.log('listing remotes');
			});

		const app = cli('myapp').command(remote);
		const result = await app.execute(['remote', 'add', 'origin']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['adding origin\n']);
	});
});

// ===================================================================
// Nested dispatch — propagated flags
// ===================================================================

describe('CLIBuilder — propagated flags through nesting', () => {
	it('propagates parent flag to nested subcommand', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.action(({ flags, out }) => {
				out.log(`verbose=${String(hasPropagatedVerbose(flags))}`);
			});

		const db = group('db')
			.description('Database operations')
			.flag('verbose', flag.boolean().propagate())
			.command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', '--verbose']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['verbose=true\n']);
	});

	it('propagates flag from root ancestor through intermediary', async () => {
		const up = command('up')
			.description('Run migrations up')
			.action(({ flags, out }) => {
				out.log(`verbose=${String(hasPropagatedVerbose(flags))}`);
			});

		const migrate = group('migrate').description('Migration commands').command(up);

		const db = group('db')
			.description('Database operations')
			.flag('verbose', flag.boolean().propagate())
			.command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', 'up', '--verbose']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['verbose=true\n']);
	});

	it('child flag shadows propagated parent flag', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.flag('verbose', flag.boolean().describe('Migrate-specific verbose'))
			.action(({ flags, out }) => {
				out.log(`verbose=${String(flags.verbose)}`);
			});

		const db = group('db')
			.description('Database operations')
			.flag('verbose', flag.boolean().propagate())
			.command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', '--verbose']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['verbose=true\n']);
	});

	it('propagated flag not visible when ancestor not in path', async () => {
		// 'db' has --verbose propagated, but 'deploy' is a sibling command.
		// deploy should NOT see --verbose.
		const deploy = command('deploy')
			.description('Deploy')
			.action(({ out }) => {
				out.log('deployed');
			});

		const db = group('db')
			.description('Database')
			.flag('verbose', flag.boolean().propagate())
			.command(
				command('migrate').action(({ out }) => {
					out.log('migrated');
				}),
			);

		const app = cli('myapp').command(db).command(deploy);
		// --verbose should be unknown to deploy (causes a parse error)
		const result = await app.execute(['deploy', '--verbose']);
		expect(result.exitCode).not.toBe(0);
	});
});

// ===================================================================
// Nested dispatch — --help
// ===================================================================

describe('CLIBuilder — nested help', () => {
	it('shows command help with --help on nested subcommand', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'migrate', '--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('migrate');
		expect(output).toContain('--steps');
	});

	it('`help db migrate` shows same output as `db migrate --help`', async () => {
		const app = cli('myapp').command(dbGroup());
		const viaHelp = await app.execute(['help', 'db', 'migrate']);
		const viaFlag = await app.execute(['db', 'migrate', '--help']);

		expect(viaHelp.exitCode).toBe(0);
		expect(viaHelp.stdout).toEqual(viaFlag.stdout);
	});

	it('`help db` shows group help', async () => {
		const app = cli('myapp').command(dbGroup());
		const viaHelp = await app.execute(['help', 'db']);
		const viaDirect = await app.execute(['db']);

		expect(viaHelp.exitCode).toBe(0);
		expect(viaHelp.stdout).toEqual(viaDirect.stdout);
	});
});

// ===================================================================
// Nested dispatch — --json mode
// ===================================================================

describe('CLIBuilder — nested dispatch with --json', () => {
	it('propagates --json to nested subcommand', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.action(({ out }) => {
				out.json({ status: 'done' });
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', '--json']);
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ status: 'done' });
	});

	it('reports unknown nested command as JSON error', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'nope', '--json']);
		expect(result.exitCode).toBe(2);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('UNKNOWN_COMMAND');
	});
});

// ===================================================================
// Nested dispatch — aliases
// ===================================================================

describe('CLIBuilder — nested dispatch with aliases', () => {
	it('dispatches to nested subcommand via alias', async () => {
		const migrate = command('migrate')
			.alias('m')
			.description('Run migrations')
			.action(({ out }) => {
				out.log('migrating');
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'm']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['migrating\n']);
	});
});

// ===================================================================
// Scoped "did you mean?" suggestions
// ===================================================================

describe('CLIBuilder — scoped suggestions', () => {
	it('suggests sibling subcommand for typo within group', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'migrat']); // typo for "migrate"
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain("Did you mean 'migrate'?");
	});

	it('does not suggest commands from other groups', async () => {
		const deploy = command('deploy')
			.description('Deploy')
			.action(({ out }) => {
				out.log('deployed');
			});

		const app = cli('myapp').command(dbGroup()).command(deploy);
		// 'deplpy' is close to 'deploy' but should NOT be suggested inside 'db' scope
		const result = await app.execute(['db', 'deplpy']);
		expect(result.exitCode).toBe(2);
		const stderr = result.stderr.join('');
		expect(stderr).not.toContain("Did you mean 'deploy'?");
	});

	it('shows scoped help hint for unknown nested command with no close match', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'xxxxxxxxx']);
		expect(result.exitCode).toBe(2);
		// Should suggest "myapp db --help" not "myapp --help"
		expect(result.stderr.join('')).toContain("Run 'myapp db --help'");
	});

	it('shows root help hint for unknown root command with no close match', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['xxxxxxxxx']);
		expect(result.exitCode).toBe(2);
		// Root level — should suggest "myapp --help"
		expect(result.stderr.join('')).toContain("Run 'myapp --help'");
	});

	it('shows scoped help hint for 3-level nesting', async () => {
		const up = command('up')
			.description('Run migrations up')
			.action(({ out }) => {
				out.log('up');
			});

		const migrate = group('migrate').description('Migration commands').command(up);
		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', 'xxxxxxxxx']);
		expect(result.exitCode).toBe(2);
		// Should suggest "myapp db migrate --help"
		expect(result.stderr.join('')).toContain("Run 'myapp db migrate --help'");
	});

	it('scoped suggestion works in JSON mode', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'xxxxxxxxx', '--json']);
		expect(result.exitCode).toBe(2);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.suggest).toContain('myapp db --help');
	});

	it('suggests subcommand alias match within scope', async () => {
		const migrate = command('migrate')
			.alias('m')
			.description('Run migrations')
			.action(({ out }) => {
				out.log('migrating');
			});

		const db = group('db').description('Database operations').command(migrate);
		const app = cli('myapp').command(db);
		// 'n' is close to alias 'm' (distance 1)
		const result = await app.execute(['db', 'n']);
		expect(result.exitCode).toBe(2);
		// Should suggest canonical name 'migrate' (from alias 'm' proximity)
		expect(result.stderr.join('')).toContain("Did you mean 'migrate'?");
	});
});
