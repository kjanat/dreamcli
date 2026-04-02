/**
 * Tests for the help text generator.
 *
 * @module dreamcli/core/help/help.test
 */

import { describe, expect, it } from 'vitest';

import { arg, createArgSchema } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { createSchema, flag } from '#internals/core/schema/flag.ts';

import { formatHelp } from './index.ts';

// --- Helpers

// --- Basic command (no flags, no args)

describe('formatHelp', () => {
	describe('minimal command', () => {
		const cmd = command('greet');

		it('includes usage line with command name', () => {
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Usage: greet');
		});

		it('ends with a newline', () => {
			const help = formatHelp(cmd.schema);
			expect(help.endsWith('\n')).toBe(true);
		});

		it('does not include Arguments section', () => {
			const help = formatHelp(cmd.schema);
			expect(help).not.toContain('Arguments:');
		});

		it('does not include Flags section', () => {
			const help = formatHelp(cmd.schema);
			expect(help).not.toContain('Flags:');
		});

		it('does not include Examples section', () => {
			const help = formatHelp(cmd.schema);
			expect(help).not.toContain('Examples:');
		});
	});

	// -----------------------------------------------------------------------
	// Description
	// -----------------------------------------------------------------------

	describe('description', () => {
		it('renders command description', () => {
			const cmd = command('deploy').description('Deploy to an environment');
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Deploy to an environment');
		});

		it('omits description section when none set', () => {
			const cmd = command('noop');
			const help = formatHelp(cmd.schema);
			// Usage line + trailing newline — no extra sections
			const lines = help.trim().split('\n');
			expect(lines).toHaveLength(1);
		});
	});

	// -----------------------------------------------------------------------
	// Usage line
	// -----------------------------------------------------------------------

	describe('usage line', () => {
		it('shows [flags] when flags are present', () => {
			const cmd = command('run').flag('verbose', flag.boolean());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Usage: run [flags]');
		});

		it('does not show [flags] when no flags', () => {
			const cmd = command('run');
			const help = formatHelp(cmd.schema);
			expect(help).not.toContain('[flags]');
		});

		it('shows required arg as <name>', () => {
			const cmd = command('deploy').arg('target', arg.string());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('<target>');
		});

		it('shows optional arg as [name]', () => {
			const cmd = command('deploy').arg('target', arg.string().optional());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[target]');
		});

		it('shows enum arg values in angle brackets', () => {
			const cmd = command('deploy').arg('region', arg.enum(['us', 'eu', 'ap']));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('<us|eu|ap>');
		});

		it('shows optional enum arg values in square brackets', () => {
			const cmd = command('deploy').arg('region', arg.enum(['us', 'eu']).optional());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[us|eu]');
		});

		it('shows variadic arg with ellipsis', () => {
			const cmd = command('cat').arg('files', arg.string().variadic());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('<files>...');
		});

		it('includes binName prefix when provided', () => {
			const cmd = command('deploy').arg('target', arg.string());
			const help = formatHelp(cmd.schema, { binName: 'mycli' });
			expect(help).toContain('Usage: mycli deploy');
		});

		it('includes both binName and command name for explicit command help', () => {
			const cmd = command('greet').arg('target', arg.string());
			const help = formatHelp(cmd.schema, { binName: 'greet' });
			expect(help).toContain('Usage: greet greet <target>');
		});

		it('shows flags and args together in correct order', () => {
			const cmd = command('deploy')
				.flag('force', flag.boolean())
				.arg('target', arg.string())
				.arg('env', arg.string().optional());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Usage: deploy [flags] <target> [env]');
		});
	});

	// -----------------------------------------------------------------------
	// Arguments section
	// -----------------------------------------------------------------------

	describe('arguments section', () => {
		it('lists positional args with descriptions', () => {
			const cmd = command('deploy')
				.arg('target', arg.string().describe('Deploy target'))
				.arg('env', arg.string().optional().describe('Environment'));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Arguments:');
			expect(help).toContain('<target>');
			expect(help).toContain('Deploy target');
			expect(help).toContain('[env]');
			expect(help).toContain('Environment');
		});

		it('shows default value for defaulted args', () => {
			const cmd = command('deploy').arg(
				'env',
				arg.string().default('production').describe('Environment'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('(default: production)');
		});

		it('renders nullish sentinels for defaulted args', () => {
			const base = command('deploy');
			const nullHelp = formatHelp({
				...base.schema,
				args: [
					{
						name: 'env',
						schema: createArgSchema('string', {
							presence: 'defaulted',
							defaultValue: null,
							description: 'Environment',
						}),
					},
				],
			});
			const undefinedHelp = formatHelp({
				...base.schema,
				args: [
					{
						name: 'env',
						schema: createArgSchema('string', {
							presence: 'defaulted',
							defaultValue: undefined,
							description: 'Environment',
						}),
					},
				],
			});

			expect(nullHelp).toContain('(default: null)');
			expect(undefinedHelp).toContain('(default: undefined)');
		});

		it('renders arg without description', () => {
			const cmd = command('deploy').arg('target', arg.string());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Arguments:');
			expect(help).toContain('<target>');
		});

		it('shows [env: VAR] when arg has envVar', () => {
			const cmd = command('deploy').arg(
				'target',
				arg.string().env('DEPLOY_TARGET').describe('Deploy target'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[env: DEPLOY_TARGET]');
		});
	});

	// -----------------------------------------------------------------------
	// Flags section
	// -----------------------------------------------------------------------

	describe('flags section', () => {
		it('renders flag with description', () => {
			const cmd = command('run').flag('verbose', flag.boolean().describe('Enable verbose output'));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Flags:');
			expect(help).toContain('--verbose');
			expect(help).toContain('Enable verbose output');
		});

		it('renders short alias', () => {
			const cmd = command('run').flag('force', flag.boolean().alias('f'));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('-f, --force');
		});

		it('renders string flag with <string> hint', () => {
			const cmd = command('run').flag('name', flag.string());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('--name <string>');
		});

		it('renders number flag with <number> hint', () => {
			const cmd = command('run').flag('port', flag.number());
			const help = formatHelp(cmd.schema);
			expect(help).toContain('--port <number>');
		});

		it('renders enum flag with values', () => {
			const cmd = command('run').flag('region', flag.enum(['us', 'eu', 'ap']));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('--region <us|eu|ap>');
		});

		it('renders array flag with ellipsis', () => {
			const cmd = command('run').flag('tags', flag.array(flag.string()));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('--tags <string>...');
		});

		it('does not show <type> hint for boolean flags', () => {
			const cmd = command('run').flag('verbose', flag.boolean());
			const help = formatHelp(cmd.schema);
			// Should show --verbose without any <boolean>
			expect(help).toContain('--verbose');
			expect(help).not.toContain('<boolean>');
		});

		it('shows [required] for required flags', () => {
			const cmd = command('run').flag('token', flag.string().required().describe('API token'));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[required]');
		});

		it('shows default for defaulted non-boolean flags', () => {
			const cmd = command('run').flag('port', flag.number().default(8080).describe('Port'));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('(default: 8080)');
		});

		it('renders nullish sentinels for defaulted flags', () => {
			const base = command('run');
			const nullHelp = formatHelp({
				...base.schema,
				flags: {
					token: createSchema('string', {
						presence: 'defaulted',
						defaultValue: null,
						description: 'Token',
					}),
				},
			});
			const undefinedHelp = formatHelp({
				...base.schema,
				flags: {
					token: createSchema('string', {
						presence: 'defaulted',
						defaultValue: undefined,
						description: 'Token',
					}),
				},
			});

			expect(nullHelp).toContain('(default: null)');
			expect(undefinedHelp).toContain('(default: undefined)');
		});

		it('formats non-primitive defaults as JSON', () => {
			const cmd = command('run').flag(
				'tags',
				flag.array(flag.string()).default(['blue', 'green']).describe('Deployment tags'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('(default: ["blue","green"])');
		});

		it('does not show default for boolean flags', () => {
			const cmd = command('run').flag('verbose', flag.boolean().describe('Verbose'));
			const help = formatHelp(cmd.schema);
			expect(help).not.toContain('(default: false)');
		});

		it('sorts flags with short aliases first', () => {
			const cmd = command('run')
				.flag('verbose', flag.boolean().describe('Verbose'))
				.flag('force', flag.boolean().alias('f').describe('Force'))
				.flag('all', flag.boolean().describe('All'));
			const help = formatHelp(cmd.schema);
			const forceIdx = help.indexOf('-f, --force');
			const verboseIdx = help.indexOf('--verbose');
			const allIdx = help.indexOf('--all');
			// -f,--force should come before --all and --verbose
			expect(forceIdx).toBeLessThan(allIdx);
			expect(forceIdx).toBeLessThan(verboseIdx);
		});
	});

	// -----------------------------------------------------------------------
	// Env/config source annotations
	// -----------------------------------------------------------------------

	describe('env/config annotations', () => {
		it('shows [env: VAR] when envVar is set', () => {
			const cmd = command('deploy').flag(
				'region',
				flag.string().env('DEPLOY_REGION').describe('Target region'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[env: DEPLOY_REGION]');
		});

		it('shows [config: path] when configPath is set', () => {
			const cmd = command('deploy').flag(
				'region',
				flag.string().config('deploy.region').describe('Target region'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[config: deploy.region]');
		});

		it('shows both env and config annotations together', () => {
			const cmd = command('deploy').flag(
				'region',
				flag
					.enum(['us', 'eu', 'ap'])
					.env('DEPLOY_REGION')
					.config('deploy.region')
					.describe('Target region'),
			);
			// Use wide width to prevent wrapping from splitting annotations
			const help = formatHelp(cmd.schema, { width: 120 });
			expect(help).toContain('[env: DEPLOY_REGION]');
			expect(help).toContain('[config: deploy.region]');
			// env before config in output
			const envIdx = help.indexOf('[env: DEPLOY_REGION]');
			const configIdx = help.indexOf('[config: deploy.region]');
			expect(envIdx).toBeLessThan(configIdx);
		});

		it('places annotations after description and before [required]', () => {
			const cmd = command('deploy').flag(
				'token',
				flag.string().env('API_TOKEN').required().describe('Auth token'),
			);
			const help = formatHelp(cmd.schema);
			const descIdx = help.indexOf('Auth token');
			const envIdx = help.indexOf('[env: API_TOKEN]');
			const reqIdx = help.indexOf('[required]');
			expect(descIdx).toBeLessThan(envIdx);
			expect(envIdx).toBeLessThan(reqIdx);
		});

		it('places annotations after description and before (default: X)', () => {
			const cmd = command('deploy').flag(
				'port',
				flag.number().env('PORT').default(8080).describe('Server port'),
			);
			const help = formatHelp(cmd.schema);
			const descIdx = help.indexOf('Server port');
			const envIdx = help.indexOf('[env: PORT]');
			const defIdx = help.indexOf('(default: 8080)');
			expect(descIdx).toBeLessThan(envIdx);
			expect(envIdx).toBeLessThan(defIdx);
		});

		it('renders annotations without description', () => {
			const cmd = command('deploy').flag(
				'region',
				flag.string().env('REGION').config('deploy.region'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[env: REGION]');
			expect(help).toContain('[config: deploy.region]');
		});

		it('does not show env/config when not configured', () => {
			const cmd = command('run').flag('verbose', flag.boolean().describe('Verbose'));
			const help = formatHelp(cmd.schema);
			expect(help).not.toContain('[env:');
			expect(help).not.toContain('[config:');
		});

		it('renders full annotation chain: description + env + config + required', () => {
			const cmd = command('deploy').flag(
				'region',
				flag
					.enum(['us', 'eu', 'ap'])
					.env('DEPLOY_REGION')
					.config('deploy.region')
					.required()
					.describe('Target region'),
			);
			// Use wide width to keep annotations on one line
			const help = formatHelp(cmd.schema, { width: 120 });
			// Check the full annotation sequence
			const line = help.split('\n').find((l) => l.includes('--region'));
			expect(line).toBeDefined();
			expect(line).toContain('Target region');
			expect(line).toContain('[env: DEPLOY_REGION]');
			expect(line).toContain('[config: deploy.region]');
			expect(line).toContain('[required]');
		});

		it('renders full annotation chain: description + env + config + default', () => {
			const cmd = command('deploy').flag(
				'port',
				flag.number().env('PORT').config('server.port').default(3000).describe('Listen port'),
			);
			const help = formatHelp(cmd.schema);
			const line = help.split('\n').find((l) => l.includes('--port'));
			expect(line).toBeDefined();
			expect(line).toContain('Listen port');
			expect(line).toContain('[env: PORT]');
			expect(line).toContain('[config: server.port]');
			expect(line).toContain('(default: 3000)');
		});
	});

	// -----------------------------------------------------------------------
	// Examples section
	// -----------------------------------------------------------------------

	describe('examples section', () => {
		it('renders example without description', () => {
			const cmd = command('deploy').example('deploy production');
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Examples:');
			expect(help).toContain('$ deploy production');
		});

		it('renders example with description', () => {
			const cmd = command('deploy').example('deploy production --force', 'Force deploy to prod');
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Force deploy to prod:');
			expect(help).toContain('$ deploy production --force');
		});

		it('renders multiple examples', () => {
			const cmd = command('deploy')
				.example('deploy staging', 'Deploy to staging')
				.example('deploy production --force');
			const help = formatHelp(cmd.schema);
			expect(help).toContain('Deploy to staging:');
			expect(help).toContain('$ deploy staging');
			expect(help).toContain('$ deploy production --force');
		});
	});

	// -----------------------------------------------------------------------
	// Options (width, binName)
	// -----------------------------------------------------------------------

	describe('options', () => {
		it('uses custom width for text wrapping', () => {
			const longDesc =
				'This is a very long description that should be wrapped across multiple lines';
			const cmd = command('run').flag('x', flag.string().describe(longDesc));
			const help = formatHelp(cmd.schema, { width: 40 });
			// The description should be wrapped across multiple lines
			const lines = help.split('\n');
			const descLines = lines.filter(
				(l) =>
					l.includes('This') ||
					l.includes('wrapped') ||
					l.includes('long') ||
					l.includes('multiple'),
			);
			expect(descLines.length).toBeGreaterThan(1);
		});
	});

	// -----------------------------------------------------------------------
	// Full composition (realistic command)
	// -----------------------------------------------------------------------

	describe('full composition', () => {
		it('renders complete help for a realistic command', () => {
			const cmd = command('deploy')
				.description('Deploy to an environment')
				.arg('target', arg.string().describe('Deploy target'))
				.flag('force', flag.boolean().alias('f').describe('Skip confirmation'))
				.flag('region', flag.enum(['us', 'eu', 'ap']).describe('Target region'))
				.flag('replicas', flag.number().default(3).describe('Number of replicas'))
				.example('deploy production', 'Deploy to production')
				.example('deploy staging --force -r us');

			const help = formatHelp(cmd.schema, { binName: 'mycli' });

			// Usage line
			expect(help).toContain('Usage: mycli deploy [flags] <target>');

			// Description
			expect(help).toContain('Deploy to an environment');

			// Arguments
			expect(help).toContain('Arguments:');
			expect(help).toContain('Deploy target');

			// Flags
			expect(help).toContain('Flags:');
			expect(help).toContain('-f, --force');
			expect(help).toContain('--region <us|eu|ap>');
			expect(help).toContain('--replicas <number>');
			expect(help).toContain('(default: 3)');

			// Examples
			expect(help).toContain('Examples:');
			expect(help).toContain('Deploy to production:');
			expect(help).toContain('$ deploy production');
		});
	});

	// -----------------------------------------------------------------------
	// Custom flag help
	// -----------------------------------------------------------------------

	describe('custom flag help', () => {
		it('shows <value> hint for custom flag', () => {
			const cmd = command('test').flag(
				'hex',
				flag.custom((raw) => Number.parseInt(String(raw), 16)).describe('Hex color'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('--hex <value>');
			expect(help).toContain('Hex color');
		});
	});

	// -----------------------------------------------------------------------
	// Deprecated annotations
	// -----------------------------------------------------------------------

	describe('deprecated annotations', () => {
		it('shows [deprecated] for flag with deprecated()', () => {
			const cmd = command('test').flag('old', flag.string().deprecated().describe('Old flag'));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[deprecated]');
			expect(help).toContain('Old flag');
		});

		it('shows [deprecated: reason] for flag with deprecated(message)', () => {
			const cmd = command('test').flag('old', flag.string().deprecated('use --new instead'));
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[deprecated: use --new instead]');
		});

		it('shows [deprecated] for arg with deprecated()', () => {
			const cmd = command('test').arg(
				'target',
				arg.string().optional().deprecated().describe('Deploy target'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[deprecated]');
			expect(help).toContain('Deploy target');
		});

		it('shows [deprecated: reason] for arg with deprecated(message)', () => {
			const cmd = command('test').arg(
				'target',
				arg.string().optional().deprecated('use --target flag'),
			);
			const help = formatHelp(cmd.schema);
			expect(help).toContain('[deprecated: use --target flag]');
		});

		it('places [deprecated] before [env:] annotation', () => {
			const cmd = command('test').flag(
				'old',
				flag.string().env('OLD_VAR').deprecated().describe('Old flag'),
			);
			const help = formatHelp(cmd.schema);
			const deprecatedIdx = help.indexOf('[deprecated]');
			const envIdx = help.indexOf('[env: OLD_VAR]');
			expect(deprecatedIdx).toBeLessThan(envIdx);
		});
	});

	// -----------------------------------------------------------------------
	// Commands section (nested subcommands)
	// -----------------------------------------------------------------------

	describe('commands section — nested subcommands', () => {
		it('renders Commands: section when subcommands exist', () => {
			const db = command('db')
				.description('Database operations')
				.command(command('migrate').description('Run migrations'))
				.command(command('seed').description('Seed database'));

			const help = formatHelp(db.schema);
			expect(help).toContain('Commands:');
			expect(help).toContain('migrate');
			expect(help).toContain('Run migrations');
			expect(help).toContain('seed');
			expect(help).toContain('Seed database');
		});

		it('omits Commands: section when no subcommands', () => {
			const cmd = command('deploy').description('Deploy');
			const help = formatHelp(cmd.schema);
			expect(help).not.toContain('Commands:');
		});

		it('skips hidden subcommands in Commands: section', () => {
			const db = command('db')
				.command(command('migrate').description('Run migrations'))
				.command(command('internal').description('Internal only').hidden());

			const help = formatHelp(db.schema);
			expect(help).toContain('migrate');
			expect(help).not.toContain('internal');
		});

		it('renders subcommand without description', () => {
			const db = command('db').command(command('migrate'));
			const help = formatHelp(db.schema);
			expect(help).toContain('Commands:');
			expect(help).toContain('migrate');
		});

		it('aligns subcommand descriptions', () => {
			const db = command('db')
				.command(command('migrate').description('Run migrations'))
				.command(command('seed').description('Seed data'));

			const help = formatHelp(db.schema);
			const lines = help.split('\n');
			const migrateLine = lines.find((l) => l.includes('migrate'));
			const seedLine = lines.find((l) => l.includes('seed'));
			expect(migrateLine).toBeDefined();
			expect(seedLine).toBeDefined();
			// Descriptions should start at the same column
			const migrateDescIdx = migrateLine?.indexOf('Run migrations') ?? -1;
			const seedDescIdx = seedLine?.indexOf('Seed data') ?? -1;
			expect(migrateDescIdx).toBeGreaterThan(0);
			expect(migrateDescIdx).toBe(seedDescIdx);
		});

		it('shows <command> in usage line when subcommands exist', () => {
			const db = command('db').description('Database operations').command(command('migrate'));

			const help = formatHelp(db.schema);
			expect(help).toContain('Usage: db <command>');
		});

		it('shows <command> alongside [flags] and args in usage line', () => {
			const db = command('db')
				.flag('verbose', flag.boolean())
				.arg('target', arg.string().optional())
				.command(command('migrate'));

			const help = formatHelp(db.schema);
			expect(help).toContain('Usage: db <command> [flags] [target]');
		});

		it('includes binName in usage line with <command>', () => {
			const db = command('db').command(command('migrate').description('Run migrations'));

			const help = formatHelp(db.schema, { binName: 'myapp' });
			expect(help).toContain('Usage: myapp db <command>');
		});
	});

	// -----------------------------------------------------------------------
	// Section ordering
	// -----------------------------------------------------------------------

	describe('section ordering', () => {
		it('renders sections in correct order: Usage, Description, Arguments, Flags, Examples', () => {
			const cmd = command('deploy')
				.description('Deploy')
				.arg('target', arg.string())
				.flag('force', flag.boolean())
				.example('deploy prod');

			const help = formatHelp(cmd.schema);

			const usageIdx = help.indexOf('Usage:');
			const descIdx = help.indexOf('Deploy');
			const argsIdx = help.indexOf('Arguments:');
			const flagsIdx = help.indexOf('Flags:');
			const examplesIdx = help.indexOf('Examples:');

			expect(usageIdx).toBeLessThan(descIdx);
			expect(descIdx).toBeLessThan(argsIdx);
			expect(argsIdx).toBeLessThan(flagsIdx);
			expect(flagsIdx).toBeLessThan(examplesIdx);
		});

		it('renders Commands before Arguments in section order', () => {
			const db = command('db')
				.description('Database ops')
				.arg('target', arg.string().optional())
				.flag('force', flag.boolean())
				.command(command('migrate').description('Migrate'))
				.example('db migrate');

			const help = formatHelp(db.schema);

			const usageIdx = help.indexOf('Usage:');
			const descIdx = help.indexOf('Database ops');
			const cmdsIdx = help.indexOf('Commands:');
			const argsIdx = help.indexOf('Arguments:');
			const flagsIdx = help.indexOf('Flags:');
			const examplesIdx = help.indexOf('Examples:');

			expect(usageIdx).toBeLessThan(descIdx);
			expect(descIdx).toBeLessThan(cmdsIdx);
			expect(cmdsIdx).toBeLessThan(argsIdx);
			expect(argsIdx).toBeLessThan(flagsIdx);
			expect(flagsIdx).toBeLessThan(examplesIdx);
		});
	});
});
