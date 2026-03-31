/**
 * End-to-end output channel tests (json, table, TTY modes).
 *
 * Exercises the full pipeline: argv → parse → resolve → action → output capture
 * via both `runCommand()` (testkit) and `cli().execute()` (CLI dispatch).
 *
 * Focus areas:
 * - --json mode with json()/table()/log() through full pipeline
 * - Piped mode (non-TTY, non-JSON)
 * - TTY mode with decorative output branching
 * - Mixed output: interleaved json(), log(), table(), warn(), error()
 * - Verbosity × jsonMode × isTTY matrix
 * - Error rendering in all modes
 * - Capture output correctness across all channels
 */

import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { runCommand } from './index.ts';

// ---------------------------------------------------------------------------
// Reusable test commands
// ---------------------------------------------------------------------------

/** Command that exercises all output methods. */
function fullOutputCommand() {
	return command('report')
		.description('Generate a report')
		.flag('format', flag.enum(['text', 'json']).default('text'))
		.arg('name', arg.string())
		.action(({ args, flags, out }) => {
			out.log(`Report for ${args.name}`);
			out.info('Generating...');
			out.warn('Disk space low');
			out.json({ name: args.name, format: flags.format });
			out.table([
				{ metric: 'cpu', value: 42 },
				{ metric: 'mem', value: 87 },
			]);
			out.error('Encountered non-fatal issue');
		});
}

/** Command that branches on output mode. */
function modeBranchingCommand() {
	return command('status')
		.description('Show status')
		.flag('verbose', flag.boolean().alias('v'))
		.action(({ flags, out }) => {
			if (out.jsonMode) {
				out.json({ status: 'healthy', verbose: flags.verbose });
			} else if (out.isTTY) {
				out.log('=== System Status ===');
				out.log('Status: healthy');
				if (flags.verbose) {
					out.info('Uptime: 99.9%');
					out.info('Load: 0.42');
				}
			} else {
				out.log('Status: healthy');
				if (flags.verbose) {
					out.log('Uptime: 99.9%');
				}
			}
		});
}

/** Command that only uses table output. */
function tableCommand() {
	return command('list')
		.description('List items')
		.flag('limit', flag.number().default(10))
		.action(({ flags, out }) => {
			const items = [
				{ id: 1, name: 'Alpha', status: 'active' },
				{ id: 2, name: 'Beta', status: 'inactive' },
				{ id: 3, name: 'Gamma', status: 'active' },
			].slice(0, flags.limit);

			if (out.jsonMode) {
				out.json({ items, total: items.length });
			} else {
				out.log(`Showing ${String(items.length)} items:`);
				out.table(items, [
					{ key: 'id', header: 'ID' },
					{ key: 'name', header: 'Name' },
					{ key: 'status', header: 'Status' },
				]);
			}
		});
}

/** Command that produces multiple json() calls. */
function streamingJsonCommand() {
	return command('events')
		.description('Stream events')
		.action(({ out }) => {
			out.json({ type: 'start', ts: 1000 });
			out.log('Processing event 1');
			out.json({ type: 'data', payload: 'a' });
			out.log('Processing event 2');
			out.json({ type: 'data', payload: 'b' });
			out.json({ type: 'end', ts: 2000 });
		});
}

/** Command that throws a structured error. */
function failingCommand() {
	return command('deploy')
		.description('Deploy')
		.arg('target', arg.string())
		.action(() => {
			throw new CLIError('Deployment failed: target unreachable', {
				code: 'DEPLOY_FAILED',
				exitCode: 3,
				suggest: 'Check network connectivity',
				details: { timeout: 30 },
			});
		});
}

/** Command with middleware that uses output in middleware. */
function middlewareOutputCommand() {
	const logger = middleware<{ requestId: string }>(async ({ out, next }) => {
		out.info('[middleware] Starting request');
		await next({ requestId: 'req-42' });
		out.info('[middleware] Request complete');
	});

	return command('fetch')
		.description('Fetch data')
		.middleware(logger)
		.action(({ ctx, out }) => {
			out.log(`Fetching with request ${ctx.requestId}`);
			out.json({ requestId: ctx.requestId, data: 'result' });
		});
}

// ---------------------------------------------------------------------------
// e2e: --json mode through full pipeline (runCommand)
// ---------------------------------------------------------------------------

describe('e2e: --json mode through runCommand', () => {
	it('json() always writes to stdout, log/info redirect to stderr', async () => {
		const cmd = fullOutputCommand();
		const result = await runCommand(cmd, ['Alice'], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		// json() and table()-in-json-mode → stdout
		expect(result.stdout).toHaveLength(2);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			name: 'Alice',
			format: 'text',
		});
		// table emits rows as JSON array in json mode
		expect(JSON.parse(result.stdout[1] ?? '')).toEqual([
			{ metric: 'cpu', value: 42 },
			{ metric: 'mem', value: 87 },
		]);
		// log, info, warn, error → stderr
		expect(result.stderr).toContainEqual('Report for Alice\n');
		expect(result.stderr).toContainEqual('Generating...\n');
		expect(result.stderr).toContainEqual('Disk space low\n');
		expect(result.stderr).toContainEqual('Encountered non-fatal issue\n');
	});

	it('handler branches on out.jsonMode for structured output', async () => {
		const cmd = modeBranchingCommand();

		const jsonResult = await runCommand(cmd, ['-v'], { jsonMode: true });
		expect(jsonResult.exitCode).toBe(0);
		expect(jsonResult.stdout).toHaveLength(1);
		expect(JSON.parse(jsonResult.stdout[0] ?? '')).toEqual({
			status: 'healthy',
			verbose: true,
		});
		expect(jsonResult.stderr).toEqual([]);

		const textResult = await runCommand(cmd, ['-v']);
		expect(textResult.exitCode).toBe(0);
		expect(textResult.stdout.length).toBeGreaterThan(0);
		expect(textResult.stdout).toContainEqual('Status: healthy\n');
	});

	it('multiple json() calls produce multiple stdout lines', async () => {
		const cmd = streamingJsonCommand();
		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		// 4 json() calls → 4 stdout lines
		expect(result.stdout).toHaveLength(4);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({ type: 'start', ts: 1000 });
		expect(JSON.parse(result.stdout[1] ?? '')).toEqual({ type: 'data', payload: 'a' });
		expect(JSON.parse(result.stdout[2] ?? '')).toEqual({ type: 'data', payload: 'b' });
		expect(JSON.parse(result.stdout[3] ?? '')).toEqual({ type: 'end', ts: 2000 });
		// log() → stderr
		expect(result.stderr).toContainEqual('Processing event 1\n');
		expect(result.stderr).toContainEqual('Processing event 2\n');
	});

	it('table() in json mode emits full row data (ignores column filter)', async () => {
		const cmd = tableCommand();
		const result = await runCommand(cmd, ['--limit', '2'], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toHaveLength(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({
			items: [
				{ id: 1, name: 'Alpha', status: 'active' },
				{ id: 2, name: 'Beta', status: 'inactive' },
			],
			total: 2,
		});
	});
});

// ---------------------------------------------------------------------------
// e2e: piped mode (non-TTY, non-JSON) through runCommand
// ---------------------------------------------------------------------------

describe('e2e: piped mode through runCommand', () => {
	it('log/info → stdout, warn/error → stderr, no JSON redirection', async () => {
		const cmd = fullOutputCommand();
		const result = await runCommand(cmd, ['Bob'], { isTTY: false });

		expect(result.exitCode).toBe(0);
		// stdout: log, info, json (as text), table (as text)
		expect(result.stdout).toContainEqual('Report for Bob\n');
		expect(result.stdout).toContainEqual('Generating...\n');
		// json() still goes to stdout in non-JSON mode
		expect(result.stdout).toContainEqual('{"name":"Bob","format":"text"}\n');
		// stderr: warn, error
		expect(result.stderr).toContainEqual('Disk space low\n');
		expect(result.stderr).toContainEqual('Encountered non-fatal issue\n');
	});

	it('table renders as aligned text in piped mode', async () => {
		const cmd = tableCommand();
		const result = await runCommand(cmd, [], { isTTY: false });

		expect(result.exitCode).toBe(0);
		// Find the table output line
		const tableOutput = result.stdout.find((line) => line.includes('Alpha') && line.includes('ID'));
		expect(tableOutput).toBeDefined();
		// Should NOT be JSON array
		expect(tableOutput).not.toMatch(/^\[/);
	});

	it('handler sees isTTY=false and omits decorative output', async () => {
		const cmd = modeBranchingCommand();
		const result = await runCommand(cmd, ['-v'], { isTTY: false });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContainEqual('Status: healthy\n');
		expect(result.stdout).toContainEqual('Uptime: 99.9%\n');
		// No decorative header
		expect(result.stdout).not.toContainEqual('=== System Status ===\n');
	});
});

// ---------------------------------------------------------------------------
// e2e: TTY mode through runCommand
// ---------------------------------------------------------------------------

describe('e2e: TTY mode through runCommand', () => {
	it('handler sees isTTY=true and uses decorative output', async () => {
		const cmd = modeBranchingCommand();
		const result = await runCommand(cmd, ['-v'], { isTTY: true });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContainEqual('=== System Status ===\n');
		expect(result.stdout).toContainEqual('Status: healthy\n');
		expect(result.stdout).toContainEqual('Uptime: 99.9%\n');
		expect(result.stdout).toContainEqual('Load: 0.42\n');
	});

	it('table renders as aligned text in TTY mode', async () => {
		const cmd = tableCommand();
		const result = await runCommand(cmd, [], { isTTY: true });

		expect(result.exitCode).toBe(0);
		const tableOutput = result.stdout.find((line) => line.includes('Name'));
		expect(tableOutput).toBeDefined();
		// Aligned text — contains headers + separator + data
		expect(tableOutput).toContain('ID');
		expect(tableOutput).toContain('Name');
		expect(tableOutput).toContain('Status');
	});

	it('jsonMode overrides isTTY for output decisions', async () => {
		const cmd = modeBranchingCommand();
		const result = await runCommand(cmd, ['-v'], { isTTY: true, jsonMode: true });

		expect(result.exitCode).toBe(0);
		// Should have taken the jsonMode branch despite isTTY=true
		expect(result.stdout).toHaveLength(1);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			status: 'healthy',
			verbose: true,
		});
		// No decorative output on stderr
		expect(result.stderr).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// e2e: mixed output — interleaved json(), log(), table(), warn(), error()
// ---------------------------------------------------------------------------

describe('e2e: mixed output through full pipeline', () => {
	it('normal mode: all methods write to expected channels', async () => {
		const cmd = fullOutputCommand();
		const result = await runCommand(cmd, ['Charlie']);

		expect(result.exitCode).toBe(0);
		// stdout: log, info, json, table (text)
		expect(result.stdout.length).toBeGreaterThanOrEqual(4);
		expect(result.stdout[0]).toBe('Report for Charlie\n');
		expect(result.stdout[1]).toBe('Generating...\n');
		expect(result.stdout[2]).toBe('{"name":"Charlie","format":"text"}\n');
		// table output is a single call to log()
		const tableStr = result.stdout[3] ?? '';
		expect(tableStr).toContain('metric');
		expect(tableStr).toContain('cpu');
		expect(tableStr).toContain('mem');
		// stderr: warn, error
		expect(result.stderr).toEqual(['Disk space low\n', 'Encountered non-fatal issue\n']);
	});

	it('streaming json in normal mode: json()+log() interleave on stdout', async () => {
		const cmd = streamingJsonCommand();
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		// In normal mode, json() AND log() both go to stdout
		expect(result.stdout).toEqual([
			'{"type":"start","ts":1000}\n',
			'Processing event 1\n',
			'{"type":"data","payload":"a"}\n',
			'Processing event 2\n',
			'{"type":"data","payload":"b"}\n',
			'{"type":"end","ts":2000}\n',
		]);
		expect(result.stderr).toEqual([]);
	});

	it('middleware output interleaves correctly in normal mode', async () => {
		const cmd = middlewareOutputCommand();
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		// info messages + log + json all on stdout in normal mode
		expect(result.stdout).toContainEqual('[middleware] Starting request\n');
		expect(result.stdout).toContainEqual('Fetching with request req-42\n');
		expect(result.stdout).toContainEqual('{"requestId":"req-42","data":"result"}\n');
		expect(result.stdout).toContainEqual('[middleware] Request complete\n');
	});

	it('middleware output respects json mode redirection', async () => {
		const cmd = middlewareOutputCommand();
		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(0);
		// json() → stdout
		expect(result.stdout).toEqual(['{"requestId":"req-42","data":"result"}\n']);
		// info/log → stderr in json mode
		expect(result.stderr).toContainEqual('[middleware] Starting request\n');
		expect(result.stderr).toContainEqual('Fetching with request req-42\n');
		expect(result.stderr).toContainEqual('[middleware] Request complete\n');
	});
});

// ---------------------------------------------------------------------------
// e2e: verbosity × jsonMode × isTTY matrix
// ---------------------------------------------------------------------------

describe('e2e: verbosity × jsonMode × isTTY combinations', () => {
	it('quiet + normal: info suppressed, log/json/table visible', async () => {
		const cmd = fullOutputCommand();
		const result = await runCommand(cmd, ['Dave'], { verbosity: 'quiet' });

		expect(result.exitCode).toBe(0);
		// info ("Generating...") suppressed
		expect(result.stdout).not.toContainEqual('Generating...\n');
		// log still visible
		expect(result.stdout).toContainEqual('Report for Dave\n');
		// json still visible
		expect(result.stdout).toContainEqual('{"name":"Dave","format":"text"}\n');
	});

	it('quiet + jsonMode: info suppressed, log → stderr, json → stdout', async () => {
		const cmd = fullOutputCommand();
		const result = await runCommand(cmd, ['Eve'], {
			verbosity: 'quiet',
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		// json() + table-as-json → stdout
		expect(result.stdout).toHaveLength(2);
		// info suppressed in quiet mode — not even on stderr
		expect(result.stderr).not.toContainEqual('Generating...\n');
		// log → stderr (json mode redirect)
		expect(result.stderr).toContainEqual('Report for Eve\n');
		// warn/error still on stderr
		expect(result.stderr).toContainEqual('Disk space low\n');
	});

	it('quiet + TTY: info suppressed, decorative output for log', async () => {
		const cmd = modeBranchingCommand();
		const result = await runCommand(cmd, ['-v'], {
			verbosity: 'quiet',
			isTTY: true,
		});

		expect(result.exitCode).toBe(0);
		// log output (decorative) still visible
		expect(result.stdout).toContainEqual('=== System Status ===\n');
		expect(result.stdout).toContainEqual('Status: healthy\n');
		// info suppressed in quiet mode
		expect(result.stdout).not.toContainEqual('Uptime: 99.9%\n');
		expect(result.stdout).not.toContainEqual('Load: 0.42\n');
	});

	it('quiet + jsonMode + TTY: json branch, info suppressed', async () => {
		const cmd = modeBranchingCommand();
		const result = await runCommand(cmd, ['-v'], {
			verbosity: 'quiet',
			jsonMode: true,
			isTTY: true,
		});

		expect(result.exitCode).toBe(0);
		// jsonMode branch taken despite TTY
		expect(result.stdout).toHaveLength(1);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			status: 'healthy',
			verbose: true,
		});
	});

	it('normal verbosity preserves all output channels', async () => {
		const cmd = fullOutputCommand();
		const result = await runCommand(cmd, ['Frank'], { verbosity: 'normal' });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContainEqual('Report for Frank\n');
		expect(result.stdout).toContainEqual('Generating...\n');
		expect(result.stderr).toContainEqual('Disk space low\n');
		expect(result.stderr).toContainEqual('Encountered non-fatal issue\n');
	});
});

// ---------------------------------------------------------------------------
// e2e: error rendering in all output modes
// ---------------------------------------------------------------------------

describe('e2e: error rendering across output modes', () => {
	it('CLIError as text in normal mode', async () => {
		const cmd = failingCommand();
		const result = await runCommand(cmd, ['prod']);

		expect(result.exitCode).toBe(3);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toContainEqual('Deployment failed: target unreachable\n');
		expect(result.stderr).toContainEqual('Suggestion: Check network connectivity\n');
		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe('DEPLOY_FAILED');
	});

	it('CLIError as JSON in json mode', async () => {
		const cmd = failingCommand();
		const result = await runCommand(cmd, ['prod'], { jsonMode: true });

		expect(result.exitCode).toBe(3);
		expect(result.stdout).toHaveLength(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error).toEqual({
			name: 'CLIError',
			code: 'DEPLOY_FAILED',
			message: 'Deployment failed: target unreachable',
			exitCode: 3,
			suggest: 'Check network connectivity',
			details: { timeout: 30 },
		});
		expect(result.stderr).toEqual([]);
	});

	it('unexpected error wrapped as JSON in json mode', async () => {
		const cmd = command('crash').action(() => {
			throw new TypeError('Cannot read property of undefined');
		});
		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toHaveLength(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('UNEXPECTED_ERROR');
		expect(parsed.error.message).toContain('Cannot read property of undefined');
	});

	it('unexpected error as text in normal mode', async () => {
		const cmd = command('crash').action(() => {
			throw new TypeError('Cannot read property of undefined');
		});
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toEqual([]);
		expect(result.stderr.some((line) => line.includes('Cannot read property of undefined'))).toBe(
			true,
		);
	});

	it('validation error (missing required flag) in json mode', async () => {
		const cmd = command('strict')
			.flag('region', flag.enum(['us', 'eu']).required())
			.action(() => {});
		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.exitCode).toBeGreaterThan(0);
		expect(result.stdout).toHaveLength(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error).toBeDefined();
		expect(parsed.error.code).toBeDefined();
	});

	it('validation error (missing required flag) in normal mode', async () => {
		const cmd = command('strict')
			.flag('region', flag.enum(['us', 'eu']).required())
			.action(() => {});
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBeGreaterThan(0);
		expect(result.stdout).toEqual([]);
		expect(result.stderr.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// e2e: CLI dispatch path (cli().execute()) output modes
// ---------------------------------------------------------------------------

describe('e2e: CLI dispatch output modes', () => {
	it('--json flag: command json() → stdout, log/info → stderr', async () => {
		const app = cli('testcli').command(modeBranchingCommand()).command(tableCommand());

		const result = await app.execute(['status', '-v', '--json']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toHaveLength(1);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			status: 'healthy',
			verbose: true,
		});
	});

	it('table command through CLI dispatch in json mode', async () => {
		const app = cli('testcli').command(tableCommand());
		const result = await app.execute(['list', '--limit', '2', '--json']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toHaveLength(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({
			items: [
				{ id: 1, name: 'Alpha', status: 'active' },
				{ id: 2, name: 'Beta', status: 'inactive' },
			],
			total: 2,
		});
	});

	it('table command through CLI dispatch in normal mode', async () => {
		const app = cli('testcli').command(tableCommand());
		const result = await app.execute(['list', '--limit', '2']);

		expect(result.exitCode).toBe(0);
		// Text output: log header + table
		expect(result.stdout).toContainEqual('Showing 2 items:\n');
		const tableOutput = result.stdout.find((line) => line.includes('Alpha'));
		expect(tableOutput).toBeDefined();
		expect(tableOutput).toContain('Name');
	});

	it('dispatch error as JSON with --json flag', async () => {
		const app = cli('testcli').command(tableCommand());
		const result = await app.execute(['nonexistent', '--json']);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toHaveLength(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.error.code).toBe('UNKNOWN_COMMAND');
	});

	it('dispatch error as text without --json', async () => {
		const app = cli('testcli').command(tableCommand());
		const result = await app.execute(['nonexistent']);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toEqual([]);
		expect(result.stderr.some((line) => line.includes('Unknown command'))).toBe(true);
	});

	it('isTTY propagates through CLI dispatch', async () => {
		const app = cli('testcli').command(modeBranchingCommand());

		const tty = await app.execute(['status', '-v'], { isTTY: true });
		expect(tty.stdout).toContainEqual('=== System Status ===\n');

		const piped = await app.execute(['status', '-v'], { isTTY: false });
		expect(piped.stdout).not.toContainEqual('=== System Status ===\n');
		expect(piped.stdout).toContainEqual('Status: healthy\n');
	});

	it('verbosity propagates through CLI dispatch', async () => {
		const app = cli('testcli').command(fullOutputCommand());

		const normal = await app.execute(['report', 'Test']);
		expect(normal.stdout).toContainEqual('Generating...\n');

		const quiet = await app.execute(['report', 'Test'], { verbosity: 'quiet' });
		expect(quiet.stdout).not.toContainEqual('Generating...\n');
		expect(quiet.stdout).toContainEqual('Report for Test\n');
	});
});

// ---------------------------------------------------------------------------
// e2e: capture output correctness
// ---------------------------------------------------------------------------

describe('e2e: capture output correctness', () => {
	it('empty command produces no output', async () => {
		const cmd = command('noop').action(() => {});
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toEqual([]);
	});

	it('each output method appends newline', async () => {
		const cmd = command('newlines').action(({ out }) => {
			out.log('a');
			out.info('b');
			out.warn('c');
			out.error('d');
			out.json('e');
		});
		const result = await runCommand(cmd, []);

		for (const line of result.stdout) {
			expect(line.endsWith('\n')).toBe(true);
		}
		for (const line of result.stderr) {
			expect(line.endsWith('\n')).toBe(true);
		}
	});

	it('table with empty rows produces no extra output', async () => {
		const cmd = command('empty-table').action(({ out }) => {
			out.log('before');
			out.table([]);
			out.log('after');
		});
		const result = await runCommand(cmd, []);

		expect(result.stdout).toEqual(['before\n', 'after\n']);
	});

	it('json serialises complex nested structures', async () => {
		const complex = {
			users: [
				{ id: 1, profile: { name: 'Alice', tags: ['admin', 'dev'] } },
				{ id: 2, profile: { name: 'Bob', tags: [] } },
			],
			meta: { page: 1, total: 2, nested: { deep: true } },
		};
		const cmd = command('complex').action(({ out }) => {
			out.json(complex);
		});
		const result = await runCommand(cmd, []);

		expect(result.stdout).toHaveLength(1);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual(complex);
	});

	it('multiple independent commands have isolated output', async () => {
		const cmd = command('a').action(({ out }) => {
			out.log('from-a');
		});

		const result1 = await runCommand(cmd, []);
		const result2 = await runCommand(cmd, []);

		expect(result1.stdout).toEqual(['from-a\n']);
		expect(result2.stdout).toEqual(['from-a\n']);
		// Ensure no leakage between runs
		expect(result1.stdout).toHaveLength(1);
		expect(result2.stdout).toHaveLength(1);
	});

	it('--help output captured correctly', async () => {
		const cmd = command('documented')
			.description('A well-documented command')
			.flag('verbose', flag.boolean().describe('Enable verbose output'))
			.action(() => {});
		const result = await runCommand(cmd, ['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBeGreaterThan(0);
		const text = result.stdout.join('');
		expect(text).toContain('documented');
		expect(text).toContain('A well-documented command');
	});
});

// ---------------------------------------------------------------------------
// e2e: table auto-columns through pipeline
// ---------------------------------------------------------------------------

describe('e2e: table features through full pipeline', () => {
	it('auto-inferred columns from row keys', async () => {
		const cmd = command('auto-table').action(({ out }) => {
			out.table([
				{ name: 'Alice', age: 30, role: 'admin' },
				{ name: 'Bob', age: 25, role: 'user' },
			]);
		});
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		const text = result.stdout.join('');
		expect(text).toContain('name');
		expect(text).toContain('age');
		expect(text).toContain('role');
		expect(text).toContain('Alice');
		expect(text).toContain('Bob');
	});

	it('explicit columns filter and order output', async () => {
		const cmd = command('explicit-table').action(({ out }) => {
			out.table(
				[
					{ id: 1, name: 'X', extra: 'hidden' },
					{ id: 2, name: 'Y', extra: 'hidden' },
				],
				[
					{ key: 'name', header: 'Item Name' },
					{ key: 'id', header: '#' },
				],
			);
		});
		const result = await runCommand(cmd, []);

		const text = result.stdout.join('');
		expect(text).toContain('Item Name');
		expect(text).toContain('#');
		expect(text).not.toContain('extra');
		expect(text).not.toContain('hidden');
	});

	it('table with null/undefined values renders cleanly', async () => {
		const cmd = command('null-table').action(({ out }) => {
			out.table([{ a: null, b: undefined, c: 'ok' }]);
		});
		const result = await runCommand(cmd, []);

		const text = result.stdout.join('');
		expect(text).toContain('ok');
		expect(text).not.toContain('null');
		expect(text).not.toContain('undefined');
	});

	it('table in json mode emits full rows regardless of column spec', async () => {
		const cmd = command('table-json').action(({ out }) => {
			out.table([{ id: 1, name: 'A', secret: 'data' }], [{ key: 'name' }]);
		});
		const result = await runCommand(cmd, [], { jsonMode: true });

		expect(result.stdout).toHaveLength(1);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual([{ id: 1, name: 'A', secret: 'data' }]);
	});
});
