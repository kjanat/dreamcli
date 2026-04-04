/**
 * End-to-end integration tests for shell completions + runtime detection.
 *
 * Exercises the full pipeline from CLIBuilder construction through completion
 * script generation and auto-adapter wiring. Tests cross-module integration:
 * CLIBuilder × completion generators × runtime detection × adapter factory.
 */

import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import type { GlobalForDetect } from '#internals/runtime/detect.ts';
import { cli } from './index.ts';

// === Shared test commands

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
		.flag('sso', flag.boolean().alias('s').describe('Use SSO'))
		.action(({ flags, out }) => {
			out.log(`Logged in with token: ${flags.token ?? 'none'}`);
		});
}

function configCommand() {
	return command('config')
		.description('Manage configuration')
		.alias('cfg')
		.flag('global', flag.boolean().alias('g').describe('Global scope'))
		.flag('format', flag.enum(['json', 'yaml', 'toml']).describe('Output format'))
		.action(({ flags, out }) => {
			out.log(`Config format: ${flags.format ?? 'json'}`);
		});
}

function hiddenDebugCommand() {
	return command('debug')
		.description('Internal debug tools')
		.hidden()
		.action(({ out }) => {
			out.log('debug info');
		});
}

// === .completions() — E2E

describe('.completions() — E2E', () => {
	// --- bash

	describe('bash', () => {
		it('generates the script', async () => {
			const app = cli('myapp')
				.version('2.0.0')
				.command(deployCommand())
				.command(loginCommand())
				.command(configCommand())
				.completions();

			const result = await app.execute(['completions', 'bash']);
			expect(result.exitCode).toBe(0);
			expect(result.error).toBeUndefined();

			const script = result.stdout.join('');

			// Valid bash script structure
			expect(script).toContain('#!/usr/bin/env bash');
			expect(script).toContain('_myapp_completions()');
			expect(script).toContain('complete -F _myapp_completions myapp');
			expect(script).toContain('_init_completion');

			// All visible commands present
			expect(script).toContain('deploy');
			expect(script).toContain('login');
			expect(script).toContain('config');

			// Hidden command excluded
			// The debug command was NOT registered — but assert no hidden cmds leak
			expect(script).not.toMatch(/compgen -W '[^']*debug/);
		});

		it('includes flags from registered commands', async () => {
			const app = cli('myapp')
				.command(deployCommand())
				.command(loginCommand())
				.command(configCommand())
				.completions();

			const result = await app.execute(['completions', 'bash']);
			const script = result.stdout.join('');

			// deploy flags
			expect(script).toContain('--force');
			expect(script).toContain('-f');
			expect(script).toContain('--region');

			// login flags
			expect(script).toContain('--token');
			expect(script).toContain('--sso');
			expect(script).toContain('-s');

			// config flags
			expect(script).toContain('--global');
			expect(script).toContain('-g');
			expect(script).toContain('--format');
		});

		it('includes enum values', async () => {
			const app = cli('myapp').command(deployCommand()).command(configCommand()).completions();

			const result = await app.execute(['completions', 'bash']);
			const script = result.stdout.join('');

			// Enum values for --region (us eu ap)
			expect(script).toContain('us eu ap');

			// Enum values for --format (json yaml toml)
			expect(script).toContain('json yaml toml');
		});

		it('includes command aliases', async () => {
			const app = cli('myapp').command(configCommand()).completions();

			const result = await app.execute(['completions', 'bash']);
			const script = result.stdout.join('');

			// The 'cfg' alias should appear in the case pattern alongside 'config'
			expect(script).toMatch(/config\|cfg\)/);
		});

		it('excludes hidden commands', async () => {
			const app = cli('myapp').command(deployCommand()).command(hiddenDebugCommand()).completions();

			const result = await app.execute(['completions', 'bash']);
			const script = result.stdout.join('');

			expect(script).toContain('deploy');
			// 'debug' should not appear in subcommand lists or case patterns
			expect(script).not.toMatch(/compgen -W '[^']*debug/);
		});

		it('includes --help and --version when version is set', async () => {
			const app = cli('myapp').version('1.0.0').command(deployCommand()).completions();

			const result = await app.execute(['completions', 'bash']);
			const script = result.stdout.join('');

			expect(script).toContain('--help');
			expect(script).toContain('--version');
		});

		it('omits --version when version is unset', async () => {
			const app = cli('myapp').command(deployCommand()).completions();

			const result = await app.execute(['completions', 'bash']);
			const script = result.stdout.join('');

			expect(script).toContain('--help');
			expect(script).not.toContain('--version');
		});

		it('uses the inherited runtime name in generated scripts', async () => {
			const stdoutLines: string[] = [];
			const adapter = createTestAdapter({
				argv: ['node', '/usr/bin/xxxhotbabe.ts', 'completions', 'bash'],
				stdout: (line) => stdoutLines.push(line),
			});
			const app = cli({ inherit: true }).command(deployCommand()).completions();

			try {
				await app.run({ adapter });
			} catch (err: unknown) {
				if (!(err instanceof ExitError)) throw err;
				expect(err.code).toBe(0);
			}

			const script = stdoutLines.join('');
			expect(script).toContain('# Bash completion for xxxhotbabe.ts');
			expect(script).toContain('source <(xxxhotbabe.ts completions bash)');
		});
	});

	// --- zsh

	describe('zsh', () => {
		it('generates the script', async () => {
			const app = cli('myapp')
				.version('2.0.0')
				.command(deployCommand())
				.command(loginCommand())
				.command(configCommand())
				.completions();

			const result = await app.execute(['completions', 'zsh']);
			expect(result.exitCode).toBe(0);
			expect(result.error).toBeUndefined();

			const script = result.stdout.join('');

			// Valid zsh script structure
			expect(script).toContain('#compdef myapp');
			expect(script).toContain('_myapp()');
			expect(script).toContain("_describe 'command' subcmds");
			expect(script).toContain('_arguments -C');
			expect(script).toContain('compdef _myapp myapp');

			// All visible commands present in _describe list
			expect(script).toContain("'deploy:");
			expect(script).toContain("'login:");
			expect(script).toContain("'config:");
		});

		it('includes flag specs from registered commands', async () => {
			const app = cli('myapp').command(deployCommand()).command(loginCommand()).completions();

			const result = await app.execute(['completions', 'zsh']);
			const script = result.stdout.join('');

			// deploy flags with descriptions
			expect(script).toContain('--force');
			expect(script).toContain('Force deployment');
			expect(script).toContain('--region');
			expect(script).toContain('Target region');

			// login flags
			expect(script).toContain('--token');
			expect(script).toContain('Auth token');
			expect(script).toContain('--sso');
		});

		it('includes enum values', async () => {
			const app = cli('myapp').command(deployCommand()).completions();

			const result = await app.execute(['completions', 'zsh']);
			const script = result.stdout.join('');

			// Enum flag should include values in (v1 v2 v3) format
			expect(script).toMatch(/\(us eu ap\)/);
		});

		it('uses mutual exclusion groups for aliases', async () => {
			const app = cli('myapp').command(deployCommand()).completions();

			const result = await app.execute(['completions', 'zsh']);
			const script = result.stdout.join('');

			// Short alias -f and --force should be in a mutual exclusion group
			expect(script).toContain('(-f --force)');
		});

		it('includes command aliases', async () => {
			const app = cli('myapp').command(configCommand()).completions();

			const result = await app.execute(['completions', 'zsh']);
			const script = result.stdout.join('');

			// cfg alias should appear alongside config in case pattern
			expect(script).toMatch(/config\|cfg\)/);
		});

		it('excludes hidden commands', async () => {
			const app = cli('myapp').command(deployCommand()).command(hiddenDebugCommand()).completions();

			const result = await app.execute(['completions', 'zsh']);
			const script = result.stdout.join('');

			expect(script).toContain("'deploy:");
			expect(script).not.toContain("'debug:");
		});

		it('includes --version when version is set', async () => {
			const app = cli('myapp').version('3.0.0').command(deployCommand()).completions();

			const result = await app.execute(['completions', 'zsh']);
			const script = result.stdout.join('');

			expect(script).toContain('--version[Show version]');
		});

		it('omits --version when version is unset', async () => {
			const app = cli('myapp').command(deployCommand()).completions();

			const result = await app.execute(['completions', 'zsh']);
			const script = result.stdout.join('');

			expect(script).not.toContain('--version');
		});
	});
});

// === E2E — Completion script completeness

describe('completion scripts — schema coverage', () => {
	it('bash reflects the full schema', async () => {
		const serve = command('serve')
			.description('Start dev server')
			.flag('port', flag.number().alias('p').describe('Port number'))
			.flag('host', flag.string().default('localhost').describe('Host to bind'))
			.flag('https', flag.boolean().describe('Enable HTTPS'))
			.action(({ out }) => out.log('serving'));

		const build = command('build')
			.description('Build the project')
			.arg('entry', arg.string().describe('Entry file'))
			.flag('minify', flag.boolean().alias('m').describe('Minify output'))
			.flag('target', flag.enum(['es2020', 'es2022', 'esnext']).describe('JS target'))
			.flag('outdir', flag.string().alias('o').describe('Output directory'))
			.action(({ out }) => out.log('building'));

		const test = command('test')
			.description('Run test suite')
			.flag('watch', flag.boolean().alias('w').describe('Watch mode'))
			.flag('coverage', flag.boolean().describe('Collect coverage'))
			.flag('reporter', flag.enum(['verbose', 'dot', 'json']).describe('Reporter type'))
			.action(({ out }) => out.log('testing'));

		const app = cli('devtool')
			.version('1.0.0')
			.command(serve)
			.command(build)
			.command(test)
			.completions();

		const result = await app.execute(['completions', 'bash']);
		const script = result.stdout.join('');

		// All commands present
		expect(script).toContain('serve');
		expect(script).toContain('build');
		expect(script).toContain('test');

		// All flags present
		expect(script).toContain('--port');
		expect(script).toContain('--host');
		expect(script).toContain('--https');
		expect(script).toContain('--minify');
		expect(script).toContain('--target');
		expect(script).toContain('--outdir');
		expect(script).toContain('--watch');
		expect(script).toContain('--coverage');
		expect(script).toContain('--reporter');

		// Short aliases
		expect(script).toContain('-p');
		expect(script).toContain('-m');
		expect(script).toContain('-o');
		expect(script).toContain('-w');

		// Enum values for completions
		expect(script).toContain('es2020 es2022 esnext');
		expect(script).toContain('verbose dot json');
	});

	it('zsh reflects the full schema', async () => {
		const serve = command('serve')
			.description('Start dev server')
			.flag('port', flag.number().alias('p').describe('Port number'))
			.flag('host', flag.string().default('localhost').describe('Host to bind'))
			.action(({ out }) => out.log('serving'));

		const build = command('build')
			.description('Build the project')
			.flag('minify', flag.boolean().alias('m').describe('Minify output'))
			.flag('target', flag.enum(['es2020', 'es2022', 'esnext']).describe('JS target'))
			.action(({ out }) => out.log('building'));

		const app = cli('devtool').version('1.0.0').command(serve).command(build).completions();

		const result = await app.execute(['completions', 'zsh']);
		const script = result.stdout.join('');

		// Commands in _describe list
		expect(script).toContain("'serve:Start dev server'");
		expect(script).toContain("'build:Build the project'");

		// Flag descriptions
		expect(script).toContain('Port number');
		expect(script).toContain('Host to bind');
		expect(script).toContain('Minify output');
		expect(script).toContain('JS target');

		// Enum values
		expect(script).toMatch(/\(es2020 es2022 esnext\)/);

		// Mutual exclusion groups for aliased flags
		expect(script).toContain('(-p --port)');
		expect(script).toContain('(-m --minify)');
	});

	it('includes middleware-enhanced commands', async () => {
		const auth = middleware<{ user: string }>(async ({ next }) => {
			await next({ user: 'test-user' });
		});

		const protected_ = command('protected')
			.description('Protected resource')
			.middleware(auth)
			.flag('verbose', flag.boolean().alias('v').describe('Verbose output'))
			.action(({ out }) => {
				out.log('protected resource');
			});

		const app = cli('myapp').command(protected_).completions();

		// Completion script generation works with middleware commands
		const result = await app.execute(['completions', 'bash']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');
		expect(script).toContain('protected');
		expect(script).toContain('--verbose');
		expect(script).toContain('-v');
	});
});

// === E2E — Auto-adapter wiring via CLIBuilder.run()

describe('CLIBuilder.run() — auto-adapter wiring', () => {
	it('uses adapter argv for command dispatch', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'myapp', 'completions', 'bash'],
			stdout: (line) => stdoutLines.push(line),
		});

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
			expect(e.code).toBe(0);
		}

		const output = stdoutLines.join('');
		expect(output).toContain('#!/usr/bin/env bash');
		expect(output).toContain('deploy');
		expect(output).toContain('complete -F');
	});

	it('dispatches the correct command from adapter argv', async () => {
		const app = cli('myapp')
			.command(
				command('greet')
					.description('Say hello')
					.arg('name', arg.string())
					.action(({ args, out }) => out.log(`Hello, ${args.name}!`)),
			)
			.completions();

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'myapp', 'greet', 'World'],
			stdout: (line) => stdoutLines.push(line),
		});

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
			expect(e.code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('Hello, World!');
	});

	it('sources env from the adapter for flag resolution', async () => {
		const app = cli('myapp').command(
			command('info')
				.description('Show info')
				.flag('level', flag.string().env('LOG_LEVEL').default('info'))
				.action(({ flags, out }) => out.log(`level=${flags.level}`)),
		);

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'myapp', 'info'],
			env: { LOG_LEVEL: 'debug' },
			stdout: (line) => stdoutLines.push(line),
		});

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
			expect(e.code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('level=debug');
	});

	it('propagates isTTY from the adapter', async () => {
		const app = cli('myapp').command(
			command('check')
				.description('Check TTY')
				.action(({ out }) => out.log(`tty=${String(out.isTTY)}`)),
		);

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'myapp', 'check'],
			isTTY: true,
			stdout: (line) => stdoutLines.push(line),
		});

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
			expect(e.code).toBe(0);
		}

		expect(stdoutLines.join('')).toContain('tty=true');
	});

	it('exits non-zero for unknown commands', async () => {
		const app = cli('myapp').command(deployCommand());

		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'myapp', 'nonexistent'],
			stderr: (line) => stderrLines.push(line),
		});

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
			expect(e.code).toBe(2);
		}

		expect(stderrLines.join('')).toContain('Unknown command');
	});
});

// === E2E — detectRuntime integration via auto-adapter

describe('CLIBuilder.run() — detectRuntime path', () => {
	it('uses auto-detection without an explicit adapter', async () => {
		// In vitest (Node.js), createAdapter() detects 'node' and uses Node adapter.
		// We can't easily test Bun detection without Bun, but we can verify
		// the auto-adapter path doesn't crash and produces correct output.
		const app = cli('myapp').command(
			command('ping')
				.description('Ping')
				.action(({ out }) => out.log('pong')),
		);

		// Using execute() here to avoid process.exit, but the auto-adapter
		// is exercised in the CLIBuilder constructor and run() method.
		const result = await app.execute(['ping']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('pong');
	});

	it('auto-adapter creates valid adapter for simulated Bun runtime', async () => {
		// Verify the createAdapter path works with Bun globals.
		// We test this via the adapter factory directly since run() would
		// need a real Bun runtime for process.argv etc.
		const { createAdapter } = await import('#internals/runtime/auto.ts');
		const globals: GlobalForDetect = {
			Bun: { version: '1.3.11' },
			process: { versions: { node: '22.22.2' } },
		};
		const adapter = createAdapter(globals);
		expect(adapter).toBeDefined();
		expect(typeof adapter.stdout).toBe('function');
		expect(typeof adapter.stderr).toBe('function');
	});

	it('auto-adapter creates valid adapter for simulated Deno runtime', async () => {
		const { createAdapter } = await import('#internals/runtime/auto.ts');
		const { createMockDenoNamespace } = await import('#internals/runtime/test-helpers.ts');

		const globals: GlobalForDetect = {
			Deno: createMockDenoNamespace(),
		};
		const adapter = createAdapter(globals);
		expect(adapter).toBeDefined();
		expect(typeof adapter.stdout).toBe('function');
		expect(typeof adapter.stderr).toBe('function');
	});
});

// === E2E — Cross-cutting: completions + runtime + error handling

describe('completions — CLI error paths', () => {
	it('powershell is accepted by the user-facing shell arg', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions', 'powershell']);
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
		expect(result.stdout.join('')).toContain('# PowerShell completion for myapp');
	});

	it('errors when the shell arg is missing via run()', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
	});

	it('shows usage for completions --help', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('completions');
		expect(output).toContain('shell');
	});

	it('renders errors as JSON with --json', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		// No shell arg provided → error, and --json makes it JSON
		const result = await app.execute(['--json', 'completions']);
		expect(result.exitCode).not.toBe(0);

		// The error should be in JSON format on stdout
		const jsonOutput = result.stdout.find((l) => l.includes('"error"'));
		expect(jsonOutput).toBeDefined();
		if (jsonOutput === undefined) return; // unreachable — satisfies TS narrowing
		const parsed: Record<string, unknown> = JSON.parse(jsonOutput);
		expect(parsed.error).toBeDefined();
	});
});

// === E2E — Fish completion via CLI dispatch

describe('.completions() — fish', () => {
	it('generates the script', async () => {
		const app = cli('myapp')
			.version('2.0.0')
			.command(deployCommand())
			.command(loginCommand())
			.command(configCommand())
			.completions();

		const result = await app.execute(['completions', 'fish']);
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();

		const script = result.stdout.join('');

		expect(script).toContain('# Fish completion for myapp');
		expect(script).toContain('function __myapp_completions_path');
		expect(script).toContain('complete -c myapp -f');
		expect(script).toContain('deploy');
		expect(script).toContain('login');
		expect(script).toContain('config');
		expect(script).toContain('-l force');
		expect(script).toContain('-l region');
		expect(script).toContain('us eu ap');
		expect(script).not.toContain('debug');
	});
});

// === E2E — Completions with version and description

describe('completions — CLI metadata', () => {
	it('bash uses the CLI name from the builder', async () => {
		const app = cli('custom-tool')
			.version('5.0.0')
			.description('A custom development tool')
			.command(deployCommand())
			.completions();

		const result = await app.execute(['completions', 'bash']);
		const script = result.stdout.join('');

		expect(script).toContain('custom-tool');
		expect(script).toMatch(/complete -F _custom_tool_[0-9a-f]{8}_completions custom-tool/);
	});

	it('zsh uses the CLI name in the compdef directive', async () => {
		const app = cli('custom-tool').version('5.0.0').command(deployCommand()).completions();

		const result = await app.execute(['completions', 'zsh']);
		const script = result.stdout.join('');

		expect(script).toContain('#compdef custom-tool');
		expect(script).toMatch(/_custom_tool_[0-9a-f]{8}\(\)/);
		expect(script).toMatch(/compdef _custom_tool_[0-9a-f]{8} custom-tool/);
	});

	it('bash keeps only global flags for command-free CLIs', async () => {
		const app = cli('minimal').version('1.0.0').completions();

		const result = await app.execute(['completions', 'bash']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');

		expect(script).toContain('--help');
		expect(script).toContain('--version');
		// No subcommand case dispatch
		expect(script).not.toContain('subcmd=""');
	});

	it('bash omits --version for command-free CLIs when unset', async () => {
		const app = cli('minimal').completions();

		const result = await app.execute(['completions', 'bash']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');

		expect(script).toContain('--help');
		expect(script).not.toContain('--version');
	});

	it('zsh keeps only global flags for command-free CLIs', async () => {
		const app = cli('minimal').completions();

		const result = await app.execute(['completions', 'zsh']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');

		expect(script).toContain("'--help[Show help text]'");
		// No subcmd dispatch
		expect(script).not.toContain("_describe 'command' subcmds");
	});
});

// === E2E — Nested command completion via CLI dispatch

function dbCommand() {
	const migrateCmd = command('migrate')
		.description('Run migrations')
		.flag('dry-run', flag.boolean().describe('Dry run mode'))
		.action(({ out }) => {
			out.log('migrating');
		});

	const seedCmd = command('seed')
		.description('Seed database')
		.alias('s')
		.flag('count', flag.number().describe('Record count'))
		.action(({ out }) => {
			out.log('seeding');
		});

	return command('db')
		.description('Database operations')
		.alias('database')
		.flag('verbose', flag.boolean().alias('v').describe('Verbose output').propagate())
		.command(migrateCmd)
		.command(seedCmd)
		.action(({ out }) => {
			out.log('db help');
		});
}

describe('nested .completions() — bash', () => {
	it('includes nested subcommand names', async () => {
		const app = cli('myapp').command(dbCommand()).command(deployCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');

		// Top-level commands
		expect(script).toContain('db');
		expect(script).toContain('deploy');
		// Nested commands
		expect(script).toContain('migrate');
		expect(script).toContain('seed');
	});

	it('includes propagated flags for nested commands', async () => {
		const app = cli('myapp').command(dbCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		const script = result.stdout.join('');

		// db migrate path should have --verbose (propagated) + --dry-run (own)
		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('"db migrate"'));
		expect(migrateIdx).toBeGreaterThan(-1);
		const migrateBlock = lines.slice(migrateIdx, migrateIdx + 15).join('\n');
		expect(migrateBlock).toContain('--verbose');
		expect(migrateBlock).toContain('--dry-run');
	});

	it('lets the db group complete subcommands and own flags', async () => {
		const app = cli('myapp').command(dbCommand()).completions();
		const result = await app.execute(['completions', 'bash']);
		const script = result.stdout.join('');

		// In the "Complete flags" section, the db path should have
		// migrate, seed (subcommands) + --verbose (own flag)
		const lines = script.split('\n');
		const completeSectionIdx = lines.findIndex((l) => l.includes('Complete flags'));
		const completeSection = lines.slice(completeSectionIdx);
		// Find db) inside the completion case (after "Complete flags" comment)
		const dbIdx = completeSection.findIndex((l) => l.trim().startsWith('db)'));
		expect(dbIdx).toBeGreaterThan(-1);
		const dbBlock = completeSection.slice(dbIdx, dbIdx + 15).join('\n');
		expect(dbBlock).toContain('migrate');
		expect(dbBlock).toContain('seed');
		expect(dbBlock).toContain('--verbose');
	});
});

describe('nested .completions() — zsh', () => {
	it('generates helper functions for nested commands', async () => {
		const app = cli('myapp').command(dbCommand()).command(deployCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');

		// Should generate helper functions for db (group) and its children
		expect(script).toContain('_myapp_db() {');
		expect(script).toContain('_myapp_db_migrate() {');
		expect(script).toContain('_myapp_db_seed() {');
	});

	it('includes propagated flags for nested commands', async () => {
		const app = cli('myapp').command(dbCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const script = result.stdout.join('');

		// migrate helper should have --verbose (propagated) + --dry-run (own)
		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('_myapp_db_migrate() {'));
		expect(migrateIdx).toBeGreaterThan(-1);
		const migrateFunc = lines.slice(migrateIdx, migrateIdx + 10).join('\n');
		expect(migrateFunc).toContain('--verbose');
		expect(migrateFunc).toContain('--dry-run');
	});

	it('lists db subcommands via _describe', async () => {
		const app = cli('myapp').command(dbCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const script = result.stdout.join('');

		const lines = script.split('\n');
		const dbIdx = lines.findIndex((l) => l.includes('_myapp_db() {'));
		const dbFunc = lines.slice(dbIdx, dbIdx + 30).join('\n');
		expect(dbFunc).toContain("'migrate:Run migrations'");
		expect(dbFunc).toContain("'seed:Seed database'");
		expect(dbFunc).toContain("_describe 'command' subcmds");
	});

	it('dispatches the root function to the db helper', async () => {
		const app = cli('myapp').command(dbCommand()).completions();
		const result = await app.execute(['completions', 'zsh']);
		const script = result.stdout.join('');

		// Main function should dispatch db to _myapp_db
		const lines = script.split('\n');
		const mainIdx = lines.findIndex((l) => l.includes('_myapp() {'));
		const mainFunc = lines.slice(mainIdx).join('\n');
		expect(mainFunc).toContain('_myapp_db');
	});
});
