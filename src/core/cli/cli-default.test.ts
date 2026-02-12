/**
 * Tests for default command dispatch — `.default()` builder method.
 */

import { describe, expect, it, vi } from 'vitest';
import { CLIError } from '../errors/index.ts';
import { arg } from '../schema/arg.ts';
import { command } from '../schema/command.ts';
import { flag } from '../schema/flag.ts';
import { cli, formatRootHelp } from './index.ts';

// ===================================================================
// Helpers
// ===================================================================

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

// ===================================================================
// .default() builder method
// ===================================================================

describe('.default() — builder', () => {
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
		expect(() => {
			cli('mycli').default(deployCommand()).default(noArgCommand());
		}).toThrow(CLIError);

		try {
			cli('mycli').default(deployCommand()).default(noArgCommand());
		} catch (err) {
			expect(err).toBeInstanceOf(CLIError);
			expect((err as CLIError).code).toBe('DUPLICATE_DEFAULT');
		}
	});

	it('throws DUPLICATE_COMMAND when command name already registered', () => {
		expect(() => {
			cli('mycli').command(deployCommand()).default(deployCommand());
		}).toThrow(CLIError);

		try {
			cli('mycli').command(deployCommand()).default(deployCommand());
		} catch (err) {
			expect(err).toBeInstanceOf(CLIError);
			expect((err as CLIError).code).toBe('DUPLICATE_COMMAND');
		}
	});
});

// ===================================================================
// Pure single-command CLI — no siblings
// ===================================================================

describe('.default() — single-command dispatch', () => {
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

// ===================================================================
// Hybrid CLI — default + sibling commands
// ===================================================================

describe('.default() — hybrid dispatch (default + siblings)', () => {
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

	it('shows unknown command error for unrecognized tokens — not silently delegating', async () => {
		const app = cli('mycli').default(deployCommand()).command(statusCommand());
		const result = await app.execute(['deplooy']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown command: deplooy');
		expect(result.stderr.join('')).toContain("Did you mean 'deploy'?");
	});
});

// ===================================================================
// --help / --version with default command
// ===================================================================

describe('.default() — help and version', () => {
	it('--help shows root help, not default command help', async () => {
		const app = cli('mycli').version('1.0.0').default(deployCommand()).command(statusCommand());
		const result = await app.execute(['--help']);

		expect(result.exitCode).toBe(0);
		const output = result.stdout.join('');
		expect(output).toContain('mycli v1.0.0');
		expect(output).toContain('Commands:');
		expect(output).toContain('deploy');
		expect(output).toContain('status');
	});

	it('-h shows root help', async () => {
		const app = cli('mycli').default(deployCommand());
		const result = await app.execute(['-h']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Commands:');
	});

	it('--version shows version, not default command', async () => {
		const app = cli('mycli').version('2.0.0').default(deployCommand());
		const result = await app.execute(['--version']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('2.0.0');
	});
});

// ===================================================================
// --json mode with default command
// ===================================================================

describe('.default() — JSON mode', () => {
	it('default command receives jsonMode context via --json', async () => {
		const cmd = command('run').action(({ out }) => {
			out.json({ ok: true });
		});
		const result = await cli('mycli').default(cmd).execute(['--json']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('"ok":true');
	});
});

// ===================================================================
// Root help formatting with default command
// ===================================================================

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

	it('footer uses [command] when default exists', () => {
		const app = cli('mycli').default(deployCommand());
		const help = formatRootHelp(app.schema);

		expect(help).toContain("Run 'mycli [command] --help' for more information.");
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
