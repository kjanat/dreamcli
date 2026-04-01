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

function extractBashRootWords(script: string): readonly string[] {
	const matches = [...script.matchAll(/compgen -W '([^']*)' -- "\$cur"/g)];
	const words = matches[matches.length - 1]?.[1];
	if (words === undefined) {
		throw new Error('Could not find root bash completion words');
	}
	return words.split(' ').filter(Boolean);
}

function extractZshRootFunction(script: string, funcName = '_mycli'): string {
	const start = script.indexOf(`${funcName}() {`);
	if (start === -1) {
		throw new Error(`Could not find zsh root function '${funcName}'`);
	}
	const end = script.indexOf(`\n}\n\n${funcName} "$@"`, start);
	if (end === -1) {
		throw new Error(`Could not find end of zsh root function '${funcName}'`);
	}
	return script.slice(start, end);
}

// === .completions() builder method

describe('.completions() — builder registration', () => {
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

// === Double .completions() guard

describe('.completions() — double call guard', () => {
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

// === Bash completion generation via completions subcommand

describe('.completions() — bash output', () => {
	it('generates bash completion script', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBeGreaterThan(0);
		const output = result.stdout.join('');
		expect(output).toContain('#!/usr/bin/env bash');
		expect(output).toContain('complete -F');
		expect(output).toContain('mycli');
	});

	it('includes registered command names in bash script', async () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		const output = result.stdout.join('');
		expect(output).toContain('deploy');
		expect(output).toContain('login');
	});

	it('includes flag names from registered commands', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		const output = result.stdout.join('');
		expect(output).toContain('--force');
		expect(output).toContain('--region');
	});

	it('excludes the completions command itself from bash script', async () => {
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

	it('keeps hybrid default-command root completion command-centric by default', async () => {
		const app = cli('mycli').default(serveDefaultCommand()).command(statusCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		const rootWords = extractBashRootWords(result.stdout.join(''));

		expect(rootWords).toEqual(['serve', 'status', '--help']);
	});

	it('passes rootMode through to bash completion generation', async () => {
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

	it('exposes default-command flags for a single visible default in default mode', async () => {
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

// === Zsh completion generation via completions subcommand

describe('.completions() — zsh output', () => {
	it('generates zsh completion script', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('#compdef mycli');
		expect(output).toContain('_mycli');
	});

	it('includes registered command names in zsh script', async () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const output = result.stdout.join('');
		expect(output).toContain('deploy');
		expect(output).toContain('login');
	});

	it('includes flag specs from registered commands', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const output = result.stdout.join('');
		expect(output).toContain('--force');
		expect(output).toContain('--region');
	});

	it('keeps hybrid default-command root completion command-centric by default', async () => {
		const app = cli('mycli').default(serveDefaultCommand()).command(statusCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const rootFunction = extractZshRootFunction(result.stdout.join(''));

		expect(rootFunction).toContain("'--help[Show help text]'");
		expect(rootFunction).toContain("'serve:Start the server'");
		expect(rootFunction).toContain("'status:Show current status'");
		expect(rootFunction).not.toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
	});

	it('passes rootMode through to zsh completion generation', async () => {
		const app = cli('mycli')
			.default(serveDefaultCommand())
			.command(statusCommand())
			.completions({ rootMode: 'surface' });
		const result = await app.execute(['completions', 'zsh']);
		const rootFunction = extractZshRootFunction(result.stdout.join(''));

		expect(rootFunction).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
		expect(rootFunction).toContain("'--verbose[Verbose logging]'");
		expect(rootFunction).not.toContain("'--childOnly[Child-only flag]'");
	});

	it('exposes default-command flags for a single visible default in default mode', async () => {
		const app = cli('mycli').default(serveDefaultCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const rootFunction = extractZshRootFunction(result.stdout.join(''));

		expect(rootFunction).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
		expect(rootFunction).toContain("'--verbose[Verbose logging]'");
		expect(rootFunction).not.toContain("'--childOnly[Child-only flag]'");
	});
});

// === Error handling

describe('.completions() — error handling', () => {
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

	it('errors when fish is requested through the user-facing shell arg', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'fish']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain("Unknown shell 'fish'");
	});

	it('errors when powershell is requested through the user-facing shell arg', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'powershell']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain("Unknown shell 'powershell'");
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

// === Schema snapshot behavior

describe('.completions() — schema snapshot', () => {
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
		const result = await app.execute(['completions', 'bash']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('#!/usr/bin/env bash');
		expect(output).toContain('complete -F');
	});
});

// === --json mode behavior

describe('.completions() — --json mode', () => {
	it('outputs JSON with shell + script fields to stdout in --json mode', async () => {
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

	it('outputs JSON with zsh script in --json mode', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'zsh', '--json']);
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.script).toContain('#compdef mycli');
		expect(parsed.script).toContain('_mycli');
	});

	it('outputs raw script to stdout in normal mode (no --json)', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		expect(result.exitCode).toBe(0);
		// Raw script directly on stdout (not wrapped in JSON)
		const output = result.stdout.join('');
		expect(output).toContain('#!/usr/bin/env bash');
		// Should not be JSON
		expect(() => JSON.parse(output)).toThrow();
	});

	it('jsonMode via options also wraps script in JSON', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'bash'], { jsonMode: true });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.script).toContain('complete -F');
	});
});

// === Alias dispatch

describe('.completions() — alias dispatch', () => {
	it('dispatches via "completion" (singular) alias', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completion', 'bash']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('#!/usr/bin/env bash');
	});
});

// --- Install instruction headers

describe('.completions() — install instruction headers', () => {
	it('bash script includes install instructions in header', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		const output = result.stdout.join('');
		expect(output).toContain('source <(mycli completions bash)');
		expect(output).toContain('/etc/bash_completion.d/mycli');
	});

	it('zsh script includes install instructions in header', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const output = result.stdout.join('');
		expect(output).toContain('source <(mycli completions zsh)');
		expect(output).toContain('fpath');
	});
});

// === Root help integration

describe('.completions() — root help', () => {
	it('completions command appears in root --help', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['--help']);
		const output = result.stdout.join('');
		expect(output).toContain('completions');
		expect(output).toContain('Generate shell completion script');
	});
});
