/**
 * Tests for --json mode integration through testkit runCommand().
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from './index.ts';

// --- Helpers

/** Command that uses json() output. */
function statusCommand() {
	return command('status')
		.description('Show status')
		.flag('verbose', flag.boolean().alias('v'))
		.action(({ flags, out }) => {
			if (out.jsonMode) {
				out.json({ status: 'ok', verbose: flags.verbose });
			} else {
				out.log('Status: ok');
				if (flags.verbose) {
					out.info('Verbose mode enabled');
				}
			}
		});
}

/** Command that mixes json() and log() calls. */
function mixedOutputCommand() {
	return command('mixed')
		.description('Mixed output')
		.action(({ out }) => {
			out.log('Starting...');
			out.json({ step: 1, data: 'processing' });
			out.info('Almost done');
			out.json({ step: 2, data: 'complete' });
		});
}

/** Command that always calls json() regardless of mode. */
function alwaysJsonCommand() {
	return command('data')
		.description('Get data')
		.action(({ out }) => {
			out.json({ items: [1, 2, 3] });
		});
}

// --- json() method in runCommand

describe('runCommand — json() output', () => {
	it('json() writes serialised JSON to stdout', async () => {
		const cmd = alwaysJsonCommand();
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['{"items":[1,2,3]}\n']);
	});

	it('json() and log() both go to stdout in normal mode', async () => {
		const cmd = mixedOutputCommand();
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			'Starting...\n',
			'{"step":1,"data":"processing"}\n',
			'Almost done\n',
			'{"step":2,"data":"complete"}\n',
		]);
		expect(result.stderr).toEqual([]);
	});

	it('handler can branch on out.jsonMode', async () => {
		const cmd = statusCommand();

		// Normal mode
		const normal = await runCommand(cmd, []);
		expect(normal.stdout).toEqual(['Status: ok\n']);

		// JSON mode
		const json = await runCommand(cmd, [], { jsonMode: true });
		expect(json.stdout).toEqual(['{"status":"ok","verbose":false}\n']);
		expect(json.stderr).toEqual([]);
	});
});

// --- jsonMode — output redirection in runCommand

describe('runCommand — jsonMode', () => {
	it('redirects log() to stderr in JSON mode', async () => {
		const cmd = mixedOutputCommand();
		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		// Only json() output on stdout
		expect(result.stdout).toEqual([
			'{"step":1,"data":"processing"}\n',
			'{"step":2,"data":"complete"}\n',
		]);
		// log/info redirected to stderr
		expect(result.stderr).toEqual(['Starting...\n', 'Almost done\n']);
	});

	it('renders CLIError as JSON to stdout in JSON mode', async () => {
		const cmd = command('fail')
			.flag('region', flag.enum(['us', 'eu']).required())
			.action(() => {});

		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(2);
		// Error should be JSON on stdout
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toHaveProperty('error');
		expect(parsed.error).toHaveProperty('code');
		expect(parsed.error).toHaveProperty('message');
	});

	it('renders thrown CLIError as JSON in JSON mode', async () => {
		const cmd = command('boom').action(() => {
			throw new CLIError('Something went wrong', {
				code: 'CUSTOM_ERROR',
				exitCode: 3,
				suggest: 'Try again',
				details: { context: 'test' },
			});
		});

		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(3);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('CUSTOM_ERROR');
		expect(parsed.error.message).toBe('Something went wrong');
		expect(parsed.error.suggest).toBe('Try again');
		expect(parsed.error.details).toEqual({ context: 'test' });
	});

	it('wraps unexpected errors as JSON in JSON mode', async () => {
		const cmd = command('crash').action(() => {
			throw new Error('kaboom');
		});

		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(1);
		expect(result.stdout.length).toBe(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('UNEXPECTED_ERROR');
		expect(parsed.error.message).toContain('kaboom');
	});

	it('renders errors to stderr in normal mode (not JSON)', async () => {
		const cmd = command('fail').action(() => {
			throw new CLIError('bad thing', { code: 'BAD', suggest: 'fix it' });
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContainEqual('bad thing\n');
		expect(result.stderr).toContainEqual('Suggestion: fix it\n');
	});
});
