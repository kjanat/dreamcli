import { describe, expect, it, vi } from 'vitest';
import { command, group } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { cli, plugin } from './index.ts';

describe('CLIBuilder.inspect()', () => {
	it('resolves once and resumes once even when two consumers execute concurrently', async () => {
		const calls: string[] = [];
		const app = cli('ops')
			.plugin(
				plugin({
					beforeParse: () => {
						calls.push('observe');
					},
					transformArgv: ({ argv }) => {
						calls.push('transform');
						return {
							argv: argv.map((v) => (v === '--confirm' ? '--yes' : v)),
							metadata: { legacy: true },
						};
					},
					afterResolve: () => {
						calls.push('resolved');
					},
					beforeAction: () => {
						calls.push('before');
					},
					afterAction: () => {
						calls.push('after');
					},
				}),
			)
			.command(
				command('deploy')
					.flag('yes', flag.boolean())
					.flag('region', flag.string().env('REGION').required())
					.derive(() => {
						calls.push('derive');
						return { prefix: 'deploy' };
					})
					.middleware(
						middleware(async ({ next }) => {
							calls.push('middleware');
							await next({});
						}),
					)
					.action(({ out, ctx, flags }) => {
						calls.push('action');
						out.log(`${ctx.prefix} ${flags.region}`);
					}),
			);
		const env = { REGION: 'eu' };
		const match = await app.inspect(['deploy', '--confirm'], { env });
		expect.assert(match.kind === 'match');
		expect(match.path).toEqual(['deploy']);
		expect(match.flags).toEqual({ yes: true, region: 'eu' });
		expect(match.parse.flag('yes').occurrences[0]?.spelling).toBe('--yes');
		expect(match.parse.metadata).toEqual({ legacy: true });
		expect(match.provenance.flags.region?.stage).toBe('env');
		expect(calls).toEqual(['observe', 'transform']);
		env.REGION = 'changed';
		const first = match.execute();
		expect(match.execute()).toBe(first);
		const result = await first;
		expect(result.stdout).toEqual(['deploy eu\n']);
		expect(await match.execute()).toBe(result);
		expect(calls).toEqual([
			'observe',
			'transform',
			'resolved',
			'before',
			'derive',
			'middleware',
			'action',
			'after',
		]);
	});
	it('classifies builtin routes and dispatch errors before calling plugins', async () => {
		const beforeParse = vi.fn();
		const app = cli('ops')
			.version('1.2.3')
			.completions({ as: 'flag' })
			.plugin(plugin({ beforeParse }))
			.command(group('repo').command(command('list').action(() => {})));
		expect(await app.inspect(['--version'])).toEqual({ kind: 'root-version', version: '1.2.3' });
		expect(await app.inspect(['--help'])).toMatchObject({ kind: 'root-help', mode: 'short' });
		expect(await app.inspect(['--help=all'])).toMatchObject({ kind: 'root-help', mode: 'all' });
		expect(await app.inspect(['repo'])).toMatchObject({
			kind: 'command-help',
			schema: { name: 'repo' },
		});
		expect(await app.inspect(['repo', 'list', '--help=all'])).toMatchObject({
			kind: 'command-help',
			mode: 'all',
			path: ['repo', 'list'],
		});
		expect(await app.inspect(['--completions', 'bash'])).toEqual({
			kind: 'root-completions',
			shell: 'bash',
		});
		expect((await app.inspect(['__complete', 'bash'])).kind).toBe('dynamic-completion');
		expect((await app.inspect(['missing'])).kind).toBe('dispatch-error');
		expect(beforeParse).not.toHaveBeenCalled();
	});
	it('returns structured parse and resolution failures without invoking the action', async () => {
		const action = vi.fn();
		const app = cli('ops').command(
			command('send').flag('body', flag.string().required()).action(action),
		);
		expect(await app.inspect(['send', '--typo'])).toMatchObject({
			kind: 'command-error',
			stage: 'parse',
			error: { code: 'UNKNOWN_FLAG' },
		});
		expect(await app.inspect(['send'])).toMatchObject({
			kind: 'command-error',
			stage: 'resolve',
			error: { exitCode: 2 },
			parse: expect.anything(),
		});
		expect(action).not.toHaveBeenCalled();
	});
	it('uses injected answers for resolution and keeps the same prompt session inputs for action questions', async () => {
		const app = cli('ops').default(
			command('send')
				.flag(
					'recipient',
					flag.string().prompt({ kind: 'input', message: 'Recipient?' }).required(),
				)
				.action(async ({ flags, ask, out }) => {
					const body = await ask({ kind: 'input', message: 'Body?' });
					out.log(`${flags.recipient}: ${body}`);
				}),
		);
		expect((await app.inspect([])).kind).toBe('command-error');
		const match = await app.inspect([], { answers: ['Ada', 'Hello'] });
		expect.assert(match.kind === 'match');
		expect(match.flags.recipient).toBe('Ada');
		expect((await match.execute()).stdout).toEqual(['Ada: Hello\n']);
	});
	it('runs command constraints at execution and shares a failed result', async () => {
		const action = vi.fn();
		const app = cli('ops').default(
			command('run')
				.flag('left', flag.boolean())
				.flag('right', flag.boolean())
				.constrain((c) => [c.exactlyOne('left', 'right')])
				.action(action),
		);
		const match = await app.inspect(['--left', '--right']);
		expect.assert(match.kind === 'match');
		const result = await match.execute();
		expect(result.exitCode).toBeGreaterThan(0);
		expect(result).toEqual(await app.execute(['--left', '--right']));
		expect(await match.execute()).toBe(result);
		expect(action).not.toHaveBeenCalled();
	});
});
