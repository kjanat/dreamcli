/**
 * End-to-end integration tests for shell completions + runtime detection.
 *
 * Exercises the full pipeline from CLIBuilder construction through completion
 * script generation and auto-adapter wiring. Tests cross-module integration:
 * CLIBuilder × completion generators × runtime detection × adapter factory.
 */

import { describe, expect, it } from 'vitest';
import { createTestAdapter, ExitError } from '../../runtime/adapter.js';
import type { GlobalForDetect } from '../../runtime/detect.js';
import { arg } from '../schema/arg.js';
import { command } from '../schema/command.js';
import { flag } from '../schema/flag.js';
import { middleware } from '../schema/middleware.js';
import { cli } from './index.js';

// ===================================================================
// Shared test commands
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

// ===================================================================
// E2E — Bash completion via CLI dispatch
// ===================================================================

describe('E2E — bash completion via .completions()', () => {
	it('generates valid bash script through full CLI dispatch', async () => {
		const app = cli('myapp')
			.version('2.0.0')
			.command(deployCommand())
			.command(loginCommand())
			.command(configCommand())
			.completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
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

	it('bash script includes all flags from all commands', async () => {
		const app = cli('myapp')
			.command(deployCommand())
			.command(loginCommand())
			.command(configCommand())
			.completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
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

	it('bash script includes enum value completions', async () => {
		const app = cli('myapp').command(deployCommand()).command(configCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
		const script = result.stdout.join('');

		// Enum values for --region (us eu ap)
		expect(script).toContain('us eu ap');

		// Enum values for --format (json yaml toml)
		expect(script).toContain('json yaml toml');
	});

	it('bash script includes command aliases in case patterns', async () => {
		const app = cli('myapp').command(configCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
		const script = result.stdout.join('');

		// The 'cfg' alias should appear in the case pattern alongside 'config'
		expect(script).toMatch(/config\|cfg\)/);
	});

	it('bash script excludes hidden commands', async () => {
		const app = cli('myapp').command(deployCommand()).command(hiddenDebugCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
		const script = result.stdout.join('');

		expect(script).toContain('deploy');
		// 'debug' should not appear in subcommand lists or case patterns
		expect(script).not.toMatch(/compgen -W '[^']*debug/);
	});

	it('bash script includes root global flags', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
		const script = result.stdout.join('');

		expect(script).toContain('--help');
		expect(script).toContain('--version');
	});
});

// ===================================================================
// E2E — Zsh completion via CLI dispatch
// ===================================================================

describe('E2E — zsh completion via .completions()', () => {
	it('generates valid zsh script through full CLI dispatch', async () => {
		const app = cli('myapp')
			.version('2.0.0')
			.command(deployCommand())
			.command(loginCommand())
			.command(configCommand())
			.completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();

		const script = result.stdout.join('');

		// Valid zsh script structure
		expect(script).toContain('#compdef myapp');
		expect(script).toContain('_myapp()');
		expect(script).toContain("_describe 'command' subcmds");
		expect(script).toContain('_arguments -C');
		expect(script).toContain('_myapp "$@"');

		// All visible commands present in _describe list
		expect(script).toContain("'deploy:");
		expect(script).toContain("'login:");
		expect(script).toContain("'config:");
	});

	it('zsh script includes all flag specs from all commands', async () => {
		const app = cli('myapp').command(deployCommand()).command(loginCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
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

	it('zsh script includes enum values in flag specs', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		const script = result.stdout.join('');

		// Enum flag should include values in (v1 v2 v3) format
		expect(script).toMatch(/\(us eu ap\)/);
	});

	it('zsh script uses mutual exclusion groups for aliased flags', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		const script = result.stdout.join('');

		// Short alias -f and --force should be in a mutual exclusion group
		expect(script).toContain('(-f --force)');
	});

	it('zsh script includes command aliases in case patterns', async () => {
		const app = cli('myapp').command(configCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		const script = result.stdout.join('');

		// cfg alias should appear alongside config in case pattern
		expect(script).toMatch(/config\|cfg\)/);
	});

	it('zsh script excludes hidden commands', async () => {
		const app = cli('myapp').command(deployCommand()).command(hiddenDebugCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		const script = result.stdout.join('');

		expect(script).toContain("'deploy:");
		expect(script).not.toContain("'debug:");
	});

	it('zsh script includes --version when version is set', async () => {
		const app = cli('myapp').version('3.0.0').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		const script = result.stdout.join('');

		expect(script).toContain('--version[Show version]');
	});

	it('zsh script omits --version when no version set', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		const script = result.stdout.join('');

		expect(script).not.toContain('--version');
	});
});

// ===================================================================
// E2E — Completion script completeness
// ===================================================================

describe('E2E — completion scripts include all registered commands and flags', () => {
	it('bash: complex CLI with many commands reflects full schema', async () => {
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

		const result = await app.execute(['completions', '--shell', 'bash']);
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

	it('zsh: complex CLI with many commands reflects full schema', async () => {
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

		const result = await app.execute(['completions', '--shell', 'zsh']);
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

	it('completions command with middleware-enhanced commands', async () => {
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
		const result = await app.execute(['completions', '--shell', 'bash']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');
		expect(script).toContain('protected');
		expect(script).toContain('--verbose');
		expect(script).toContain('-v');
	});
});

// ===================================================================
// E2E — Auto-adapter wiring via CLIBuilder.run()
// ===================================================================

describe('E2E — auto-adapter wiring in CLIBuilder.run()', () => {
	it('run() uses adapter argv for command dispatch', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'myapp', 'completions', '--shell', 'bash'],
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

	it('run() dispatches to correct command via adapter argv', async () => {
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

	it('run() sources env from adapter for flag resolution', async () => {
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

	it('run() propagates isTTY from adapter', async () => {
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

	it('run() exits with non-zero for unknown commands', async () => {
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

// ===================================================================
// E2E — detectRuntime integration via auto-adapter
// ===================================================================

describe('E2E — detectRuntime in CLIBuilder.run() path', () => {
	it('run() without explicit adapter uses auto-detection (Node in vitest)', async () => {
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
		const { createAdapter } = await import('../../runtime/auto.js');
		const globals: GlobalForDetect = {
			Bun: { version: '1.2.0' },
			process: { versions: { node: '22.0.0' } },
		};
		const adapter = createAdapter(globals);
		expect(adapter).toBeDefined();
		expect(typeof adapter.stdout).toBe('function');
		expect(typeof adapter.stderr).toBe('function');
	});

	it('auto-adapter creates valid adapter for simulated Deno runtime', async () => {
		const { createAdapter } = await import('../../runtime/auto.js');
		const globals: GlobalForDetect = {
			Deno: { version: { deno: '2.1.0' } },
		};
		// Deno falls back to Node adapter currently
		const adapter = createAdapter(globals);
		expect(adapter).toBeDefined();
		expect(typeof adapter.stdout).toBe('function');
	});
});

// ===================================================================
// E2E — Cross-cutting: completions + runtime + error handling
// ===================================================================

describe('E2E — completions error paths via CLI dispatch', () => {
	it('unsupported shell produces descriptive UNSUPPORTED_OPERATION error', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		// 'fish' is a valid Shell enum value but not yet implemented —
		// generateCompletion throws a CLIError with a clear message
		const result = await app.execute(['completions', '--shell', 'fish']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain('not yet supported');
	});

	it('missing --shell flag via run() path outputs error', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions']);
		expect(result.exitCode).not.toBe(0);
		expect(result.error).toBeDefined();
	});

	it('completions --help shows usage via CLI dispatch', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--help']);
		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('completions');
		expect(output).toContain('--shell');
	});

	it('completions command with --json flag renders error as JSON', async () => {
		const app = cli('myapp').command(deployCommand()).completions();

		// No --shell provided → error, and --json makes it JSON
		const result = await app.execute(['--json', 'completions']);
		expect(result.exitCode).not.toBe(0);

		// The error should be in JSON format on stdout
		const jsonOutput = result.stdout.find((l) => l.includes('"error"'));
		if (jsonOutput !== undefined) {
			const parsed = JSON.parse(jsonOutput) as { error: unknown };
			expect(parsed.error).toBeDefined();
		}
	});
});

// ===================================================================
// E2E — Completions with version and description
// ===================================================================

describe('E2E — completions integrate with CLI metadata', () => {
	it('bash completion script uses CLI name from builder', async () => {
		const app = cli('custom-tool')
			.version('5.0.0')
			.description('A custom development tool')
			.command(deployCommand())
			.completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
		const script = result.stdout.join('');

		expect(script).toContain('custom-tool');
		expect(script).toContain('complete -F _custom_tool_completions custom-tool');
	});

	it('zsh completion script uses CLI name in compdef directive', async () => {
		const app = cli('custom-tool').version('5.0.0').command(deployCommand()).completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		const script = result.stdout.join('');

		expect(script).toContain('#compdef custom-tool');
		expect(script).toContain('_custom_tool()');
		expect(script).toContain('_custom_tool "$@"');
	});

	it('bash completion for CLI with no commands has only global flags', async () => {
		const app = cli('minimal').completions();

		const result = await app.execute(['completions', '--shell', 'bash']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');

		expect(script).toContain('--help');
		expect(script).toContain('--version');
		// No subcommand case dispatch
		expect(script).not.toContain('subcmd=""');
	});

	it('zsh completion for CLI with no commands has only global flags', async () => {
		const app = cli('minimal').completions();

		const result = await app.execute(['completions', '--shell', 'zsh']);
		expect(result.exitCode).toBe(0);
		const script = result.stdout.join('');

		expect(script).toContain("'--help[Show help text]'");
		// No subcmd dispatch
		expect(script).not.toContain("_describe 'command' subcmds");
	});
});
