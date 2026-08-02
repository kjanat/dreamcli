/**
 * Tests for --json global flag on CLIBuilder.
 */

import { describe, expect, it } from 'vitest';
import { executeCLI } from '#internals/core/cli/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli } from './index.ts';

// --- Test commands

function dataCommand() {
	return command('data')
		.description('Get data')
		.flag('limit', flag.number().default(10))
		.action(({ flags, out }) => {
			if (out.jsonMode) {
				out.json({ items: [1, 2, 3], limit: flags.limit });
			} else {
				out.log('Items: 1, 2, 3');
				out.log(`Limit: ${String(flags.limit)}`);
			}
		});
}

function failCommand() {
	return command('fail')
		.description('Always fails')
		.action(() => {
			throw new CLIError('Something broke', {
				code: 'BROKEN',
				exitCode: 3,
				suggest: 'Try again',
			});
		});
}

// --- --json flag detection and stripping

describe('CLIBuilder --json flag', () => {
	it('strips --json from argv before command dispatch', async () => {
		const app = cli('test').command(dataCommand());
		const result = await app.execute(['data', '--json']);

		expect(result.exitCode).toBe(0);
		// json() output on stdout
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ items: [1, 2, 3], limit: 10 });
	});

	it('--json before command name still works', async () => {
		const app = cli('test').command(dataCommand());
		// Planner-owned argv normalization keeps global --json out of dispatch.
		const result = await app.execute(['--json', 'data']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ items: [1, 2, 3], limit: 10 });
	});

	it('--json does not interfere with command flags', async () => {
		const app = cli('test').command(dataCommand());
		const result = await app.execute(['data', '--limit', '5', '--json']);

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ items: [1, 2, 3], limit: 5 });
	});

	it('command sees jsonMode=false without --json flag', async () => {
		const app = cli('test').command(dataCommand());
		const result = await app.execute(['data']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Items: 1, 2, 3\n', 'Limit: 10\n']);
	});

	it('jsonMode can be set via options instead of --json flag', async () => {
		const app = cli('test').command(dataCommand());
		const result = await app.execute(['data'], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ items: [1, 2, 3], limit: 10 });
	});
});

// --- --json error rendering

describe('CLIBuilder --json error rendering', () => {
	it('renders command errors as JSON in --json mode', async () => {
		const app = cli('test').command(failCommand());
		const result = await app.execute(['fail', '--json']);

		expect(result.exitCode).toBe(3);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('BROKEN');
		expect(parsed.error.message).toBe('Something broke');
		expect(parsed.error.suggest).toBe('Try again');
	});

	it('renders command errors as text without --json', async () => {
		const app = cli('test').command(failCommand());
		const result = await app.execute(['fail']);

		expect(result.exitCode).toBe(3);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContainEqual('Something broke\n');
		expect(result.stderr).toContainEqual('Suggestion: Try again\n');
	});
});

// --- --json CLI-level error rendering (dispatch errors, not command errors)

describe('CLIBuilder --json CLI-level error rendering', () => {
	it('renders "no commands registered" as JSON in --json mode', async () => {
		const app = cli('test');
		const result = await app.execute(['anything', '--json']);

		expect(result.exitCode).toBe(1);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('NO_ACTION');
		expect(parsed.error.message).toBe('No commands registered');
		expect(parsed.error.suggest).toBe(
			'Add commands via .command() or .default() before calling .run()',
		);
		// stderr should be empty — all output goes through json() to stdout
		expect(result.stderr).toEqual([]);
	});

	it('renders "no commands registered" as text without --json', async () => {
		const app = cli('test');
		const result = await app.execute(['anything']);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContainEqual('No commands registered\n');
	});

	it('renders "unknown command" as JSON in --json mode', async () => {
		const app = cli('test').command(dataCommand());
		const result = await app.execute(['nonexistent', '--json']);

		expect(result.exitCode).toBe(2);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('UNKNOWN_COMMAND');
		expect(parsed.error.message).toBe('Unknown command: nonexistent');
		expect(parsed.error.suggest).toBeDefined();
		// stderr should be empty — all output goes through json() to stdout
		expect(result.stderr).toEqual([]);
	});

	it('renders "unknown command" as text without --json', async () => {
		const app = cli('test').command(dataCommand());
		const result = await app.execute(['nonexistent']);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContainEqual('Unknown command: nonexistent\n');
	});

	it('renders "unknown command" with close-match suggestion as JSON', async () => {
		const app = cli('test').command(dataCommand());
		const result = await app.execute(['dat', '--json']);

		expect(result.exitCode).toBe(2);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('UNKNOWN_COMMAND');
		expect(parsed.error.suggest).toBe("Did you mean 'data'?");
	});

	it('jsonMode via options renders CLI-level errors as JSON', async () => {
		const app = cli('test');
		const result = await app.execute(['anything'], { jsonMode: true });

		expect(result.exitCode).toBe(1);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('NO_ACTION');
	});
});

// --- --json combined with --version / --help

describe('CLIBuilder --json with root flags', () => {
	it('--version still works with --json present', async () => {
		const app = cli('test').version('1.2.3').command(dataCommand());
		const result = await app.execute(['--version', '--json']);

		expect(result.exitCode).toBe(0);
		// Version is emitted via out.log — redirected to stderr in JSON mode
		expect(result.stderr).toContainEqual('1.2.3\n');
	});

	it('--help with --json emits the definition document on stdout', async () => {
		const app = cli('test').version('1.0.0').command(dataCommand());
		const result = await app.execute(['--help', '--json']);

		expect(result.exitCode).toBe(0);
		const doc: unknown = JSON.parse(result.stdout.join(''));
		expect(doc).toMatchObject({
			name: 'test',
			version: '1.0.0',
			commands: [
				{
					name: 'data',
					description: 'Get data',
					flags: { limit: { kind: 'number', presence: 'defaulted', defaultValue: 10 } },
				},
			],
		});
		// Machine-readable output only — no help text anywhere.
		expect(result.stderr).toEqual([]);
	});

	it('`help --json <command>` emits the command definition on stdout', async () => {
		const app = cli('test').version('1.0.0').command(dataCommand());
		const result = await app.execute(['help', '--json', 'data']);

		expect(result.exitCode).toBe(0);
		const doc: unknown = JSON.parse(result.stdout.join(''));
		expect(doc).toMatchObject({
			name: 'data',
			flags: { limit: { kind: 'number', defaultValue: 10 } },
		});
		expect(result.stderr).toEqual([]);
	});

	it('`<command> --help --json` emits the command definition on stdout', async () => {
		const app = cli('test').version('1.0.0').command(dataCommand());
		const result = await app.execute(['data', '--help', '--json']);

		expect(result.exitCode).toBe(0);
		const doc: unknown = JSON.parse(result.stdout.join(''));
		expect(doc).toMatchObject({
			name: 'data',
			flags: { limit: { kind: 'number', defaultValue: 10 } },
		});
		expect(result.stderr).toEqual([]);
	});

	it('command help emits JSON with a caller-supplied out channel', async () => {
		// An injected `out` predates the resolved JSON mode — the help branch
		// must honor `options.jsonMode` / root `--json`, not just the channel flag.
		const [out, captured] = createCaptureOutput();
		const app = cli('test').version('1.0.0').command(dataCommand());
		const result = await executeCLI(app, ['data', '--help', '--json'], { out, captured });

		expect(result.exitCode).toBe(0);
		const doc: unknown = JSON.parse(captured.stdout.join(''));
		expect(doc).toMatchObject({ name: 'data', flags: { limit: { kind: 'number' } } });
	});

	it('--help honors an explicit --json value (#85)', async () => {
		const app = cli('test').version('1.0.0').command(dataCommand());

		for (const token of ['--json=true', '--json=1']) {
			const machine = await app.execute(['--help', token]);
			expect(machine.exitCode).toBe(0);
			expect(JSON.parse(machine.stdout.join(''))).toMatchObject({ name: 'test' });
		}

		for (const token of ['--json=false', '--json=0']) {
			const human = await app.execute(['--help', token]);
			expect(human.exitCode).toBe(0);
			expect(human.stdout.join('')).toContain('Usage: test');
		}
	});

	it('<command> --help honors an explicit --json value (#85)', async () => {
		const app = cli('test').version('1.0.0').command(dataCommand());

		const machine = await app.execute(['data', '--help', '--json=true']);
		expect(JSON.parse(machine.stdout.join(''))).toMatchObject({ name: 'data' });

		const human = await app.execute(['data', '--help', '--json=false']);
		expect(human.stdout.join('')).toContain('Usage: test data');
	});

	it('json help output round-trips through JSON.parse regardless of flag order', async () => {
		const app = cli('test').version('1.0.0').command(dataCommand());
		for (const argv of [
			['--json', '--help'],
			['--help', '--json'],
		]) {
			const result = await app.execute(argv);
			expect(result.exitCode).toBe(0);
			const doc: unknown = JSON.parse(result.stdout.join(''));
			expect(doc).toMatchObject({
				commands: [{ name: 'data', flags: { limit: { kind: 'number' } } }],
			});
		}
	});
});
