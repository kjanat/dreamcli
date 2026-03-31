/**
 * Tests for the CLI entry point builder — cli(), dispatch, help, version.
 */

import { describe, expect, it, vi } from 'vitest';
import { createTestAdapter, ExitError } from '#internals/runtime/index.ts';
import { ParseError } from '#internals/core/errors/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import type { CommandMeta } from '#internals/core/schema/command.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { CLIBuilder, cli, formatRootHelp } from './index.ts';

// ---------------------------------------------------------------------------
// Test commands
// ---------------------------------------------------------------------------

function deployCommand() {
	return command('deploy')
		.description('Deploy to an environment')
		.arg('target', arg.string().describe('Deploy target'))
		.flag('force', flag.boolean().alias('f').describe('Force deployment'))
		.flag('region', flag.enum(['us', 'eu', 'ap']).describe('Target region'))
		.action(({ args, flags, out }) => {
			out.log(`Deploying ${args.target} to ${flags.region ?? 'default'}`);
			if (flags.force) out.log('(forced)');
		});
}

function loginCommand() {
	return command('login')
		.description('Authenticate with the service')
		.flag('token', flag.string().describe('Auth token'))
		.action(({ flags, out }) => {
			out.log(`Logged in with token: ${flags.token ?? 'none'}`);
		});
}

function secretCommand() {
	return command('internal')
		.description('Internal debug command')
		.hidden()
		.action(({ out }) => {
			out.log('secret output');
		});
}

function noActionCommand() {
	return command('broken').description('Command with no action handler');
}

function aliasedCommand() {
	return command('status')
		.alias('st')
		.alias('info')
		.description('Show status')
		.action(({ out }) => {
			out.log('all good');
		});
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('cli() factory', () => {
	it('creates a CLIBuilder with the given name', () => {
		const app = cli('mycli');
		expect(app).toBeInstanceOf(CLIBuilder);
		expect(app.schema.name).toBe('mycli');
	});

	it('accepts an options object with an explicit name', () => {
		const app = cli({ name: 'mycli' });
		expect(app).toBeInstanceOf(CLIBuilder);
		expect(app.schema.name).toBe('mycli');
		expect(app.schema.inheritName).toBe(false);
	});

	it('enables runtime name inheritance from the options object', () => {
		const app = cli({ inherit: true });
		expect(app.schema.name).toBe('cli');
		expect(app.schema.inheritName).toBe(true);
	});

	it('starts with undefined version and description', () => {
		const app = cli('mycli');
		expect(app.schema.version).toBeUndefined();
		expect(app.schema.description).toBeUndefined();
	});

	it('starts with no commands', () => {
		const app = cli('mycli');
		expect(app.schema.commands).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('CLIBuilder immutability', () => {
	it('.version() returns a new builder', () => {
		const a = cli('mycli');
		const b = a.version('1.0.0');
		expect(a).not.toBe(b);
		expect(a.schema.version).toBeUndefined();
		expect(b.schema.version).toBe('1.0.0');
	});

	it('.description() returns a new builder', () => {
		const a = cli('mycli');
		const b = a.description('My tool');
		expect(a).not.toBe(b);
		expect(a.schema.description).toBeUndefined();
		expect(b.schema.description).toBe('My tool');
	});

	it('.command() returns a new builder', () => {
		const a = cli('mycli');
		const b = a.command(deployCommand());
		expect(a).not.toBe(b);
		expect(a.schema.commands).toHaveLength(0);
		expect(b.schema.commands).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

describe('--version flag', () => {
	it('outputs version and exits 0', async () => {
		const app = cli('mycli').version('2.5.0').command(deployCommand());
		const result = await app.execute(['--version']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['2.5.0\n']);
		expect(result.stderr).toEqual([]);
		expect(result.error).toBeUndefined();
	});

	it('supports -V short flag', async () => {
		const app = cli('mycli').version('1.0.0');
		const result = await app.execute(['-V']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['1.0.0\n']);
	});

	it('does not swallow --version when no version is configured', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', '--version']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown flag --version');
	});

	it('does not swallow -V when the default command handles argv', async () => {
		const app = cli('mycli').default(deployCommand());
		const result = await app.execute(['-V']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown flag -V');
	});

	it('--version takes precedence over commands', async () => {
		const app = cli('mycli').version('3.0.0').command(deployCommand());
		const result = await app.execute(['deploy', '--version']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['3.0.0\n']);
	});
});

// ---------------------------------------------------------------------------
// Root help
// ---------------------------------------------------------------------------

describe('root help', () => {
	it('shows help when no args provided', async () => {
		const app = cli('mycli').version('1.0.0').command(deployCommand());
		const result = await app.execute([]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('mycli v1.0.0');
		expect(result.stdout.join('')).toContain('Usage: mycli <command> [options]');
		expect(result.stdout.join('')).toContain('deploy');
	});

	it('shows help with --help flag', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Commands:');
		expect(result.stdout.join('')).toContain('deploy');
	});

	it('shows help with -h short flag', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['-h']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Commands:');
	});

	it('includes description when set', async () => {
		const app = cli('mycli').description('My awesome tool').command(deployCommand());
		const result = await app.execute(['--help']);

		expect(result.stdout.join('')).toContain('My awesome tool');
	});

	it('shows footer with help hint', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['--help']);

		expect(result.stdout.join('')).toContain("Run 'mycli <command> --help' for more information.");
	});

	it('hides hidden commands from help', async () => {
		const app = cli('mycli').command(deployCommand()).command(secretCommand());
		const result = await app.execute(['--help']);

		const output = result.stdout.join('');
		expect(output).toContain('deploy');
		expect(output).not.toContain('internal');
	});

	it('lists multiple commands', async () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand());
		const result = await app.execute(['--help']);

		const output = result.stdout.join('');
		expect(output).toContain('deploy');
		expect(output).toContain('login');
	});

	it('rejects unknown root flag', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['--unknown-flag']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('UNKNOWN_FLAG');
		expect(result.stderr.join('')).toContain('Unknown flag --unknown-flag');
	});
});

// ---------------------------------------------------------------------------
// Runtime name inheritance
// ---------------------------------------------------------------------------

describe('CLIBuilder.run — runtime name inheritance', () => {
	it('uses the invoked entry basename in root help during .run()', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', '/usr/bin/xxxhotbabe.ts', '--help'],
			stdout: (line) => stdoutLines.push(line),
		});
		const app = cli({ inherit: true }).command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (err: unknown) {
			if (!(err instanceof ExitError)) throw err;
			expect(err.code).toBe(0);
		}

		const output = stdoutLines.join('');
		expect(output).toContain('Usage: xxxhotbabe.ts <command> [options]');
		expect(output).not.toContain('Usage: cli <command> [options]');
	});

	it('falls back to the configured name when no invocation name can be inferred', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['deno', 'run', '--help'],
			stdout: (line) => stdoutLines.push(line),
		});
		const app = cli({ name: 'fallback', inherit: true }).command(deployCommand());

		try {
			await app.run({ adapter });
		} catch (err: unknown) {
			if (!(err instanceof ExitError)) throw err;
			expect(err.code).toBe(0);
		}

		const output = stdoutLines.join('');
		expect(output).toContain('Usage: fallback <command> [options]');
	});
});

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

describe('command dispatch', () => {
	it('dispatches to the correct command by name', async () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand());
		const result = await app.execute(['deploy', 'production', '--force']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Deploying production');
		expect(result.stdout.join('')).toContain('(forced)');
	});

	it('dispatches to the correct command when multiple exist', async () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand());
		const result = await app.execute(['login', '--token', 'abc123']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Logged in with token: abc123');
	});

	it('passes remaining argv (not command name) to the command', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', 'staging', '--region', 'eu']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Deploying staging to eu');
	});

	it('dispatches to hidden commands', async () => {
		const app = cli('mycli').command(secretCommand());
		const result = await app.execute(['internal']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('secret output');
	});

	it('dispatches by alias', async () => {
		const app = cli('mycli').command(aliasedCommand());
		const result = await app.execute(['st']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('all good');
	});

	it('dispatches by second alias', async () => {
		const app = cli('mycli').command(aliasedCommand());
		const result = await app.execute(['info']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('all good');
	});
});

// ---------------------------------------------------------------------------
// Per-command --help
// ---------------------------------------------------------------------------

describe('per-command --help', () => {
	it('shows command help text', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', '--help']);

		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		// runCommand handles --help internally, should show per-command help
		expect(output).toContain('deploy');
		expect(output).toContain('Deploy to an environment');
	});

	it('uses CLI name as binName in command help', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', '--help']);

		expect(result.exitCode).toBe(0);
		// binName should be passed through so help shows "mycli deploy"
		expect(result.stdout.join('')).toContain('mycli');
	});
});

// ---------------------------------------------------------------------------
// `help` virtual subcommand
// ---------------------------------------------------------------------------

describe('help virtual subcommand', () => {
	it('bare `help` shows root help', async () => {
		const app = cli('mycli').version('1.0.0').command(deployCommand()).command(loginCommand());
		const result = await app.execute(['help']);

		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('mycli');
		expect(output).toContain('deploy');
		expect(output).toContain('login');
	});

	it('`help <command>` shows same output as `<command> --help`', async () => {
		const app = cli('mycli').command(deployCommand());
		const viaHelp = await app.execute(['help', 'deploy']);
		const viaFlag = await app.execute(['deploy', '--help']);

		expect(viaHelp.exitCode).toBe(0);
		expect(viaFlag.exitCode).toBe(0);
		expect(viaHelp.stdout).toEqual(viaFlag.stdout);
	});

	it('`help <unknown>` shows unknown command error', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['help', 'nope']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown command: nope');
	});

	it('defers to real `help` command when registered', async () => {
		const helpCmd = command('help')
			.description('Custom help')
			.action(({ out }) => {
				out.log('custom help output');
			});
		const app = cli('mycli').command(helpCmd).command(deployCommand());
		const result = await app.execute(['help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('custom help output');
	});

	it('defers to alias `help` when registered', async () => {
		const infoCmd = command('info')
			.alias('help')
			.description('Info command aliased as help')
			.action(({ out }) => {
				out.log('info output');
			});
		const app = cli('mycli').command(infoCmd).command(deployCommand());
		const result = await app.execute(['help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('info output');
	});

	it('`help help` terminates — shows root help', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['help', 'help']);

		// help help → ['help', '--help'] → firstArg='help', rest=['--help']
		// → ['--help', '--help'] → firstArg='--help' → root help
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('mycli');
		expect(output).toContain('deploy');
	});

	it('`help` with default and sibling commands still shows root help', async () => {
		const defaultCmd = command('run')
			.description('Default runner')
			.action(({ out }) => {
				out.log('running');
			});
		const app = cli('mycli').command(deployCommand()).default(defaultCmd);
		const result = await app.execute(['help']);

		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('mycli');
		expect(output).toContain('deploy');
	});

	it('bare `help` shows merged root and default command help for single-command default CLIs', async () => {
		const defaultCmd = command('run')
			.description('Default runner')
			.arg('target', arg.string().describe('Run target'))
			.action(({ out }) => {
				out.log('running');
			});
		const app = cli('mycli').default(defaultCmd);
		const result = await app.execute(['help']);

		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('mycli');
		expect(output).toContain('Usage: mycli [command] [options]');
		expect(output).toContain('Commands:');
		expect(output).toContain('       mycli run <target>');
		expect(output).toContain('Default runner');
	});
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
	it('returns error for unknown command', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['doesnotexist']);

		expect(result.exitCode).toBe(2);
		expect(result.error).toBeDefined();
		expect(result.error).toBeInstanceOf(ParseError);
		expect(result.stderr.join('')).toContain('Unknown command: doesnotexist');
	});

	it('suggests similar command for typos', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['depoy']); // typo for "deploy"

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain("Did you mean 'deploy'?");
	});

	it('shows generic help hint when no close match', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['xxxxxxxxx']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain("Run 'mycli --help'");
	});

	it('returns error when no commands registered and command given', async () => {
		const app = cli('mycli');
		const result = await app.execute(['deploy']);

		expect(result.exitCode).toBe(1);
		expect(result.error).toBeDefined();
		expect(result.stderr.join('')).toContain('No commands registered');
	});

	it('returns error for command without action handler', async () => {
		const app = cli('mycli').command(noActionCommand());
		const result = await app.execute(['broken']);

		expect(result.exitCode).toBe(1);
		expect(result.error).toBeDefined();
		expect(result.stderr.join('')).toContain('no action handler');
	});

	it('propagates parse errors from the command', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', '--unknown']);

		expect(result.exitCode).toBe(2);
		expect(result.error).toBeDefined();
	});

	it('propagates validation errors from the command', async () => {
		const app = cli('mycli').command(deployCommand());
		// deploy requires 'target' arg
		const result = await app.execute(['deploy']);

		expect(result.exitCode).toBe(2);
		expect(result.error).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Async handlers
// ---------------------------------------------------------------------------

describe('async command handlers', () => {
	it('awaits async handlers', async () => {
		const asyncCmd = command('fetch').action(async ({ out }) => {
			await Promise.resolve();
			out.log('fetched');
		});

		const app = cli('mycli').command(asyncCmd);
		const result = await app.execute(['fetch']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('fetched');
	});
});

// ---------------------------------------------------------------------------
// Options passthrough
// ---------------------------------------------------------------------------

describe('options passthrough', () => {
	it('passes verbosity through to commands', async () => {
		const verboseCmd = command('talk').action(({ out }) => {
			out.info('info message');
			out.log('log message');
		});

		const app = cli('mycli').command(verboseCmd);
		const quietResult = await app.execute(['talk'], { verbosity: 'quiet' });

		// info suppressed in quiet mode
		expect(quietResult.stdout.join('')).toContain('log message');
		expect(quietResult.stdout.join('')).not.toContain('info message');
	});

	it('passes normal verbosity', async () => {
		const verboseCmd = command('talk').action(({ out }) => {
			out.info('info message');
			out.log('log message');
		});

		const app = cli('mycli').command(verboseCmd);
		const normalResult = await app.execute(['talk'], { verbosity: 'normal' });

		expect(normalResult.stdout.join('')).toContain('log message');
		expect(normalResult.stdout.join('')).toContain('info message');
	});
});

// ---------------------------------------------------------------------------
// Complex composition
// ---------------------------------------------------------------------------

describe('complex CLI composition', () => {
	it('handles a full multi-command CLI', async () => {
		const app = cli('myapp')
			.version('3.2.1')
			.description('My application')
			.command(deployCommand())
			.command(loginCommand())
			.command(aliasedCommand())
			.command(secretCommand());

		// Version
		const vResult = await app.execute(['--version']);
		expect(vResult.exitCode).toBe(0);
		expect(vResult.stdout).toEqual(['3.2.1\n']);

		// Root help — visible commands only
		const hResult = await app.execute(['-h']);
		const hOutput = hResult.stdout.join('');
		expect(hOutput).toContain('deploy');
		expect(hOutput).toContain('login');
		expect(hOutput).toContain('status');
		expect(hOutput).not.toContain('internal');

		// Dispatch deploy
		const dResult = await app.execute(['deploy', 'prod', '--region', 'us']);
		expect(dResult.exitCode).toBe(0);
		expect(dResult.stdout.join('')).toContain('Deploying prod to us');

		// Dispatch login
		const lResult = await app.execute(['login']);
		expect(lResult.exitCode).toBe(0);
		expect(lResult.stdout.join('')).toContain('Logged in');

		// Dispatch by alias
		const sResult = await app.execute(['st']);
		expect(sResult.exitCode).toBe(0);
		expect(sResult.stdout.join('')).toContain('all good');
	});
});

// ---------------------------------------------------------------------------
// formatRootHelp
// ---------------------------------------------------------------------------

describe('formatRootHelp', () => {
	it('includes name and version', () => {
		const app = cli('mycli').version('1.0.0').command(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('mycli v1.0.0');
	});

	it('shows name only when no version', () => {
		const app = cli('mycli').command(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toMatch(/^mycli\n/);
		expect(help).not.toContain(' v');
	});

	it('includes description when set', () => {
		const app = cli('mycli').description('A great tool');
		const help = formatRootHelp(app.schema);

		expect(help).toContain('A great tool');
	});

	it('includes usage line', () => {
		const app = cli('mycli');
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli <command> [options]');
	});

	it('lists visible commands with descriptions', () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Commands:');
		expect(help).toContain('deploy');
		expect(help).toContain('Deploy to an environment');
		expect(help).toContain('login');
		expect(help).toContain('Authenticate with the service');
	});

	it('omits hidden commands', () => {
		const app = cli('mycli').command(secretCommand());
		const help = formatRootHelp(app.schema);

		expect(help).not.toContain('internal');
		expect(help).not.toContain('Commands:');
	});

	it('aligns command descriptions', () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand());
		const help = formatRootHelp(app.schema);

		// Both descriptions should start at the same column
		const lines = help.split('\n');
		const deployLine = lines.find((l) => l.includes('deploy') && l.includes('Deploy'));
		const loginLine = lines.find((l) => l.includes('login') && l.includes('Authenticate'));

		expect(deployLine).toBeDefined();
		expect(loginLine).toBeDefined();

		// The description start columns should be equal
		if (deployLine !== undefined && loginLine !== undefined) {
			const deployDescStart = deployLine.indexOf('Deploy');
			const loginDescStart = loginLine.indexOf('Authenticate');
			expect(deployDescStart).toBe(loginDescStart);
		}
	});

	it('includes footer hint', () => {
		const app = cli('mycli').command(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain("Run 'mycli <command> --help' for more information.");
	});

	it('respects width option', () => {
		const longDesc = command('cmd').description('A '.repeat(100).trim());
		const app = cli('mycli').command(longDesc.action(({ out }) => out.log('ok')));
		const help = formatRootHelp(app.schema, { width: 40 });

		// Should wrap at narrow width
		const lines = help.split('\n');
		for (const line of lines) {
			// Allow a small tolerance for very long words
			expect(line.length).toBeLessThanOrEqual(50);
		}
	});
});

// ---------------------------------------------------------------------------
// Builder chaining
// ---------------------------------------------------------------------------

describe('builder chaining', () => {
	it('supports fluent chaining', async () => {
		const result = await cli('mycli')
			.version('1.0.0')
			.description('My tool')
			.command(
				command('greet')
					.arg('name', arg.string())
					.action(({ args, out }) => {
						out.log(`Hi ${args.name}`);
					}),
			)
			.execute(['greet', 'World']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Hi World');
	});

	it('accumulates commands across multiple .command() calls', () => {
		const app = cli('mycli')
			.command(deployCommand())
			.command(loginCommand())
			.command(aliasedCommand());

		expect(app.schema.commands).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
	it('empty argv shows help', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute([]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Commands:');
	});

	it('command with empty argv (no args to command)', async () => {
		const noArgCmd = command('ping').action(({ out }) => {
			out.log('pong');
		});

		const app = cli('mycli').command(noArgCmd);
		const result = await app.execute(['ping']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('pong');
	});

	it('--version before command name still shows version', async () => {
		const app = cli('mycli').version('1.0.0').command(deployCommand());
		const result = await app.execute(['--version', 'deploy']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['1.0.0\n']);
	});

	it('never throws — all errors caught', async () => {
		const app = cli('mycli').command(deployCommand());

		// This should not throw
		const result = await app.execute(['nonexistent']);
		expect(result.exitCode).toBeGreaterThan(0);
		expect(result.error).toBeDefined();
	});

	it('handler error is caught and structured', async () => {
		const failCmd = command('fail').action(() => {
			throw new Error('boom');
		});

		const app = cli('mycli').command(failCmd);
		const result = await app.execute(['fail']);

		expect(result.exitCode).toBe(1);
		expect(result.error).toBeDefined();
		expect(result.stderr.join('')).toContain('boom');
	});

	it('handler async error is caught', async () => {
		const failCmd = command('fail').action(async () => {
			throw new Error('async boom');
		});

		const app = cli('mycli').command(failCmd);
		const result = await app.execute(['fail']);

		expect(result.exitCode).toBe(1);
		expect(result.stderr.join('')).toContain('async boom');
	});
});

// ---------------------------------------------------------------------------
// Module loading (public surface)
// ---------------------------------------------------------------------------

describe('public exports', () => {
	it('exports cli factory', async () => {
		const { cli: cliExport } = await import('#internals/index.ts');
		expect(typeof cliExport).toBe('function');
	});

	it('exports CLIBuilder class', async () => {
		const { CLIBuilder: CLIBuilderExport } = await import('#internals/index.ts');
		expect(typeof CLIBuilderExport).toBe('function');
	});
});

// ===========================================================================
// CommandMeta — dispatch populates meta from CLI schema
// ===========================================================================

describe('cli.execute — meta', () => {
	it('populates meta with CLI name, version, and command name', async () => {
		const handler = vi.fn();
		const cmd = command('deploy').action(handler);
		const app = cli('myapp').version('1.0.0').command(cmd);

		await app.execute(['deploy']);

		expect(handler).toHaveBeenCalledOnce();
		const firstCall = handler.mock.calls[0];
		if (firstCall === undefined) {
			throw new Error('expected handler to be called once');
		}
		const meta: CommandMeta = firstCall[0].meta;
		expect(meta).toEqual({
			name: 'myapp',
			bin: 'myapp',
			version: '1.0.0',
			command: 'deploy',
		});
	});

	it('uses help.binName for meta.bin', async () => {
		const handler = vi.fn();
		const cmd = command('deploy').action(handler);
		const app = cli('myapp').version('1.0.0').command(cmd);

		await app.execute(['deploy'], { help: { binName: 'my-app' } });

		expect(handler).toHaveBeenCalledOnce();
		const firstCall = handler.mock.calls[0];
		if (firstCall === undefined) {
			throw new Error('expected handler to be called once');
		}
		const meta: CommandMeta = firstCall[0].meta;
		expect(meta.bin).toBe('my-app');
		expect(meta.name).toBe('myapp');
	});

	it('meta.version is undefined when CLI has no version', async () => {
		const handler = vi.fn();
		const cmd = command('deploy').action(handler);
		const app = cli('myapp').command(cmd);

		await app.execute(['deploy']);

		expect(handler).toHaveBeenCalledOnce();
		const firstCall = handler.mock.calls[0];
		if (firstCall === undefined) {
			throw new Error('expected handler to be called once');
		}
		const meta: CommandMeta = firstCall[0].meta;
		expect(meta.version).toBeUndefined();
	});

	it('populates meta.command for default command', async () => {
		const handler = vi.fn();
		const cmd = command('main').action(handler);
		const app = cli('myapp').version('1.0.0').default(cmd);

		await app.execute([]);

		expect(handler).toHaveBeenCalledOnce();
		const firstCall = handler.mock.calls[0];
		if (firstCall === undefined) {
			throw new Error('expected handler to be called once');
		}
		const meta: CommandMeta = firstCall[0].meta;
		expect(meta.command).toBe('main');
		expect(meta.name).toBe('myapp');
	});
});
