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
			expect(app.schema.defaultCommand?.name).toBe('deploy');
		});

		it('keeps the default command out of the commands array', () => {
			const app = cli('mycli').default(deployCommand());

			// Since v0.3 the default is the root surface, not a named subcommand.
			expect(app.schema.commands).toHaveLength(0);
			expect(app.schema.defaultCommand?.name).toBe('deploy');
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

		it('does not register the default command as a named route', async () => {
			const app = cli('mycli').default(deployCommand());
			// The default's own name is not a subcommand route: `deploy` is consumed
			// as the default command's positional argument, not dispatched by name.
			const result = await app.execute(['deploy']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('deploy:deploy:normal');
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

		it('reports unknown commands when the default accepts no positionals', async () => {
			const app = cli('mycli').default(noArgCommand()).command(statusCommand());
			const result = await app.execute(['wat']);

			expect(result.exitCode).toBe(2);
			expect(result.stderr.join('')).toContain('Unknown command: wat');
			expect(result.stderr.join('')).toContain("Run 'mycli --help' for available commands");
		});

		it('preserves typo detection — mistyped sibling shows suggestion', async () => {
			const app = cli('mycli').default(deployCommand()).command(statusCommand());
			const result = await app.execute(['stattus']);

			expect(result.exitCode).toBe(2);
			expect(result.stderr.join('')).toContain('Unknown command: stattus');
			expect(result.stderr.join('')).toContain("Did you mean 'status'?");
		});

		it('delegates default-name-like tokens to the default (default is not a route)', async () => {
			const app = cli('mycli').default(deployCommand()).command(statusCommand());
			// `deploy` is no longer a route, so a near-miss is not suggested as a
			// command — it is delegated to the default as a positional argument.
			const result = await app.execute(['deplooy']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('deploy:deplooy:normal');
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
		it('--help renders the default command inline as the root surface', async () => {
			const app = cli('mycli').version('1.0.0').default(deployCommand());
			const result = await app.execute(['--help']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('mycli v1.0.0');
			// Sole default + no subcommands → its args/flags render inline under the
			// bin name only: no `[command]` placeholder and no command name, since
			// `.default()` is not a named route.
			expect(output).toContain('Usage: mycli [flags] <target>');
			expect(output).not.toContain('mycli deploy [flags]');
			expect(output).toContain('\n\nDeploy to an environment\n\nArguments:');
			// Default is the surface, not echoed under Commands, and no footer.
			expect(output).not.toContain('(default)');
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

		it('-h renders the default command inline as the root surface', async () => {
			const app = cli('mycli').default(deployCommand());
			const result = await app.execute(['-h']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('Usage: mycli [flags] <target>');
			expect(output).not.toContain('mycli deploy [flags]');
			expect(output).toContain('Arguments:');
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

		it('root help in jsonMode emits the definition including the default command', async () => {
			const result = await cli('mycli').default(deployCommand()).execute(['--help', '--json']);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toEqual([]);
			const doc: unknown = JSON.parse(result.stdout.join(''));
			// The default command's full definition (flags and all) is present —
			// it lives only in `defaultCommand`, never in `commands`.
			expect(doc).toMatchObject({
				name: 'mycli',
				defaultCommand: {
					name: 'deploy',
					flags: { force: { kind: 'boolean' } },
					args: [{ name: 'target', kind: 'string' }],
				},
			});
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
			// Sole default whose name equals the bin → collapsed to a single usage line.
			expect(output).toContain('Usage: greet [flags] <name>');
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
			// The default group is the surface (not echoed under Commands), but its
			// own subcommands still render inline.
			expect(output).not.toContain('(default)');
			expect(output).toContain('Usage: mycli <command>');
			expect(output).not.toContain('mycli run <command>');
			expect(output).toContain('check');
		});
	});
});

// === Routed default (.default(cmd, { route: true }))

describe('.default() — routed (route: true)', () => {
	// Mirrors the claude-down shape: a `status` default that is also the
	// documented named command, beside real sibling commands.
	function sourceStatusCommand() {
		return command('status')
			.description('Show status')
			.flag('source', flag.string().describe('Source to check'))
			.action(({ flags, out }) => {
				out.log(`status:${flags.source ?? 'all'}`);
			});
	}

	function anthropicCommand() {
		return command('anthropic')
			.description('Check Anthropic')
			.action(({ out }) => {
				out.log('anthropic:ok');
			});
	}

	function routedApp() {
		return cli('claude-down')
			.default(sourceStatusCommand(), { route: true })
			.command(anthropicCommand());
	}

	// --- schema

	it('records defaultCommandRouted on the schema', () => {
		expect(routedApp().schema.defaultCommandRouted).toBe(true);
		expect(cli('claude-down').default(sourceStatusCommand()).schema.defaultCommandRouted).toBe(
			false,
		);
	});

	it('keeps a single command identity (default not duplicated into commands)', () => {
		const app = routedApp();

		// One conceptual command: `status` lives only in defaultCommand, never
		// copied into the commands array (which holds only the real siblings).
		expect(app.schema.commands.map((c) => c.name)).toEqual(['anthropic']);
		expect(app.schema.defaultCommand?.name).toBe('status');
	});

	// --- dispatch parity: root and named forms are the same surface

	it('runs the default on bare argv', async () => {
		const result = await routedApp().execute([]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('status:all');
	});

	it('routes the default command by its own name', async () => {
		const result = await routedApp().execute(['status']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('status:all');
	});

	it('accepts the same flags via root and named forms', async () => {
		const root = await routedApp().execute(['--source', 'anthropic']);
		const named = await routedApp().execute(['status', '--source', 'anthropic']);

		expect(root.stdout.join('')).toContain('status:anthropic');
		expect(named.stdout.join('')).toContain('status:anthropic');
	});

	it('still dispatches sibling commands by name', async () => {
		const result = await routedApp().execute(['anthropic']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('anthropic:ok');
	});

	// --- help

	it('lists the routed default in Commands, marked (default)', () => {
		const help = formatRootHelp(routedApp().schema);

		expect(help).toContain('Commands:');
		expect(help).toContain('status (default)');
		expect(help).toContain('anthropic');
	});

	// --- guards / non-routed parity

	it('a surface-only default is neither listed nor routable by name', async () => {
		const app = cli('claude-down').default(sourceStatusCommand()).command(anthropicCommand());

		expect(formatRootHelp(app.schema)).not.toContain('status (default)');

		// `status` is not a route; the default has no positional to absorb it,
		// so it is an unknown command rather than a dispatch to the default.
		const result = await app.execute(['status']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown command: status');
	});

	it('rejects a sibling that reuses the routed default name', () => {
		try {
			cli('claude-down')
				.default(sourceStatusCommand(), { route: true })
				.command(command('status').action(() => {}));
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(CLIError);
			expect((err as CLIError).code).toBe('DUPLICATE_COMMAND');
		}
	});
});

// === Root help formatting with default command

describe('formatRootHelp — default command', () => {
	it('shows [command] (optional) when a default and subcommands exist', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli [command] [options]');
	});

	it('omits the command placeholder for a sole default command', () => {
		const app = cli('mycli').default(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli [flags] <target>');
		expect(help).not.toContain('mycli deploy [flags]');
		expect(help).not.toContain('Usage: mycli [command] [options]');
	});

	it('shows <command> (required) when no default', () => {
		const app = cli('mycli').command(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain('Usage: mycli <command> [options]');
	});

	it('marks default command with (default) tag when shown in commands', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema, { showDefaultInCommands: true });

		expect(help).toContain('deploy (default)');
		expect(help).not.toContain('status (default)');
	});

	it('omits the default command from the commands list by default', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema);

		expect(help).not.toContain('(default)');
		expect(help).toContain('status');
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

		expect(help).toContain('Usage: mycli [flags] <target>');
		expect(help).not.toContain('mycli deploy [flags]');
	});

	it('still exposes a sole default command surface when inlineDefault is false', () => {
		// A sole default with no other surface must never collapse to a bare
		// `Usage: <bin> [options]`: that would leave its args/flags undiscoverable.
		// `inlineDefault: false` is overridden in this case.
		const app = cli('mycli').default(deployCommand());
		const help = formatRootHelp(app.schema, { inlineDefault: false });

		expect(help).toContain('Usage: mycli [flags] <target>');
		expect(help).toContain('Arguments:');
		expect(help).not.toContain('Usage: mycli [options]');
	});

	it('footer uses <command> when no default', () => {
		const app = cli('mycli').command(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain("Run 'mycli <command> --help' for more information.");
	});

	it('respects options.binName in usage, inline default, and footer', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema, { binName: 'tool' });

		expect(help).toContain('Usage: tool [command] [options]');
		expect(help).toContain('       tool [flags] <target>');
		expect(help).not.toContain('tool deploy [flags]');
		expect(help).toContain("Run 'tool [command] --help' for more information.");
		expect(help).not.toContain('Usage: mycli');
	});

	it('aligns descriptions accounting for (default) tag width', () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const help = formatRootHelp(app.schema, { showDefaultInCommands: true });

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

	// --- value-flag value matching a command name (#25)

	describe('value-flag value matching a command name (#25)', () => {
		function buildApp() {
			const status = command('status')
				.description('Show status')
				.flag('source', flag.string().alias('s').describe('Data source'))
				.action(({ flags, out }) => {
					out.log(`status:${flags.source ?? 'none'}`);
				});
			const anthropic = command('anthropic')
				.description('Anthropic source command')
				.action(({ out }) => {
					out.log('anthropic-cmd');
				});
			return cli('mycli').default(status).command(anthropic);
		}

		it('routes --source <commandName> to the default command (space form)', async () => {
			const result = await buildApp().execute(['--source', 'anthropic']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('status:anthropic');
		});

		it('routes -s <commandName> to the default command (short alias)', async () => {
			const result = await buildApp().execute(['-s', 'anthropic']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('status:anthropic');
		});

		it('inline --source=<commandName> still works', async () => {
			const result = await buildApp().execute(['--source=anthropic']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('status:anthropic');
		});

		it('still dispatches the explicit command when typed directly', async () => {
			const result = await buildApp().execute(['anthropic']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('anthropic-cmd');
		});
	});

	// --- end-of-options separator (--) interception (#28)

	describe('end-of-options separator (--) interception (#28)', () => {
		function buildApp() {
			const greet = command('greet')
				.arg('name', arg.string().variadic().optional())
				.action(({ args, out }) => {
					if (out.jsonMode) {
						out.json({ names: args.name });
						return;
					}
					out.log(`names=${JSON.stringify(args.name)}`);
				});
			return cli('mytool').version('9.9.9').default(greet);
		}

		it('treats --version after -- as a literal positional', async () => {
			const result = await buildApp().execute(['--', '--version']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['names=["--version"]\n']);
		});

		it('treats a later --version after -- as a literal positional', async () => {
			const result = await buildApp().execute(['--', 'literal', '--version']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['names=["literal","--version"]\n']);
		});

		it('treats --json after -- as a literal positional (no JSON mode)', async () => {
			const result = await buildApp().execute(['--', '--json']);
			expect(result.exitCode).toBe(0);
			// Text output with the literal, not a JSON object.
			expect(result.stdout).toEqual(['names=["--json"]\n']);
		});

		it('still intercepts --version before --', async () => {
			const result = await buildApp().execute(['--version']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['9.9.9\n']);
		});

		it('still enables JSON mode for --json before --', async () => {
			const result = await buildApp().execute(['--json', 'hi']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['{"names":["hi"]}\n']);
		});
	});
});
