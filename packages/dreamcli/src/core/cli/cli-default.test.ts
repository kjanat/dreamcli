/**
 * Tests for default command dispatch — `.default()` builder method.
 */

import { describe, expect, it, vi } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command, group } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli, formatRootHelp } from './index.ts';

// === Helpers

function deployCommand() {
	return command('deploy')
		.description('Deploy to an environment')
		.arg('target', arg.string().describe('Deploy target'))
		.flag('force', flag.boolean().alias('f').describe('Force deployment'))
		.action(({ args, flags, out }) => {
			out.log(`deploy:${args.target ?? 'none'}:${flags.force ? 'forced' : 'normal'}`);
		});
}

function statusCommand() {
	return command('status')
		.description('Show status')
		.action(({ out }) => {
			out.log('status:ok');
		});
}

function noArgCommand() {
	return command('serve')
		.description('Start server')
		.flag('port', flag.number().describe('Port'))
		.action(({ flags, out }) => {
			out.log(`serve:${flags.port ?? 3000}`);
		});
}

// === .default()

describe('.default()', () => {
	// --- builder

	describe('builder', () => {
		it('stores the default command reference in schema', () => {
			const app = cli('mycli').default(deployCommand());

			expect(app.schema.defaultCommand).toBeDefined();
			expect(app.schema.defaultCommand?.schema.name).toBe('deploy');
		});

		it('registers the command in the commands array', () => {
			const app = cli('mycli').default(deployCommand());

			expect(app.schema.commands).toHaveLength(1);
			expect(app.schema.commands[0]?.schema.name).toBe('deploy');
		});

		it('returns a new CLIBuilder (immutable)', () => {
			const a = cli('mycli');
			const b = a.default(deployCommand());

			expect(a.schema.defaultCommand).toBeUndefined();
			expect(b.schema.defaultCommand).toBeDefined();
		});

		it('throws DUPLICATE_DEFAULT when called twice', () => {
			try {
				cli('mycli').default(deployCommand()).default(noArgCommand());
				expect.unreachable('should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(CLIError);
				expect((err as CLIError).code).toBe('DUPLICATE_DEFAULT');
			}
		});

		it('throws DUPLICATE_COMMAND when command name already registered', () => {
			try {
				cli('mycli').command(deployCommand()).default(deployCommand());
				expect.unreachable('should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(CLIError);
				expect((err as CLIError).code).toBe('DUPLICATE_COMMAND');
			}
		});

		it('throws DUPLICATE_COMMAND when incoming alias matches existing command name', () => {
			const withAliasConflict = command('deploy')
				.alias('status')
				.action(() => {});
			try {
				cli('mycli').command(statusCommand()).command(withAliasConflict);
				expect.unreachable('should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(CLIError);
				expect((err as CLIError).code).toBe('DUPLICATE_COMMAND');
			}
		});

		it('throws DUPLICATE_COMMAND when incoming name matches existing alias', () => {
			const existing = command('deploy')
				.alias('d')
				.action(() => {});
			const incoming = command('d').action(() => {});

			try {
				cli('mycli').command(existing).command(incoming);
				expect.unreachable('should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(CLIError);
				expect((err as CLIError).code).toBe('DUPLICATE_COMMAND');
			}
		});
	});

	// --- single-command dispatch

	describe('single-command dispatch', () => {
		it('dispatches to default on empty argv', async () => {
			const handler = vi.fn();
			const cmd = command('run').action(handler);
			const result = await cli('mycli').default(cmd).execute([]);

			expect(result.exitCode).toBe(0);
			expect(handler).toHaveBeenCalledOnce();
		});

		it('passes positional args to default command', async () => {
			const app = cli('mycli').default(deployCommand());
			const result = await app.execute(['production']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('deploy:production:normal');
		});

		it('passes flags to default command', async () => {
			const app = cli('mycli').default(noArgCommand());
			const result = await app.execute(['--port', '8080']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('serve:8080');
		});

		it('passes positional args AND flags to default command', async () => {
			const app = cli('mycli').default(deployCommand());
			const result = await app.execute(['staging', '--force']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('deploy:staging:forced');
		});

		it('passes short flag aliases to default command', async () => {
			const app = cli('mycli').default(deployCommand());
			const result = await app.execute(['staging', '-f']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('deploy:staging:forced');
		});

		it('allows invoking default command by name', async () => {
			const app = cli('mycli').default(deployCommand());
			const result = await app.execute(['deploy', 'production']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('deploy:production:normal');
		});
	});

	// --- hybrid dispatch (default + siblings)

	describe('hybrid dispatch (default + siblings)', () => {
		it('dispatches to named sibling command', async () => {
			const app = cli('mycli').default(deployCommand()).command(statusCommand());
			const result = await app.execute(['status']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('status:ok');
		});

		it('dispatches to default on empty argv', async () => {
			const handler = vi.fn();
			const cmd = command('run').action(handler);
			const app = cli('mycli').default(cmd).command(statusCommand());
			const result = await app.execute([]);

			expect(result.exitCode).toBe(0);
			expect(handler).toHaveBeenCalledOnce();
		});

		it('dispatches to default on flags-only argv', async () => {
			const app = cli('mycli').default(noArgCommand()).command(statusCommand());
			const result = await app.execute(['--port', '9090']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('serve:9090');
		});

		it('preserves typo detection — mistyped sibling shows suggestion', async () => {
			const app = cli('mycli').default(deployCommand()).command(statusCommand());
			const result = await app.execute(['stattus']);

			expect(result.exitCode).toBe(2);
			expect(result.stderr.join('')).toContain('Unknown command: stattus');
			expect(result.stderr.join('')).toContain("Did you mean 'status'?");
		});

		it('reports unknown commands instead of delegating', async () => {
			const app = cli('mycli').default(deployCommand()).command(statusCommand());
			const result = await app.execute(['deplooy']);

			expect(result.exitCode).toBe(2);
			expect(result.stderr.join('')).toContain('Unknown command: deplooy');
			expect(result.stderr.join('')).toContain("Did you mean 'deploy'?");
		});
	});

	// --- nested unknown does not delegate to default

	describe('nested unknown does not delegate to default', () => {
		it('surfaces unknown-command error inside a group instead of delegating', async () => {
			const dbCmd = group('db')
				.description('Database operations')
				.command(
					command('migrate')
						.description('Run migrations')
						.action(({ out }) => {
							out.log('migrating');
						}),
				)
				.command(
					command('seed')
						.description('Seed data')
						.action(({ out }) => {
							out.log('seeding');
						}),
				);
			const app = cli('mycli').default(deployCommand()).command(dbCmd);
			const result = await app.execute(['db', 'bogus']);

			expect(result.exitCode).toBe(2);
			expect(result.stderr.join('')).toContain('Unknown command: bogus');
		});

		it('still shows suggestion for typos inside a group', async () => {
			const dbCmd = group('db')
				.description('Database operations')
				.command(
					command('migrate')
						.description('Run migrations')
						.action(({ out }) => {
							out.log('migrating');
						}),
				);
			const app = cli('mycli').default(deployCommand()).command(dbCmd);
			const result = await app.execute(['db', 'migrat']);

			expect(result.exitCode).toBe(2);
			expect(result.stderr.join('')).toContain('Unknown command: migrat');
			expect(result.stderr.join('')).toContain("Did you mean 'migrate'?");
		});

		it('routes root args through default command', async () => {
			const dbCmd = group('db')
				.description('Database operations')
				.command(
					command('migrate')
						.description('Run migrations')
						.action(({ out }) => {
							out.log('migrating');
						}),
				);
			const app = cli('mycli').default(deployCommand()).command(dbCmd);
			const result = await app.execute(['production', '--force']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('deploy:production:forced');
		});
	});

	// --- help and version

	describe('help and version', () => {
		it('--help merges root and default help for a lone visible command', async () => {
			const app = cli('mycli').version('1.0.0').default(deployCommand());
			const result = await app.execute(['--help']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('mycli v1.0.0');
			expect(output).toContain('Usage: mycli [command] [options]');
			expect(output).toContain('Commands:');
			expect(output).toContain('deploy (default)');
			expect(output).toContain('       mycli deploy [flags] <target>');
			expect(output).toContain('\n\nDeploy to an environment\n\nArguments:');
			expect(output).not.toContain("Run 'mycli [command] --help' for more information.");
		});

		it('--help shows root help when siblings exist', async () => {
			const app = cli('mycli').version('1.0.0').default(deployCommand()).command(statusCommand());
			const result = await app.execute(['--help']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('mycli v1.0.0');
			expect(output).toContain('Commands:');
			expect(output).toContain('deploy');
			expect(output).toContain('status');
		});

		it('-h merges root and default help for a lone visible command', async () => {
			const app = cli('mycli').default(deployCommand());
			const result = await app.execute(['-h']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('Usage: mycli [command] [options]');
			expect(output).toContain('       mycli deploy [flags] <target>');
			expect(output).toContain('Commands:');
		});

		it('--version shows version, not default command', async () => {
			const app = cli('mycli').version('2.0.0').default(deployCommand());
			const result = await app.execute(['--version']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('2.0.0');
		});
	});

	// --- JSON mode

	describe('JSON mode', () => {
		it('default command receives jsonMode context via --json', async () => {
			const cmd = command('run').action(({ out }) => {
				out.json({ ok: true });
			});
			const result = await cli('mycli').default(cmd).execute(['--json']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('"ok":true');
		});

		it('merged root help still respects jsonMode', async () => {
			const result = await cli('mycli').default(deployCommand()).execute(['--help', '--json']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual([]);
			const output = result.stderr.join('');
			expect(output).toContain('Usage: mycli [command] [options]');
			expect(output).toContain('       mycli deploy [flags] <target>');
		});
	});

	// --- same-name command help

	describe('same-name command help', () => {
		it('collapses duplicate binary and command names in merged root help', async () => {
			const greet = command('greet')
				.description('Greet someone')
				.arg('name', arg.string().describe('Who to greet'))
				.flag('loud', flag.boolean().alias('l').describe('Shout the greeting'))
				.action(({ out }) => {
					out.log('hello');
				});
			const app = cli('greet').default(greet);
			const result = await app.execute(['--help']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('Usage: greet [command] [options]');
			expect(output).toContain('Commands:');
			expect(output).toContain('       greet [flags] <name>');
			expect(output).not.toContain('Usage: greet greet [flags] <name>');
		});

		it('keeps binary and command names for explicit command help', async () => {
			const greet = command('greet')
				.description('Greet someone')
				.arg('name', arg.string().describe('Who to greet'))
				.flag('loud', flag.boolean().alias('l').describe('Shout the greeting'))
				.action(({ out }) => {
					out.log('hello');
				});
			const app = cli('greet').default(greet);
			const result = await app.execute(['greet', '--help']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('Usage: greet greet [flags] <name>');
		});

		it('includes nested default-command subcommands in merged root help', async () => {
			const run = command('run')
				.description('Default runner')
				.command(command('check').description('Run checks'));
			const app = cli('mycli').default(run);
			const result = await app.execute(['--help']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('run (default)');
			expect(output).toContain('       mycli run <command>');
			expect(output).toContain('check');
		});
	});
});

// === Root help formatting with default command

describe('formatRootHelp — default command', () => {
	it('shows [command] (optional) when default exists', () => {
		const app = cli('mycli').default(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli [command] [options]');
	});

	it('shows <command> (required) when no default', () => {
		const app = cli('mycli').command(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli <command> [options]');
	});

	it('marks default command with (default) tag', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('deploy (default)');
		expect(help).not.toContain('status (default)');
	});

	it('treats hidden defaults as invisible in root help', () => {
		const app = cli('mycli').default(deployCommand().hidden()).command(statusCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli <command> [options]');
		expect(help).not.toContain('(default)');
		expect(help).not.toContain('deploy');
	});

	it('footer uses [command] when default exists', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain("Run 'mycli [command] --help' for more information.");
	});

	it('omits footer when root help is merged with the default command help', () => {
		const app = cli('mycli').default(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).not.toContain("Run 'mycli [command] --help' for more information.");
	});

	it('includes the default command usage when root help is merged', () => {
		const app = cli('mycli').default(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli [command] [options]');
		expect(help).toContain('       mycli deploy [flags] <target>');
	});

	it('footer uses <command> when no default', () => {
		const app = cli('mycli').command(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain("Run 'mycli <command> --help' for more information.");
	});

	it('aligns descriptions accounting for (default) tag width', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema);

		const lines = help.split('\n');
		const deployLine = lines.find((l) => l.includes('deploy (default)'));
		const statusLine = lines.find((l) => l.includes('status'));

		expect(deployLine).toBeDefined();
		expect(statusLine).toBeDefined();

		if (deployLine !== undefined && statusLine !== undefined) {
			const deployDescStart = deployLine.indexOf('Deploy');
			const statusDescStart = statusLine.indexOf('Show');
			expect(deployDescStart).toBe(statusDescStart);
		}
	});
});
