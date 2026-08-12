/**
 * Tests for --json mode integration through testkit runCommand().
 */

import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
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

// === runCommand

describe('runCommand', () => {
	// --- json() output

	describe('json() output', () => {
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

	// --- CLI-level --json in argv (#33)

	describe('argv --json flag', () => {
		it('enables JSON mode when --json is passed in argv', async () => {
			const cmd = statusCommand();

			const result = await runCommand(cmd, ['--json']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['{"status":"ok","verbose":false}\n']);
			expect(result.stderr).toEqual([]);
		});

		it('does not reject --json as an unknown flag', async () => {
			const cmd = statusCommand();

			const result = await runCommand(cmd, ['--json', '--verbose']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['{"status":"ok","verbose":true}\n']);
		});

		it('redirects log() to stderr when --json is in argv', async () => {
			const cmd = mixedOutputCommand();

			const result = await runCommand(cmd, ['--json']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual([
				'{"step":1,"data":"processing"}\n',
				'{"step":2,"data":"complete"}\n',
			]);
			expect(result.stderr).toEqual(['Starting...\n', 'Almost done\n']);
		});

		it('argv --json and { jsonMode: true } option both enable JSON mode', async () => {
			const cmd = statusCommand();

			const result = await runCommand(cmd, ['--json'], { jsonMode: true });

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['{"status":"ok","verbose":false}\n']);
		});

		it('renders a thrown CLIError as JSON when --json is in argv', async () => {
			const cmd = command('boom').action(() => {
				throw new CLIError('Something went wrong', { code: 'CUSTOM_ERROR', exitCode: 3 });
			});

			const result = await runCommand(cmd, ['--json']);

			expect(result.exitCode).toBe(3);
			expect(result.stdout.length).toBe(1);
			const parsed = JSON.parse(result.stdout[0] ?? '');
			expect(parsed.error.code).toBe('CUSTOM_ERROR');
		});

		it('treats a literal --json after the -- separator as a positional, not JSON mode', async () => {
			const cmd = command('echo')
				.arg('value', arg.string())
				.action(({ args, out }) => {
					out.log(`value=${args.value}`);
				});

			const result = await runCommand(cmd, ['--', '--json']);

			// Post-separator literal reaches the command unchanged; JSON mode off.
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['value=--json\n']);
		});

		it('reserves root --json even when the command declares its own json flag', async () => {
			// `--json` is a reserved root-level output flag: the planner and
			// `.execute()` strip it before the command schema parses, so a command's
			// own `--json` never reaches parse in the real CLI. runCommand mirrors
			// that exactly — guarding on the command schema would make the harness
			// diverge from real dispatch, defeating the point of #33.
			const cmd = command('emit')
				.flag('json', flag.boolean().describe('command-level json flag'))
				.action(({ flags, out }) => {
					out.log('progress');
					out.json({ commandJsonFlag: flags.json });
				});

			const result = await runCommand(cmd, ['--json']);

			expect(result.exitCode).toBe(0);
			// --json reserved for output mode (json() → stdout, log() → stderr), and the
			// command's own `json` flag never saw it — it stayed at its default.
			expect(result.stdout).toEqual(['{"commandJsonFlag":false}\n']);
			expect(result.stderr).toEqual(['progress\n']);
		});
	});

	// --- jsonMode

	describe('jsonMode', () => {
		it('keeps normal JSON payloads when a handler requests a non-zero exit code', async () => {
			const cmd = command('status').action(({ out }) => {
				out.json({ status: 'degraded' });
				out.setExitCode(7);
			});

			const result = await runCommand(cmd, [], { jsonMode: true });

			expect(result.exitCode).toBe(7);
			expect(result.stdout).toEqual(['{"status":"degraded"}\n']);
			expect(result.stderr).toEqual([]);
			expect(result.error).toBeUndefined();
		});

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

	describe('root-flag layer — --quiet', () => {
		/** Command emitting one status line (quiet-suppressible) and one log line. */
		function noisyCommand() {
			return command('noisy').action(({ out }) => {
				out.log('result');
				out.status('working');
			});
		}

		it('honors a CLI-level --quiet passed in argv', async () => {
			const result = await runCommand(noisyCommand(), ['--quiet']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['result\n']);
			expect(result.stderr).toEqual([]);
		});

		it('honors the -q short spelling', async () => {
			const result = await runCommand(noisyCommand(), ['-q']);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toEqual([]);
		});

		it('emits status output without --quiet', async () => {
			const result = await runCommand(noisyCommand(), []);

			expect(result.stdout).toEqual(['result\n']);
			expect(result.stderr).toEqual(['working\n']);
		});

		it('leaves a post-separator --quiet for the command', async () => {
			const cmd = command('echo')
				.arg('value', arg.string())
				.action(({ args, out }) => {
					out.log(args.value);
				});

			const result = await runCommand(cmd, ['--', '--quiet']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['--quiet\n']);
		});

		it('combines with --json', async () => {
			const result = await runCommand(noisyCommand(), ['--json', '--quiet']);

			expect(result.exitCode).toBe(0);
			// JSON mode redirects `log` to stderr; `status` stays suppressed.
			expect(result.stdout).toEqual([]);
			expect(result.stderr).toEqual(['result\n']);
		});
	});

	// --- Root flags with an explicit value (#85)

	describe('root-flag layer — explicit values (#85)', () => {
		/** Command emitting one status line (quiet-suppressible) and one log line. */
		function noisyCommand() {
			return command('noisy').action(({ out }) => {
				out.log('result');
				out.status('working');
			});
		}

		/** The same command run through real CLI dispatch, for parity assertions. */
		async function throughCli(argv: readonly string[]) {
			return cli('mycli').default(noisyCommand()).execute(argv);
		}

		it('--quiet=true suppresses status, --quiet=false keeps it', async () => {
			const quiet = await runCommand(noisyCommand(), ['--quiet=true']);
			expect(quiet.exitCode).toBe(0);
			expect(quiet.stdout).toEqual(['result\n']);
			expect(quiet.stderr).toEqual([]);

			const loud = await runCommand(noisyCommand(), ['--quiet=false']);
			expect(loud.stdout).toEqual(['result\n']);
			expect(loud.stderr).toEqual(['working\n']);
		});

		it('--json=true redirects log to stderr, --json=false does not', async () => {
			const json = await runCommand(noisyCommand(), ['--json=true']);
			expect(json.stdout).toEqual([]);
			expect(json.stderr).toEqual(['result\n', 'working\n']);

			const human = await runCommand(noisyCommand(), ['--json=false']);
			expect(human.stdout).toEqual(['result\n']);
			expect(human.stderr).toEqual(['working\n']);
		});

		it('takes the last occurrence of a repeated flag', async () => {
			const result = await runCommand(noisyCommand(), ['--quiet', '--quiet=false']);

			expect(result.stderr).toEqual(['working\n']);
		});

		it('combines --json=true with --quiet=false', async () => {
			const result = await runCommand(noisyCommand(), ['--json=true', '--quiet=false']);

			expect(result.stdout).toEqual([]);
			expect(result.stderr).toEqual(['result\n', 'working\n']);
		});

		it('leaves a post-separator --json=true for the command', async () => {
			const cmd = command('echo')
				.arg('value', arg.string())
				.action(({ args, out }) => {
					out.log(args.value);
				});

			const result = await runCommand(cmd, ['--', '--json=true']);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toEqual(['--json=true\n']);
		});

		it('rejects an invalid value exactly as CLI dispatch does', async () => {
			const harness = await runCommand(noisyCommand(), ['--quiet=banana']);
			const dispatched = await throughCli(['--quiet=banana']);

			expect(harness.exitCode).toBe(2);
			expect(harness.error?.code).toBe('INVALID_VALUE');
			expect(harness.stderr).toEqual([
				"Invalid boolean value 'banana' for flag --quiet. Use true/false or 1/0\n",
			]);
			expect(harness.exitCode).toBe(dispatched.exitCode);
			expect(harness.stdout).toEqual(dispatched.stdout);
			expect(harness.stderr).toEqual(dispatched.stderr);
		});

		it('renders an invalid value as JSON when --json is also set', async () => {
			const harness = await runCommand(noisyCommand(), ['--json', '--quiet=banana']);
			const dispatched = await throughCli(['--json', '--quiet=banana']);

			expect(harness.exitCode).toBe(2);
			expect(harness.stdout.length).toBe(1);
			const parsed = JSON.parse(harness.stdout[0] ?? '');
			expect(parsed.error.code).toBe('INVALID_VALUE');
			expect(parsed.error.details).toEqual({
				flag: 'quiet',
				input: '--quiet',
				value: 'banana',
				expected: 'boolean',
			});
			expect(harness.stdout).toEqual(dispatched.stdout);
			expect(harness.stderr).toEqual(dispatched.stderr);
		});

		it('renders --help ahead of an invalid value, as CLI dispatch does', async () => {
			const harness = await runCommand(noisyCommand(), ['--help', '--quiet=banana']);
			const dispatched = await throughCli(['--help', '--quiet=banana']);

			expect(harness.exitCode).toBe(0);
			expect(harness.stdout.join('')).toContain('Usage: noisy');
			expect(harness.exitCode).toBe(dispatched.exitCode);
			expect(harness.stderr).toEqual(dispatched.stderr);
		});

		it('leaves -q=true to the command, as CLI dispatch does', async () => {
			const harness = await runCommand(noisyCommand(), ['-q=true']);
			const dispatched = await throughCli(['-q=true']);

			expect(harness.exitCode).toBe(2);
			expect(harness.error?.code).toBe('UNKNOWN_FLAG');
			expect(harness.exitCode).toBe(dispatched.exitCode);
			expect(harness.stderr).toEqual(dispatched.stderr);
		});
	});
});
