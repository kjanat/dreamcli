/**
 * Multi-command CLI with nested command groups (git-like).
 *
 * Demonstrates: cli(), command(), group(), subcommand nesting,
 * version, env binding, flag propagation.
 *
 * Usage:
 *   npx tsx examples/multi-command.ts deploy production --force
 *   npx tsx examples/multi-command.ts deploy production --region eu
 *   DEPLOY_REGION=ap npx tsx examples/multi-command.ts deploy production
 *   npx tsx examples/multi-command.ts db migrate --steps 3
 *   npx tsx examples/multi-command.ts db seed
 *   npx tsx examples/multi-command.ts login --token abc123
 *   npx tsx examples/multi-command.ts --help
 *   npx tsx examples/multi-command.ts --version
 */

import { arg, cli, command, flag, group } from 'dreamcli';

// --- Top-level commands ---

const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string().describe('Deploy target (e.g. production, staging)'))
	.flag('force', flag.boolean().alias('f').describe('Skip confirmation'))
	.flag('region', flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION').describe('Target region'))
	.action(({ args, flags, out }) => {
		out.log(`Deploying ${args.target} to ${flags.region ?? 'default region'}`);
		if (flags.force) out.log('(forced)');
	});

const login = command('login')
	.description('Authenticate with the service')
	.flag('token', flag.string().describe('Auth token'))
	.action(({ flags, out }) => {
		out.log(`Logged in with token: ${flags.token ?? 'interactive'}`);
	});

// --- Nested command group (myapp db migrate, myapp db seed) ---

const migrate = command('migrate')
	.description('Run database migrations')
	.flag('steps', flag.number().alias('s').describe('Number of migration steps'))
	.action(({ flags, out }) => {
		out.log(`Migrating ${flags.steps !== undefined ? `${flags.steps} steps` : 'all pending'}`);
	});

const seed = command('seed')
	.description('Seed the database')
	.flag('env', flag.enum(['dev', 'test']).default('dev').describe('Seed environment'))
	.action(({ flags, out }) => {
		out.log(`Seeding ${flags.env} database`);
	});

const db = group('db').description('Database operations').command(migrate).command(seed);

// --- Wire it all up ---

cli('myapp')
	.version('1.0.0')
	.description('Example multi-command CLI')
	.command(deploy)
	.command(login)
	.command(db)
	.run();
