/**
 * Tests for the built-in .completions() subcommand on CLIBuilder.
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli } from './index.ts';

// === Test helpers

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

function serveDefaultCommand() {
	return command('serve')
		.description('Start the server')
		.flag('port', flag.number().alias('p').describe('Port'))
		.flag('verbose', flag.boolean().propagate().describe('Verbose logging'))
		.command(
			command('inspect')
				.description('Inspect the running server')
				.flag('childOnly', flag.boolean().describe('Child-only flag'))
				.action(({ out }) => {
					out.log('inspect');
				}),
		)
		.action(({ out }) => {
			out.log('serve');
		});
}

function statusCommand() {
	return command('status')
		.description('Show current status')
		.action(({ out }) => {
			out.log('status');
		});
}

import {
	extractBashRootWords,
	extractFishCompletionLines,
	extractZshRootFunction,
} from '#internals/core/completion/completion-test-helpers.ts';

// === .completions()

describe('.completions()', () => {
	// --- builder registration

	describe('builder registration', () => {
		it('registers a "completions" subcommand', () => {
			const app = cli('mycli').completions();
			const names = app.schema.commands.map((c) => c.schema.name);
			expect(names).toContain('completions');
		});

		it('returns a new CLIBuilder (immutability)', () => {
			const a = cli('mycli');
			const b = a.completions();
			expect(a).not.toBe(b);
			expect(a.schema.commands).toHaveLength(0);
			expect(b.schema.commands).toHaveLength(1);
		});

		it('preserves previously registered commands', () => {
			const app = cli('mycli').command(deployCommand()).command(loginCommand()).completions();
			const names = app.schema.commands.map((c) => c.schema.name);
			expect(names).toEqual(['deploy', 'login', 'completions']);
		});
	});

	// --- double call guard

	describe('double call guard', () => {
		it('throws CLIError on second .completions() call', () => {
			const app = cli('mycli').completions();
			expect(() => app.completions()).toThrow(CLIError);
		});

		it('includes DUPLICATE_COMMAND code', () => {
			const app = cli('mycli').completions();
			try {
				app.completions();
				expect.fail('should have thrown');
			} catch (e) {
				expect(e).toBeInstanceOf(CLIError);
				expect((e as CLIError).code).toBe('DUPLICATE_COMMAND');
			}
		});

		it('throws even with other commands registered', () => {
			const app = cli('mycli').command(deployCommand()).completions();
			expect(() => app.completions()).toThrow(CLIError);
		});
	});

	// --- bash output

	describe('bash output', () => {
		it('generates the script', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'bash']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.length).toBeGreaterThan(0);
			const output = result.stdout.join('');
			expect(output).toContain('#!/usr/bin/env bash');
			expect(output).toContain('complete -F');
			expect(output).toContain('mycli');
		});

		it('includes registered commands', async () => {
			const app = cli('mycli').command(deployCommand()).command(loginCommand()).completions();
			const result = await app.execute(['completions', 'bash']);
			const output = result.stdout.join('');
			expect(output).toContain('deploy');
			expect(output).toContain('login');
		});

		it('includes flag names', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'bash']);
			const output = result.stdout.join('');
			expect(output).toContain('--force');
			expect(output).toContain('--region');
		});

		it('excludes the completions command itself', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'bash']);
			const output = result.stdout.join('');
			// The captured schema is pre-completions, so 'completions' command
			// should not appear as a completable subcommand in the generated script.
			// The `complete -F` line and function name use the CLI name, not command names.
			// Check that 'completions' doesn't appear in the subcommand word list
			// but 'deploy' does.
			expect(output).toContain('deploy');
			// The word 'completions' appears in comments ("# Bash completion for mycli")
			// but should NOT appear in the case/compgen subcommand dispatch
			expect(output).not.toMatch(/compgen -W '[^']*completions/);
		});

		describe('root completion policy', () => {
			it('keeps hybrid roots command-centric by default', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions();
				const result = await app.execute(['completions', 'bash']);
				const rootWords = extractBashRootWords(result.stdout.join(''));

				expect(rootWords).toEqual(['serve', 'status', '--help']);
			});

			it('surfaces default flags in surface mode', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions({ rootMode: 'surface' });
				const result = await app.execute(['completions', 'bash']);
				const rootWords = extractBashRootWords(result.stdout.join(''));

				expect(rootWords).toContain('--port');
				expect(rootWords).toContain('-p');
				expect(rootWords).toContain('--verbose');
				expect(rootWords).not.toContain('--childOnly');
			});

			it('surfaces default flags for a lone visible default', async () => {
				const app = cli('mycli').default(serveDefaultCommand()).completions();
				const result = await app.execute(['completions', 'bash']);
				const rootWords = extractBashRootWords(result.stdout.join(''));

				expect(rootWords).toContain('serve');
				expect(rootWords).toContain('--help');
				expect(rootWords).toContain('--port');
				expect(rootWords).toContain('-p');
				expect(rootWords).toContain('--verbose');
				expect(rootWords).not.toContain('--childOnly');
			});
		});
	});

	// --- zsh output

	describe('zsh output', () => {
		it('generates the script', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'zsh']);
			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('#compdef mycli');
			expect(output).toContain('_mycli');
		});

		it('includes registered commands', async () => {
			const app = cli('mycli').command(deployCommand()).command(loginCommand()).completions();
			const result = await app.execute(['completions', 'zsh']);
			const output = result.stdout.join('');
			expect(output).toContain('deploy');
			expect(output).toContain('login');
		});

		it('includes flag specs', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'zsh']);
			const output = result.stdout.join('');
			expect(output).toContain('--force');
			expect(output).toContain('--region');
		});

		describe('root completion policy', () => {
			it('keeps hybrid roots command-centric by default', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions();
				const result = await app.execute(['completions', 'zsh']);
				const rootFunction = extractZshRootFunction(result.stdout.join(''), '_mycli');

				expect(rootFunction).toContain("'--help[Show help text]'");
				expect(rootFunction).toContain("'serve:Start the server'");
				expect(rootFunction).toContain("'status:Show current status'");
				expect(rootFunction).not.toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
			});

			it('surfaces default flags in surface mode', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions({ rootMode: 'surface' });
				const result = await app.execute(['completions', 'zsh']);
				const rootFunction = extractZshRootFunction(result.stdout.join(''), '_mycli');

				expect(rootFunction).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
				expect(rootFunction).toContain("'--verbose[Verbose logging]'");
				expect(rootFunction).not.toContain("'--childOnly[Child-only flag]'");
			});

			it('surfaces default flags for a lone visible default', async () => {
				const app = cli('mycli').default(serveDefaultCommand()).completions();
				const result = await app.execute(['completions', 'zsh']);
				const rootFunction = extractZshRootFunction(result.stdout.join(''), '_mycli');

				expect(rootFunction).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
				expect(rootFunction).toContain("'--verbose[Verbose logging]'");
				expect(rootFunction).not.toContain("'--childOnly[Child-only flag]'");
			});
		});
	});

	// --- error handling

	describe('error handling', () => {
		it('errors when shell arg is missing', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error).toBeDefined();
		});

		it('resolves shell from $SHELL env var', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions'], { env: { SHELL: '/bin/zsh' } });
			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('#compdef mycli');
		});

		it('normalizes $SHELL path to shell name', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions'], {
				env: { SHELL: '/usr/local/bin/bash' },
			});
			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('#!/usr/bin/env bash');
		});

		it('normalizes pwsh.exe $SHELL path to powershell', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions'], {
				env: { SHELL: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('# PowerShell completion for mycli');
		});

		it('accepts fish', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'fish']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('# Fish completion for mycli');
		});

		it('accepts powershell', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'powershell']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toContain('# PowerShell completion for mycli');
		});

		it('errors when shell arg has unsupported value', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'nushell']);
			expect(result.exitCode).not.toBe(0);
			expect(result.error).toBeDefined();
		});

		it('shows help with --help flag', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', '--help']);
			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('shell');
			expect(output).toContain('completions');
		});
	});

	// --- schema snapshot

	describe('schema snapshot', () => {
		it('captures commands registered before .completions()', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'bash']);
			const output = result.stdout.join('');
			expect(output).toContain('deploy');
		});

		it('does not include commands registered after .completions()', async () => {
			const app = cli('mycli').command(deployCommand()).completions().command(loginCommand());
			const result = await app.execute(['completions', 'bash']);
			const output = result.stdout.join('');
			expect(output).toContain('deploy');
			// login was registered after .completions(), so not in the snapshot
			expect(output).not.toMatch(/compgen -W '[^']*login/);
		});

		it('works with no other commands registered', async () => {
			const app = cli('mycli').completions();
			const bashResult = await app.execute(['completions', 'bash']);
			expect(bashResult.exitCode).toBe(0);
			const bashOutput = bashResult.stdout.join('');
			expect(bashOutput).toContain('#!/usr/bin/env bash');
			expect(bashOutput).toContain('complete -F');

			const zshResult = await app.execute(['completions', 'zsh']);
			expect(zshResult.exitCode).toBe(0);
			const zshOutput = zshResult.stdout.join('');
			expect(zshOutput).toContain('#compdef mycli');
			expect(zshOutput).toContain('_mycli() {');

			const fishResult = await app.execute(['completions', 'fish']);
			expect(fishResult.exitCode).toBe(0);
			const fishOutput = fishResult.stdout.join('');
			expect(fishOutput).toContain('# Fish completion for mycli');
			expect(fishOutput).toContain('complete -c mycli -f');

			const powershellResult = await app.execute(['completions', 'powershell']);
			expect(powershellResult.exitCode).toBe(0);
			const powershellOutput = powershellResult.stdout.join('');
			expect(powershellOutput).toContain('# PowerShell completion for mycli');
			expect(powershellOutput).toContain('Register-ArgumentCompleter -Native -CommandName');
		});
	});

	// --- --json mode

	describe('--json mode', () => {
		it('wraps bash scripts in JSON', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'bash', '--json']);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.length).toBe(1);
			const parsed = JSON.parse(result.stdout[0] ?? '');
			expect(parsed).toHaveProperty('shell', 'bash');
			expect(parsed).toHaveProperty('script');
			expect(parsed.script).toContain('#!/usr/bin/env bash');
			expect(parsed.script).toContain('complete -F');
			// stderr should be empty — script goes to stdout via json()
			expect(result.stderr).toEqual([]);
		});

		it('wraps zsh scripts in JSON', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'zsh', '--json']);
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout[0] ?? '');
			expect(parsed.script).toContain('#compdef mycli');
			expect(parsed.script).toContain('_mycli');
		});

		it('wraps fish scripts in JSON', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'fish', '--json']);
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout[0] ?? '');
			expect(parsed.script).toContain('# Fish completion for mycli');
			expect(parsed.script).toContain('complete -c mycli -f');
		});

		it('writes raw scripts in normal mode', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'bash']);
			expect(result.exitCode).toBe(0);
			// Raw script directly on stdout (not wrapped in JSON)
			const output = result.stdout.join('');
			expect(output).toContain('#!/usr/bin/env bash');
			// Should not be JSON
			expect(() => JSON.parse(output)).toThrow();
		});

		it('also respects jsonMode via options', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'bash'], { jsonMode: true });
			expect(result.exitCode).toBe(0);
			expect(result.stdout.length).toBe(1);
			const parsed = JSON.parse(result.stdout[0] ?? '');
			expect(parsed.script).toContain('complete -F');
		});
	});

	// --- alias dispatch

	describe('alias dispatch', () => {
		it('dispatches via "completion" (singular) alias', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completion', 'bash']);
			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('#!/usr/bin/env bash');
		});
	});

	// --- install instruction headers

	describe('install instruction headers', () => {
		describe('bash', () => {
			it('includes install instructions', async () => {
				const app = cli('mycli').command(deployCommand()).completions();
				const result = await app.execute(['completions', 'bash']);
				const output = result.stdout.join('');
				expect(output).toContain('source <(mycli completions bash)');
				expect(output).toContain('/etc/bash_completion.d/mycli');
			});
		});

		describe('zsh', () => {
			it('includes install instructions', async () => {
				const app = cli('mycli').command(deployCommand()).completions();
				const result = await app.execute(['completions', 'zsh']);
				const output = result.stdout.join('');
				expect(output).toContain('source <(mycli completions zsh)');
				expect(output).toContain('fpath');
			});
		});

		describe('fish', () => {
			it('includes install instructions', async () => {
				const app = cli('mycli').command(deployCommand()).completions();
				const result = await app.execute(['completions', 'fish']);
				const output = result.stdout.join('');
				expect(output).toContain('source (mycli completions fish | psub)');
				expect(output).toContain('~/.config/fish/completions/mycli.fish');
			});
		});
	});

	// --- root help

	describe('root help', () => {
		it('completions command appears in root --help', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['--help']);
			const output = result.stdout.join('');
			expect(output).toContain('completions');
			expect(output).toContain('Generate shell completion script');
		});
	});

	// --- fish output

	describe('fish output', () => {
		it('generates the script', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', 'fish']);
			expect(result.exitCode).toBe(0);
			const output = result.stdout.join('');
			expect(output).toContain('# Fish completion for mycli');
			expect(output).toContain('source (mycli completions fish | psub)');
			expect(output).toContain('complete -c mycli -f');
		});

		it('includes nested propagated flags', async () => {
			const app = cli('mycli').default(serveDefaultCommand()).completions({ rootMode: 'surface' });
			const result = await app.execute(['completions', 'fish']);
			const rootLines = extractFishCompletionLines(
				result.stdout.join(''),
				'__mycli_completions_path_is',
				'',
			).join('\n');

			expect(rootLines).toContain('-l port');
			expect(rootLines).toContain('-s p');
			expect(rootLines).toContain('-l verbose');
			expect(rootLines).not.toContain('-l childOnly');
		});
	});
});
