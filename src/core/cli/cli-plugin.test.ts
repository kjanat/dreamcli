/**
 * Integration tests for CLI plugin lifecycle hooks.
 *
 * Verifies hook observation, ordering, and safe coexistence with middleware.
 */

import { describe, expect, it, vi } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { cli, plugin } from './index.ts';

// === Hook observation

describe('CLIBuilder.plugin() — hook observation', () => {
	it('observes argv and resolved values for the matched command', async () => {
		const beforeParse = vi.fn();
		const afterResolve = vi.fn();

		const deploy = command('deploy')
			.arg('target', arg.string())
			.flag('region', flag.string().env('DEPLOY_REGION'))
			.action(() => {});

		const app = cli('mycli').plugin(plugin({ beforeParse, afterResolve })).command(deploy);
		const result = await app.execute(['deploy', 'production'], {
			env: { DEPLOY_REGION: 'eu' },
		});

		expect(result.exitCode).toBe(0);
		expect(beforeParse).toHaveBeenCalledTimes(1);
		expect(beforeParse.mock.calls[0]?.[0]).toMatchObject({
			argv: ['production'],
			command: expect.objectContaining({ name: 'deploy' }),
			meta: expect.objectContaining({ command: 'deploy', name: 'mycli' }),
		});

		expect(afterResolve).toHaveBeenCalledTimes(1);
		expect(afterResolve.mock.calls[0]?.[0]).toMatchObject({
			args: { target: 'production' },
			flags: { region: 'eu' },
			deprecations: [],
			command: expect.objectContaining({ name: 'deploy' }),
		});
	});
});

// === Hook ordering

describe('CLIBuilder.plugin() — hook ordering', () => {
	it('runs hooks in registration order around middleware and action', async () => {
		const order: string[] = [];

		// biome-ignore lint/complexity/noBannedTypes: testing empty additions
		const trace = middleware<{}>(async ({ next }) => {
			order.push('middleware-before');
			await next({});
			order.push('middleware-after');
		});

		const deploy = command('deploy')
			.middleware(trace)
			.derive(() => {
				order.push('derive');
				return { ready: true };
			})
			.action(() => {
				order.push('action');
			});

		const app = cli('mycli')
			.plugin(
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
			)
			.command(deploy);

		const result = await app.execute(['deploy']);

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

	it('runs multiple plugins in registration order at each stage', async () => {
		const order: string[] = [];

		const first = plugin({
			beforeAction: () => {
				order.push('first-beforeAction');
			},
			afterAction: () => {
				order.push('first-afterAction');
			},
		});
		const second = plugin({
			beforeAction: () => {
				order.push('second-beforeAction');
			},
			afterAction: () => {
				order.push('second-afterAction');
			},
		});

		const app = cli('mycli')
			.plugin(first)
			.plugin(second)
			.command(
				command('deploy').action(() => {
					order.push('action');
				}),
			);

		const result = await app.execute(['deploy']);

		expect(result.exitCode).toBe(0);
		expect(order).toEqual([
			'first-beforeAction',
			'second-beforeAction',
			'action',
			'first-afterAction',
			'second-afterAction',
		]);
	});
});
