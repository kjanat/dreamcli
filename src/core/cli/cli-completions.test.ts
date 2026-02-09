/**
 * Tests for the built-in .completions() subcommand on CLIBuilder.
 */

import { describe, expect, it } from 'vitest';
import { arg } from '../schema/arg.js';
import { command } from '../schema/command.js';
import { flag } from '../schema/flag.js';
import { cli } from './index.js';

// ===================================================================
// Test helpers
// ===================================================================

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

// ===================================================================
// .completions() builder method
// ===================================================================

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

// ===================================================================
// Bash completion generation via completions subcommand
// ===================================================================

describe('.completions() — bash output', () => {
	it('generates bash completion script', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'bash']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBeGreaterThan(0);
		const output = result.stdout.join('');
		expect(output).toContain('#!/usr/bin/env bash');
		expect(output).toContain('complete -F');
		expect(output).toContain('mycli');
	});

	it('includes registered command names in bash script', async () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'bash']);
		const output = result.stdout.join('');
		expect(output).toContain('deploy');
		expect(output).toContain('login');
	});

	it('includes flag names from registered commands', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'bash']);
		const output = result.stdout.join('');
		expect(output).toContain('--force');
		expect(output).toContain('--region');
	});

	it('excludes the completions command itself from bash script', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'bash']);
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
});

// ===================================================================
// Zsh completion generation via completions subcommand
// ===================================================================

describe('.completions() — zsh output', () => {
	it('generates zsh completion script', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'zsh']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('#compdef mycli');
		expect(output).toContain('_mycli');
	});

	it('includes registered command names in zsh script', async () => {
		const app = cli('mycli').command(deployCommand()).command(loginCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'zsh']);
		const output = result.stdout.join('');
		expect(output).toContain('deploy');
		expect(output).toContain('login');
	});

	it('includes flag specs from registered commands', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'zsh']);
		const output = result.stdout.join('');
		expect(output).toContain('--force');
		expect(output).toContain('--region');
	});
});

// ===================================================================
// Error handling
// ===================================================================

describe('.completions() — error handling', () => {
	it('errors when --shell is missing', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
	});

	it('errors with UNSUPPORTED_OPERATION for unimplemented shell', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'fish']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain('not yet supported');
	});

	it('errors with UNSUPPORTED_OPERATION for powershell', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'powershell']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain('not yet supported');
	});

	it('errors when --shell has truly invalid value', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'nushell']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
	});

	it('shows help with --help flag', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('--shell');
		expect(output).toContain('completions');
	});
});

// ===================================================================
// Schema snapshot behavior
// ===================================================================

describe('.completions() — schema snapshot', () => {
	it('captures commands registered before .completions()', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['completions', '--shell', 'bash']);
		const output = result.stdout.join('');
		expect(output).toContain('deploy');
	});

	it('does not include commands registered after .completions()', async () => {
		const app = cli('mycli').command(deployCommand()).completions().command(loginCommand());
		const result = await app.execute(['completions', '--shell', 'bash']);
		const output = result.stdout.join('');
		expect(output).toContain('deploy');
		// login was registered after .completions(), so not in the snapshot
		expect(output).not.toMatch(/compgen -W '[^']*login/);
	});

	it('works with no other commands registered', async () => {
		const app = cli('mycli').completions();
		const result = await app.execute(['completions', '--shell', 'bash']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('#!/usr/bin/env bash');
		expect(output).toContain('complete -F');
	});
});

// ===================================================================
// Root help integration
// ===================================================================

describe('.completions() — root help', () => {
	it('completions command appears in root --help', async () => {
		const app = cli('mycli').command(deployCommand()).completions();
		const result = await app.execute(['--help']);
		const output = result.stdout.join('');
		expect(output).toContain('completions');
		expect(output).toContain('Generate shell completion script');
	});
});
