/**
 * Contract tests for the current execution owner.
 *
 * These lock down the boundary a future shared executor must preserve without
 * coupling the suite to the current implementation shape.
 */

import { describe, expect, it, vi } from 'vitest';
import { plugin } from '#internals/core/cli/plugin.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
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
});
