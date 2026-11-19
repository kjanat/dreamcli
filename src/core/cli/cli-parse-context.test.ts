import { describe, expect, it, vi } from 'vitest';
import { createOccurrenceRecorder, type ParseContext } from '#internals/core/parse/context.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command, group } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { cli, plugin } from './index.ts';

describe('parse.flag()', () => {
	it('keeps earlier history immutable while recording subsequent flags', () => {
		const { context, record } = createOccurrenceRecorder({});
		record('debug', '--debug', 0, false);
		const first = context.flag('debug');
		record('debug', '--no-debug', 1, true);
		expect(first.occurrences).toEqual([{ spelling: '--debug', index: 0, negated: false }]);
		expect(Object.isFrozen(first.occurrences)).toBe(true);
		expect(context.flag('debug').count).toBe(2);
	});

	it('retains typed spellings and leaf indexes across nested invocations', async () => {
		const contexts: ParseContext[] = [];
		const app = cli('demo').command(
			group('report')
				.flag('dry-run', flag.boolean().propagate())
				.command(
					command('export')
						.flag('output', flag.string().alias('o').alias('destination'))
						.action(({ parse }) => {
							contexts.push(parse);
						}),
				),
		);
		expect((await app.execute(['report', 'export', '--json', '-oFile', '--dryRun'])).exitCode).toBe(
			0,
		);
		expect((await app.execute(['report', 'export', '--destination=Elsewhere'])).exitCode).toBe(0);
		const [first, second] = contexts;
		expect.assert(first);
		expect.assert(second);
		expect(first.flag('output').occurrences).toEqual([
			{ spelling: '-o', index: 0, negated: false },
		]);
		expect(first.flag('dry-run').occurrences).toEqual([
			{ spelling: '--dryRun', index: 1, negated: false },
		]);
		expect(second.flag('output').occurrences).toEqual([
			{ spelling: '--destination', index: 0, negated: false },
		]);
		expect(second.flag('dry-run').present).toBe(false);
	});

	it('publishes deferred flag history only after successful interactive resolution', async () => {
		const resolved = vi.fn();
		const action = vi.fn();
		const app = cli('demo')
			.plugin(plugin({ afterResolve: resolved }))
			.command(
				command('login')
					.flag(
						'token',
						flag
							.custom((raw) => {
								if (raw !== 'valid') throw new Error('Invalid token');
								return true;
							})
							.sensitive(),
					)
					.interactive(() => ({ token: { kind: 'password', message: 'Token' } }))
					.action(({ parse }) => action(parse.flag('token'))),
			);
		expect((await app.execute(['login', '--token=valid'])).exitCode).toBe(0);
		expect(action).toHaveBeenCalledWith({
			present: true,
			count: 1,
			occurrences: [{ spelling: '--token', index: 0, negated: false }],
		});
		const invalid = await app.execute(['login', '--token=private-value', '--json']);
		expect(invalid.exitCode).not.toBe(0);
		const output = [...invalid.stdout, ...invalid.stderr].join('');
		expect(output).toContain('--token');
		expect(output).not.toContain('private-value');
		expect(resolved).toHaveBeenCalledTimes(1);
		expect(action).toHaveBeenCalledTimes(1);
	});

	it('distinguishes explicit negation from an override with the same resolved value and source', async () => {
		const observed = vi.fn();
		const cmd = command('build')
			.flag('debug', flag.boolean().negatable())
			.action(({ flags, sources, parse }) => {
				observed(flags.debug, sources.flags.debug, parse.flag('debug'));
			});
		const app = cli('demo').command(cmd);
		expect((await app.execute(['build', '--no-debug'])).exitCode).toBe(0);
		expect((await runCommand(cmd, ['--debug', '--no-debug'])).exitCode).toBe(0);
		expect(observed.mock.calls).toEqual([
			[
				false,
				{ stage: 'cli' },
				{
					present: true,
					count: 1,
					occurrences: [{ spelling: '--no-debug', index: 0, negated: true }],
				},
			],
			[
				false,
				{ stage: 'cli' },
				{
					present: true,
					count: 2,
					occurrences: [
						{ spelling: '--debug', index: 0, negated: false },
						{ spelling: '--no-debug', index: 1, negated: true },
					],
				},
			],
		]);
	});

	it('shares one immutable history across resolved hooks, derive, middleware and action', async () => {
		const contexts: ParseContext[] = [];
		const observe = ({ parse }: { parse: ParseContext }) => {
			contexts.push(parse);
		};
		const cmd = command('build')
			.flag('debug', flag.boolean().negatable({ alias: 'nodebug' }).duplicates('first'))
			.middleware(
				middleware(async (params) => {
					observe(params);
					await params.next({});
				}),
			)
			.derive(observe)
			.action((params) => {
				observe(params);
				expect(params.flags.debug).toBe(true);
			});
		const app = cli('demo')
			.plugin(
				plugin({
					afterResolve: observe,
					beforeAction: observe,
					afterAction: observe,
				}),
			)
			.command(cmd);
		expect((await app.execute(['build', '--debug', '--nodebug'])).exitCode).toBe(0);
		expect(contexts).toHaveLength(6);
		expect(new Set(contexts).size).toBe(1);
		const [context] = contexts;
		expect.assert(context);
		const info = context.flag('debug');
		expect(info.occurrences).toEqual([
			{ spelling: '--debug', index: 0, negated: false },
			{ spelling: '--nodebug', index: 1, negated: true },
		]);
		expect([context, info, info.occurrences, ...info.occurrences].every(Object.isFrozen)).toBe(
			true,
		);
	});

	it('counts grouped aliases and variadic flags once per spelling and excludes literal positionals', async () => {
		const cmd = command('build')
			.flag('verbose', flag.count().alias('v'))
			.flag('include', flag.array(flag.string(), { variadic: true }))
			.arg('tail', arg.string().variadic())
			.action(({ parse }) => {
				expect(parse.flag('verbose').occurrences).toEqual([
					{ spelling: '-v', index: 0, negated: false },
					{ spelling: '-v', index: 0, negated: false },
				]);
				expect(parse.flag('include').occurrences).toEqual([
					{ spelling: '--include', index: 1, negated: false },
				]);
			});
		expect(
			(await runCommand(cmd, ['-vv', '--include=src', 'tests', '--', '--include'])).exitCode,
		).toBe(0);
	});

	it('keeps CLI occurrences local to each invocation when the environment supplies the same value', async () => {
		const cmd = command('build')
			.flag('debug', flag.boolean().env('DEBUG').negatable())
			.action(({ flags, parse, out }) => {
				out.json({ value: flags.debug, ...parse.flag('debug') });
			});
		const [explicit, env] = await Promise.all([
			runCommand(cmd, ['--debug=false']),
			runCommand(cmd, [], { env: { DEBUG: 'false' } }),
		]);
		expect(JSON.parse(explicit.stdout.join(''))).toEqual({
			value: false,
			present: true,
			count: 1,
			occurrences: [{ spelling: '--debug', index: 0, negated: false }],
		});
		expect(JSON.parse(env.stdout.join(''))).toEqual({
			value: false,
			present: false,
			count: 0,
			occurrences: [],
		});
	});
});
