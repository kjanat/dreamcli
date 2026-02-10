/**
 * Tests for testkit support of nested command tree scenarios.
 *
 * Exercises `runCommand()` with the `mergedSchema` injection seam and
 * `CLIBuilder.execute()` with nested commands through testkit's injectable
 * options (env, config, answers, verbosity, JSON mode).
 */

import { describe, expect, it } from 'vitest';
import { cli } from '../cli/index.js';
import { arg } from '../schema/arg.js';
import { command, group } from '../schema/command.js';
import { flag } from '../schema/flag.js';
import { middleware } from '../schema/middleware.js';
import { runCommand } from './index.js';

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
		.flag('count', flag.number().default(10).describe('Seed row count'))
		.action(({ flags, out }) => {
			out.log(`seeding ${flags.count} rows`);
		});
}

function dbGroup() {
	return group('db')
		.description('Database operations')
		.command(migrateCommand())
		.command(seedCommand());
}

// ===================================================================
// runCommand — mergedSchema injection seam
// ===================================================================

describe('runCommand — mergedSchema injection', () => {
	it('resolves propagated flag via mergedSchema', async () => {
		const cmd = command('migrate')
			.description('Run migrations')
			.action(({ flags, out }) => {
				const f = flags as Record<string, unknown>;
				out.log(`verbose=${String(f['verbose'] ?? false)}`);
			});

		// Simulate what dispatch does: merge a propagated "verbose" flag
		// into the command's schema via mergedSchema.
		const mergedSchema = {
			...cmd.schema,
			flags: {
				...cmd.schema.flags,
				verbose: flag.boolean().propagate().schema,
			},
		};

		const result = await runCommand(cmd, ['--verbose'], { mergedSchema });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['verbose=true\n']);
	});

	it('mergedSchema flag uses default when not provided on CLI', async () => {
		const cmd = command('migrate')
			.description('Run migrations')
			.action(({ flags, out }) => {
				const f = flags as Record<string, unknown>;
				out.log(`verbose=${String(f['verbose'] ?? false)}`);
			});

		const mergedSchema = {
			...cmd.schema,
			flags: {
				...cmd.schema.flags,
				verbose: flag.boolean().default(false).propagate().schema,
			},
		};

		const result = await runCommand(cmd, [], { mergedSchema });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['verbose=false\n']);
	});

	it('command own flags still work alongside mergedSchema flags', async () => {
		const cmd = command('migrate')
			.description('Run migrations')
			.flag('steps', flag.number().describe('Steps'))
			.action(({ flags, out }) => {
				const f = flags as Record<string, unknown>;
				out.log(`steps=${String(flags.steps ?? 'all')} verbose=${String(f['verbose'] ?? false)}`);
			});

		const mergedSchema = {
			...cmd.schema,
			flags: {
				verbose: flag.boolean().propagate().schema,
				...cmd.schema.flags,
			},
		};

		const result = await runCommand(cmd, ['--steps', '5', '--verbose'], { mergedSchema });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['steps=5 verbose=true\n']);
	});

	it('help rendering uses mergedSchema when --help is passed', async () => {
		const cmd = command('migrate')
			.description('Run migrations')
			.flag('steps', flag.number().describe('Steps'))
			.action(() => {});

		const mergedSchema = {
			...cmd.schema,
			flags: {
				verbose: flag.boolean().describe('Verbose output').propagate().schema,
				...cmd.schema.flags,
			},
		};

		const result = await runCommand(cmd, ['--help'], { mergedSchema });
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('--verbose');
		expect(output).toContain('--steps');
	});
});

// ===================================================================
// runCommand — command with subcommands (help rendering)
// ===================================================================

describe('runCommand — command with subcommands', () => {
	it('help shows Commands section for command with nested subcommands', async () => {
		const cmd = group('db')
			.description('Database operations')
			.command(migrateCommand())
			.command(seedCommand())
			.action(({ out }) => {
				out.log('db default');
			});

		const result = await runCommand(cmd, ['--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('Commands:');
		expect(output).toContain('migrate');
		expect(output).toContain('seed');
	});
});

// ===================================================================
// CLIBuilder.execute — nested dispatch with env injection
// ===================================================================

describe('CLIBuilder.execute — nested dispatch with env injection', () => {
	it('propagated env flag resolves in nested subcommand', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.action(({ flags, out }) => {
				const f = flags as Record<string, unknown>;
				out.log(`verbose=${String(f['verbose'] ?? false)}`);
			});

		const db = group('db')
			.description('Database operations')
			.flag('verbose', flag.boolean().env('VERBOSE').propagate())
			.command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate'], {
			env: { VERBOSE: 'true' },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['verbose=true\n']);
	});

	it('env flag on leaf command resolves within nested context', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.flag('dry', flag.boolean().env('DRY_RUN'))
			.action(({ flags, out }) => {
				out.log(`dry=${String(flags.dry)}`);
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate'], {
			env: { DRY_RUN: 'true' },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['dry=true\n']);
	});
});

// ===================================================================
// CLIBuilder.execute — nested dispatch with config injection
// ===================================================================

describe('CLIBuilder.execute — nested dispatch with config injection', () => {
	it('config value resolves in nested subcommand', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.flag('steps', flag.number().config('db.migrate.steps'))
			.action(({ flags, out }) => {
				out.log(`steps=${String(flags.steps ?? 'all')}`);
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate'], {
			config: { db: { migrate: { steps: 5 } } },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['steps=5\n']);
	});

	it('CLI flag overrides config in nested context', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.flag('steps', flag.number().config('db.migrate.steps'))
			.action(({ flags, out }) => {
				out.log(`steps=${String(flags.steps ?? 'all')}`);
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', '--steps', '3'], {
			config: { db: { migrate: { steps: 10 } } },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['steps=3\n']);
	});
});

// ===================================================================
// CLIBuilder.execute — nested dispatch with middleware
// ===================================================================

describe('CLIBuilder.execute — nested dispatch with middleware', () => {
	it('middleware on leaf command runs in nested context', async () => {
		const timing = middleware<{ startedAt: number }>(async ({ out, next }) => {
			out.info('middleware: before');
			await next({ startedAt: Date.now() });
			out.info('middleware: after');
		});

		const migrate = command('migrate')
			.description('Run migrations')
			.middleware(timing)
			.action(({ ctx, out }) => {
				out.log(`started=${typeof ctx.startedAt}`);
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContainEqual('started=number\n');
		expect(result.stdout).toContainEqual('middleware: before\n');
		expect(result.stdout).toContainEqual('middleware: after\n');
	});
});

// ===================================================================
// CLIBuilder.execute — nested dispatch with verbosity
// ===================================================================

describe('CLIBuilder.execute — nested dispatch with verbosity', () => {
	it('quiet mode suppresses info in nested subcommand', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.action(({ out }) => {
				out.log('always visible');
				out.info('maybe visible');
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);

		const normal = await app.execute(['db', 'migrate']);
		expect(normal.exitCode).toBe(0);
		expect(normal.stdout).toHaveLength(2);

		const quiet = await app.execute(['db', 'migrate'], { verbosity: 'quiet' });
		expect(quiet.exitCode).toBe(0);
		expect(quiet.stdout).toHaveLength(1);
		expect(quiet.stdout[0]).toContain('always visible');
	});
});

// ===================================================================
// CLIBuilder.execute — nested dispatch with JSON mode
// ===================================================================

describe('CLIBuilder.execute — nested dispatch with JSON mode', () => {
	it('JSON mode works in nested subcommand via options', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.action(({ out }) => {
				out.json({ status: 'done', steps: 5 });
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate'], { jsonMode: true });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ status: 'done', steps: 5 });
	});

	it('JSON mode error for missing nested subcommand via options', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'nope'], { jsonMode: true });
		expect(result.exitCode).toBe(2);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('UNKNOWN_COMMAND');
	});
});

// ===================================================================
// CLIBuilder.execute — nested dispatch with TTY
// ===================================================================

describe('CLIBuilder.execute — nested dispatch with TTY', () => {
	it('isTTY propagates to nested subcommand output', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.action(({ out }) => {
				out.log(`tty=${String(out.isTTY)}`);
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);

		const ttyResult = await app.execute(['db', 'migrate'], { isTTY: true });
		expect(ttyResult.exitCode).toBe(0);
		expect(ttyResult.stdout).toEqual(['tty=true\n']);

		const noTtyResult = await app.execute(['db', 'migrate'], { isTTY: false });
		expect(noTtyResult.exitCode).toBe(0);
		expect(noTtyResult.stdout).toEqual(['tty=false\n']);
	});
});

// ===================================================================
// CLIBuilder.execute — nested dispatch error cases
// ===================================================================

describe('CLIBuilder.execute — nested dispatch error cases', () => {
	it('parse error in nested subcommand returns exit 2', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'migrate', '--unknown-flag']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown flag');
	});

	it('handler error in nested subcommand is caught', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.action(() => {
				throw new Error('migration failed');
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate']);
		expect(result.exitCode).toBe(1);
		expect(result.stderr.join('')).toContain('migration failed');
		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe('UNEXPECTED_ERROR');
	});

	it('missing required flag in nested subcommand returns exit 2', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.flag('target', flag.string().required())
			.action(({ flags, out }) => {
				out.log(flags.target);
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Missing required flag');
	});

	it('missing required arg in nested subcommand returns exit 2', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.arg('env', arg.string())
			.action(({ args, out }) => {
				out.log(args.env);
			});

		const db = group('db').description('Database operations').command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Missing required');
	});
});

// ===================================================================
// CLIBuilder.execute — nested help through various paths
// ===================================================================

describe('CLIBuilder.execute — nested help variations', () => {
	it('--help on group shows subcommand list', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', '--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('Commands:');
		expect(output).toContain('migrate');
		expect(output).toContain('seed');
	});

	it('--help on leaf shows flag details including propagated flags', async () => {
		const migrate = command('migrate')
			.description('Run migrations')
			.flag('steps', flag.number().describe('Number of steps'))
			.action(() => {});

		const db = group('db')
			.description('Database operations')
			.flag('verbose', flag.boolean().describe('Verbose output').propagate())
			.command(migrate);

		const app = cli('myapp').command(db);
		const result = await app.execute(['db', 'migrate', '--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('--steps');
		expect(output).toContain('--verbose');
	});

	it('binName context preserved in nested help', async () => {
		const app = cli('myapp').command(dbGroup());
		const result = await app.execute(['db', 'migrate', '--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('myapp');
	});
});

// ===================================================================
// CLIBuilder.execute — 3-level nesting through testkit options
// ===================================================================

describe('CLIBuilder.execute — 3-level nesting with testkit options', () => {
	function threeLevel() {
		const up = command('up')
			.description('Migrate up')
			.flag('count', flag.number().default(1).env('MIGRATE_COUNT').describe('Step count'))
			.action(({ flags, out }) => {
				out.log(`up ${flags.count} steps`);
			});

		const down = command('down')
			.description('Migrate down')
			.action(({ out }) => {
				out.log('migrating down');
			});

		const migrate = group('migrate').description('Migration commands').command(up).command(down);

		const db = group('db')
			.description('Database operations')
			.flag('verbose', flag.boolean().propagate())
			.command(migrate);

		return cli('myapp').command(db);
	}

	it('dispatches through 3 levels with env injection', async () => {
		const app = threeLevel();
		const result = await app.execute(['db', 'migrate', 'up'], {
			env: { MIGRATE_COUNT: '7' },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['up 7 steps\n']);
	});

	it('CLI flag overrides env in 3-level nesting', async () => {
		const app = threeLevel();
		const result = await app.execute(['db', 'migrate', 'up', '--count', '3'], {
			env: { MIGRATE_COUNT: '7' },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['up 3 steps\n']);
	});

	it('propagated flag reaches 3rd level', async () => {
		const up = command('up')
			.description('Migrate up')
			.action(({ flags, out }) => {
				const f = flags as Record<string, unknown>;
				out.log(`verbose=${String(f['verbose'] ?? false)}`);
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

	it('unknown subcommand at 3rd level gives scoped error', async () => {
		const app = threeLevel();
		const result = await app.execute(['db', 'migrate', 'sideways']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown command: sideways');
	});
});
