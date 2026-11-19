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
			skippedPathChecks: [],
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

describe('transformArgv', () => {
	it('preserves argv when named and inline transforms return nothing', async () => {
		async function observe() {}
		const app = cli('demo')
			.plugin(plugin({ transformArgv: observe }))
			.plugin(plugin({ transformArgv() {} }))
			.plugin(plugin({ async transformArgv() {} }))
			.command(
				command('deploy')
					.flag('region', flag.string().required())
					.action(({ flags, out }) => out.log(flags.region)),
			);
		const result = await app.execute(['deploy', '--region', 'eu']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['eu\n']);
	});

	it('awaits transforms in registration order and exposes their metadata and final spellings', async () => {
		const seen = vi.fn();
		const original = ['deploy', '--legacy'];
		// A previously ignored return value from an observer stays ignored.
		const observe: () => void = () => ({ argv: ['--ignored'] });
		const app = cli('demo')
			.plugin(
				plugin({
					beforeParse: observe,
					transformArgv: async ({ argv, metadata }) => {
						expect(argv).toEqual(['--legacy']);
						expect(metadata).toEqual({});
						await Promise.resolve();
						return { argv: ['--region', 'eu'], metadata: { legacy: true, source: 'first' } };
					},
				}),
			)
			.plugin(
				plugin({
					beforeParse: ({ argv }) => {
						expect(argv).toEqual(['--legacy']);
					},
					transformArgv: ({ argv, metadata }) => {
						expect(argv).toEqual(['--region', 'eu']);
						expect(metadata).toEqual({ legacy: true, source: 'first' });
						expect(Object.isFrozen(argv) && Object.isFrozen(metadata)).toBe(true);
						return { metadata: { source: 'second' } };
					},
					afterResolve: ({ parse }) => {
						seen(parse.metadata);
					},
				}),
			)
			.command(
				command('deploy')
					.flag('region', flag.string())
					.action(({ flags, parse }) => {
						seen(flags.region, parse.flag('region').occurrences, parse.metadata);
					}),
			);
		expect((await app.execute(original)).exitCode).toBe(0);
		expect(original).toEqual(['deploy', '--legacy']);
		expect(seen.mock.calls).toEqual([
			[{ legacy: true, source: 'second' }],
			[
				'eu',
				[{ spelling: '--region', index: 0, negated: false }],
				{ legacy: true, source: 'second' },
			],
		]);
	});

	it('keeps metadata local to concurrent runs and accepts an empty replacement', async () => {
		const app = cli('demo')
			.plugin(
				plugin({
					transformArgv: ({ argv }) =>
						argv.length ? { argv: [], metadata: { previous: argv[0] } } : undefined,
				}),
			)
			.default(
				command('run').action(({ parse, out }) => {
					out.json(parse.metadata);
				}),
			);
		const [rewritten, untouched] = await Promise.all([app.execute(['--old']), app.execute([])]);
		expect(rewritten.exitCode).toBe(0);
		expect(untouched.exitCode).toBe(0);
		expect(JSON.parse(rewritten.stdout.join(''))).toEqual({ previous: '--old' });
		expect(JSON.parse(untouched.stdout.join(''))).toEqual({});
	});

	it('short-circuits help and stops the chain when a transform rejects', async () => {
		const fail = vi.fn(async () => {
			throw new Error('bad migration');
		});
		const downstream = vi.fn();
		const app = cli('demo')
			.plugin(plugin({ transformArgv: fail }))
			.plugin(plugin({ transformArgv: downstream }))
			.command(command('deploy').action(downstream));
		expect((await app.execute(['deploy', '--help'])).exitCode).toBe(0);
		expect(fail).not.toHaveBeenCalled();
		const result = await app.execute(['deploy']);
		expect(result.error?.message).toContain('bad migration');
		expect(result.exitCode).toBe(1);
		expect(downstream).not.toHaveBeenCalled();
	});
});
