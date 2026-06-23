/**
 * Contract tests for the current execution owner.
 *
 * These lock down the boundary the shared executor preserves without coupling
 * the suite to the current implementation shape.
 */

import { describe, expect, it, vi } from 'vitest';
import { plugin } from '#internals/core/cli/plugin.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { runCommand } from './index.ts';

describe('runCommand() executor contract', () => {
	it('runs lifecycle hooks around execution steps in stable order', async () => {
		const order: string[] = [];

		// biome-ignore lint/complexity/noBannedTypes: testing wrapper middleware without ctx additions
		const trace = middleware<{}>(async ({ next }) => {
			order.push('middleware-before');
			await next({});
			order.push('middleware-after');
		});

		const cmd = command('deploy')
			.middleware(trace)
			.derive(() => {
				order.push('derive');
				return { ready: true };
			})
			.action(() => {
				order.push('action');
			});

		const result = await runCommand(cmd, [], {
			plugins: [
				plugin({
					beforeParse: () => {
						order.push('beforeParse');
					},
					afterResolve: () => {
						order.push('afterResolve');
					},
					beforeAction: () => {
						order.push('beforeAction');
					},
					afterAction: () => {
						order.push('afterAction');
					},
				}),
			],
		});

		expect(result.exitCode).toBe(0);
		expect(order).toEqual([
			'beforeParse',
			'afterResolve',
			'beforeAction',
			'middleware-before',
			'derive',
			'action',
			'middleware-after',
			'afterAction',
		]);
	});

	it('does not run afterAction when execution fails', async () => {
		const order: string[] = [];

		const cmd = command('deploy')
			.derive(() => {
				order.push('derive');
				return { ready: true };
			})
			.action(() => {
				order.push('action');
				throw new CLIError('boom', { code: 'BOOM', exitCode: 9 });
			});

		const result = await runCommand(cmd, [], {
			plugins: [
				plugin({
					beforeAction: () => {
						order.push('beforeAction');
					},
					afterAction: () => {
						order.push('afterAction');
					},
				}),
			],
		});

		expect(result.exitCode).toBe(9);
		expect(result.error?.code).toBe('BOOM');
		expect(order).toEqual(['beforeAction', 'derive', 'action']);
	});

	it('assembles RunResult from injected output buffers', async () => {
		const [out, captured] = createCaptureOutput();
		const stopActive = vi.spyOn(out, 'stopActive');

		const cmd = command('build').action(({ out }) => {
			out.log('hello');
			out.warn('careful');
			const spinner = out.spinner('Working');
			spinner.succeed('Done');
		});

		const result = await runCommand(cmd, [], { out, captured });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['hello\n']);
		expect(result.stderr).toEqual(['careful\n']);
		expect(result.activity).toEqual([
			{ type: 'spinner:start', text: 'Working' },
			{ type: 'spinner:succeed', text: 'Done' },
		]);
		expect(result.error).toBeUndefined();
		expect(stopActive).toHaveBeenCalledTimes(1);
	});

	it('always cleans up injected output handles on failure', async () => {
		const [out, captured] = createCaptureOutput();
		const stopActive = vi.spyOn(out, 'stopActive');

		const cmd = command('build').action(({ out }) => {
			out.spinner('Working');
			throw new Error('kaboom');
		});

		const result = await runCommand(cmd, [], { out, captured });

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('UNEXPECTED_ERROR');
		expect(result.activity).toEqual([{ type: 'spinner:start', text: 'Working' }]);
		expect(stopActive).toHaveBeenCalledTimes(1);
	});

	it('always cleans up injected output handles on help exit', async () => {
		const [out, captured] = createCaptureOutput();
		const stopActive = vi.spyOn(out, 'stopActive');

		const cmd = command('build')
			.description('Build assets')
			.action(() => {});

		const result = await runCommand(cmd, ['--help'], { out, captured });

		expect(result.exitCode).toBe(0);
		expect(stopActive).toHaveBeenCalledTimes(1);
	});

	it('treats --help after -- as positional input', async () => {
		const cmd = command('echo')
			.arg('value', arg.string())
			.action(({ args, out }) => {
				out.log(args.value);
			});

		const result = await runCommand(cmd, ['--', '--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['--help\n']);
		expect(result.error).toBeUndefined();
	});

	it('treats -h after -- as positional input', async () => {
		const cmd = command('echo')
			.arg('value', arg.string())
			.action(({ args, out }) => {
				out.log(args.value);
			});

		const result = await runCommand(cmd, ['--', '-h']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['-h\n']);
		expect(result.error).toBeUndefined();
	});

	it('always cleans up injected output handles when action is missing', async () => {
		const [out, captured] = createCaptureOutput();
		const stopActive = vi.spyOn(out, 'stopActive');

		const cmd = command('build');

		const result = await runCommand(cmd, [], { out, captured });

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('NO_ACTION');
		expect(stopActive).toHaveBeenCalledTimes(1);
	});

	it('allows normal output with a requested non-zero exit code', async () => {
		const cmd = command('check').action(({ out }) => {
			out.log('degraded');
			out.setExitCode(7);
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(7);
		expect(result.stdout).toEqual(['degraded\n']);
		expect(result.stderr).toEqual([]);
		expect(result.error).toBeUndefined();
	});

	it('lets afterAction hooks override requested exit codes', async () => {
		const cmd = command('check').action(({ out }) => {
			out.setExitCode(3);
		});

		const result = await runCommand(cmd, [], {
			plugins: [
				plugin({
					afterAction: ({ out }) => {
						out.setExitCode(4);
					},
				}),
			],
		});

		expect(result.exitCode).toBe(4);
		expect(result.error).toBeUndefined();
	});

	it('does not leak requested exit codes across reused output channels', async () => {
		const [out, captured] = createCaptureOutput();
		const failingStatus = command('check').action(({ out }) => {
			out.setExitCode(5);
		});
		const healthyStatus = command('check').action(({ out }) => {
			out.log('ok');
		});

		const first = await runCommand(failingStatus, [], { out, captured });
		const second = await runCommand(healthyStatus, [], { out, captured });

		expect(first.exitCode).toBe(5);
		expect(second.exitCode).toBe(0);
		expect(second.error).toBeUndefined();
	});

	it('lets thrown CLIError exit codes win over requested exit codes', async () => {
		const cmd = command('check').action(({ out }) => {
			out.setExitCode(7);
			throw new CLIError('boom', { code: 'BOOM', exitCode: 3 });
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(3);
		expect(result.stderr).toEqual(['boom\n']);
		expect(result.error?.code).toBe('BOOM');
	});
});
