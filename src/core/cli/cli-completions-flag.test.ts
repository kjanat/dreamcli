/**
 * Tests for `.completions({ as: 'flag' })`, the eager `--completions <shell>`
 * flag, environment-based shell auto-detection, and the `.help()` config knobs.
 */

import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli, createCLISchema } from './index.ts';

// === Helpers

function lspCommand() {
	return command('recipe-lsp')
		.description('Recipe pharmacological-notation language server')
		.arg(
			'transport',
			arg.enum(['stdio', 'node-ipc', 'socket']).default('stdio').describe('Transport to speak'),
		)
		.flag('port', flag.number().describe('TCP port for the socket transport'))
		.action(({ out }) => out.log('lsp running'));
}

function appWithFlag() {
	return cli('recipe-lsp').version('0.2.1').completions({ as: 'flag' }).default(lspCommand());
}

// === .completions({ as: 'flag' })

describe(".completions({ as: 'flag' })", () => {
	// --- registration

	describe('registration', () => {
		it('does not register a completions subcommand', () => {
			const app = appWithFlag();

			expect(app.schema.commands.some((c) => c.name === 'completions')).toBe(false);
			expect(app.schema.completionsFlag).toBeDefined();
			expect(app.schema.completionsFlag?.shells).toEqual(['bash', 'zsh', 'fish', 'powershell']);
		});

		it('still registers the completions subcommand for the default surface', () => {
			const app = cli('recipe-lsp').completions().default(lspCommand());

			expect(app.schema.commands.some((c) => c.name === 'completions')).toBe(true);
			expect(app.schema.completionsFlag).toBeUndefined();
		});

		it('throws when .completions() is called twice', () => {
			expect(() => cli('x').completions({ as: 'flag' }).completions()).toThrow(
				/already been called/,
			);
		});

		it('rejects a default command that reserves the --completions flag', () => {
			const colliding = command('serve')
				.flag('completions', flag.boolean())
				.action(() => {});

			expect(() => cli('x').completions({ as: 'flag' }).default(colliding)).toThrow(/reserved/);
		});

		it('rejects a command that reserves --completions in either registration order', () => {
			const colliding = command('serve')
				.flag('completions', flag.boolean())
				.action(() => {});

			expect(() => cli('x').command(colliding).completions({ as: 'flag' })).toThrow(/reserved/);
			expect(() => cli('x').completions({ as: 'flag' }).command(colliding)).toThrow(/reserved/);
		});

		it('rejects a --completions long-alias collision', () => {
			const colliding = command('serve')
				.flag('comp', flag.boolean().alias('completions'))
				.action(() => {});

			expect(() => cli('x').completions({ as: 'flag' }).default(colliding)).toThrow(/reserved/);
		});

		it('rejects a --completions negated-spelling collision', () => {
			const colliding = command('serve')
				.flag('bare', flag.boolean().default(true).negatable({ alias: 'completions' }))
				.action(() => {});

			expect(() => cli('x').completions({ as: 'flag' }).default(colliding)).toThrow(/reserved/);
		});

		it('rejects a --completions collision built through createCLISchema', () => {
			expect(() =>
				createCLISchema({
					name: 'x',
					completionsFlag: { shells: ['bash'], options: undefined },
					commands: [{ name: 'serve', flags: { completions: { kind: 'boolean' } } }],
				}),
			).toThrow(/reserved/);
		});

		it('allows a --completions flag in subcommand mode', () => {
			const colliding = command('serve')
				.flag('completions', flag.boolean())
				.action(() => {});

			expect(() => cli('x').completions().default(colliding)).not.toThrow();
		});
	});

	// --- eager flag interception

	describe('eager flag interception', () => {
		it('prints a script and exits 0 for an explicit shell', async () => {
			const result = await appWithFlag().execute(['--completions', 'zsh']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('#compdef recipe-lsp');
		});

		it('accepts the inline --completions=<shell> form', async () => {
			const result = await appWithFlag().execute(['--completions=fish']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('recipe-lsp');
		});

		it('normalizes a $SHELL-style path value', async () => {
			const result = await appWithFlag().execute(['--completions', '/usr/bin/zsh']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('#compdef recipe-lsp');
		});

		it('rejects an unknown shell with a parse error', async () => {
			const result = await appWithFlag().execute(['--completions', 'ksh']);

			expect(result.exitCode).toBe(2);
			expect(result.stderr.join('')).toContain("Unknown shell 'ksh'");
			expect(result.stderr.join('')).toContain('Valid shells: bash, zsh, fish, powershell');
		});

		it('emits structured JSON in --json mode', async () => {
			const result = await appWithFlag().execute(['--completions', 'bash', '--json']);

			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout.join(''));
			expect(parsed.shell).toBe('bash');
			expect(typeof parsed.script).toBe('string');
		});
	});

	// --- auto-detection from the environment

	describe('auto-detection from the environment', () => {
		it('detects the shell from $SHELL', async () => {
			const result = await appWithFlag().execute(['--completions'], {
				env: { SHELL: '/usr/bin/fish' },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('recipe-lsp');
		});

		it('falls back to PowerShell via $PSModulePath when $SHELL is absent', async () => {
			const result = await appWithFlag().execute(['--completions'], {
				env: { PSModulePath: 'C:\\Program Files\\PowerShell\\Modules' },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('PowerShell completion');
		});

		it('errors when no shell can be detected', async () => {
			const result = await appWithFlag().execute(['--completions'], { env: {} });

			expect(result.exitCode).toBe(1);
			expect(result.stderr.join('')).toContain('Could not detect shell');
			expect(result.stderr.join('')).toContain('recipe-lsp --completions zsh');
		});
	});

	// --- help and dispatch coexistence

	describe('help and dispatch coexistence', () => {
		it('advertises --completions <shell> in root help flags', async () => {
			const result = await appWithFlag().execute(['--help']);

			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('--completions <bash|zsh|fish|powershell>');
			expect(output).toContain('Print a shell completion script');
			// No completions subcommand, so no Commands section is rendered.
			expect(output).not.toContain('Commands:');
		});

		it('still dispatches normal invocations to the default command', async () => {
			const result = await appWithFlag().execute(['socket', '--port', '7000']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('lsp running');
		});

		it('lets a literal --completions after -- reach the default command', async () => {
			const result = await appWithFlag().execute(['--', '--completions']);

			// After `--`, `--completions` is a positional, not the eager flag; the
			// default command's enum transport rejects it rather than printing a script.
			expect(result.exitCode).toBe(2);
			expect(result.stdout.join('')).not.toContain('#compdef');
		});
	});
});

// === .help() configuration

describe('.help() configuration', () => {
	// --- helpers

	function hybrid() {
		const status = command('status')
			.description('Show status')
			.action(({ out }) => out.log('status'));
		return cli('mycli').version('1.0.0').default(lspCommand()).command(status);
	}

	it('showDefaultInCommands echoes the default under Commands', async () => {
		const result = await hybrid().help({ showDefaultInCommands: true }).execute(['--help']);

		expect(result.stdout.join('')).toContain('recipe-lsp (default)');
	});

	it('omits the default from Commands by default', async () => {
		const result = await hybrid().execute(['--help']);

		expect(result.stdout.join('')).not.toContain('(default)');
		expect(result.stdout.join('')).toContain('status');
	});

	it('footer: false suppresses the hint even with subcommands', async () => {
		const result = await hybrid().help({ footer: false }).execute(['--help']);

		expect(result.stdout.join('')).not.toContain('for more information.');
	});

	it('inlineDefault: false drops the inline default args/flags', async () => {
		const result = await hybrid().help({ inlineDefault: false }).execute(['--help']);

		const output = result.stdout.join('');
		expect(output).not.toContain('Arguments:');
		expect(output).toContain('Commands:');
	});

	it('runtime options.help overrides builder .help() config', async () => {
		const result = await hybrid()
			.help({ showDefaultInCommands: true })
			.execute(['--help'], { help: { showDefaultInCommands: false } });

		expect(result.stdout.join('')).not.toContain('(default)');
	});

	it('keeps advertising --completions even when inlineDefault is false', async () => {
		const app = cli('recipe-lsp')
			.completions({ as: 'flag' })
			.default(lspCommand())
			.help({ inlineDefault: false });
		const result = await app.execute(['--help']);

		const output = result.stdout.join('');
		// The eager flag is a root option, advertised regardless of inlineDefault.
		expect(output).toContain('--completions <bash|zsh|fish|powershell>');
		// inlineDefault: false still suppresses the default command's own flags.
		expect(output).not.toContain('--port');
	});
});
