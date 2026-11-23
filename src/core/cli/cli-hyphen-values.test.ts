import { describe, expect, it } from 'vitest';
import { readFlags } from '#internals/core/read-flags/index.ts';
import { command, group } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { cli, plugin } from './index.ts';

const token = flag.string().alias('t').allowHyphenValues();
const run = command('run')
	.flag('token', token)
	.flag('verbose', flag.boolean().alias('b'))
	.action(({ flags, out }) => out.log(flags.token ?? 'absent'));

describe('allowHyphenValues', () => {
	it.each(['-x', '-v', '--help', '--json', '--quiet', '--completions=bash', '--token'])(
		'delivers %s as a separate value to execute and inspect',
		async (value) => {
			const app = cli('demo')
				.version('1.0', { alias: 'v' })
				.default(run)
				.completions({ as: 'flag' });
			const argv = ['--token', value];
			const match = await app.inspect(argv);
			expect.assert(match.kind === 'match');
			expect(match.flags.token).toBe(value);
			expect((await app.execute(argv)).stdout).toEqual([`${value}\n`]);
		},
	);

	it('preserves the original short cluster, operand, and spelling for plugins and inspection', async () => {
		const observed: string[][] = [];
		const app = cli('demo')
			.plugin(
				plugin({
					beforeParse: ({ argv }) => {
						observed.push([...argv]);
					},
				}),
			)
			.command(group('admin').command(run));
		const match = await app.inspect(['admin', 'run', '-bt', '--help']);
		expect.assert(match.kind === 'match');
		expect(match.flags).toMatchObject({ token: '--help', verbose: true });
		expect(match.parse.flag('token').occurrences[0]?.spelling).toBe('-t');
		expect(observed).toEqual([['-bt', '--help']]);
	});

	it('uses the selected command schema and limits ownership to one adjacent token', async () => {
		const app = cli('demo')
			.version('1.0', { alias: 'v' })
			.default(run)
			.command(
				command('strict')
					.flag('token', flag.string())
					.action(() => {}),
			);
		expect((await app.inspect(['strict', '--token', '-v'])).kind).toBe('root-version');
		expect((await app.inspect(['--token', '-x', '-v'])).kind).toBe('root-version');
		expect((await app.execute(['--token', '--'])).error?.code).toBe('MISSING_VALUE');
		expect((await app.execute(['--token=--'])).stdout).toEqual(['--\n']);
		expect((await app.execute(['strict', '--token', '-x'])).error?.code).toBe('MISSING_VALUE');
	});

	it('claims the first variadic value and leaves subsequent option spellings available', async () => {
		const app = cli('demo').default(
			command('collect')
				.flag('items', flag.array(flag.string(), { variadic: true }).allowHyphenValues())
				.flag('verbose', flag.boolean())
				.action(() => {}),
		);
		const match = await app.inspect(['--items', '--help', 'second', '--verbose']);
		expect.assert(match.kind === 'match');
		expect(match.flags).toEqual({ items: ['--help', 'second'], verbose: true });
	});

	it.each([true, false])('honors ownership in readFlags with strict=%s', async (strict) => {
		expect(await readFlags({ token }, { argv: ['-t', '--help'], env: {}, strict })).toEqual({
			token: '--help',
		});
	});

	it('keeps an owned config flag through runtime preflight alongside a real output flag', async () => {
		const stdout: string[] = [];
		const app = cli('demo').config('demo', { noConfigFlag: true }).command(run);
		const adapter = createTestAdapter({
			argv: ['node', 'demo', '--no-config', 'run', '--quiet', '-t', '--config=missing'],
			stdout: (line) => stdout.push(line),
		});
		await expect(app.run({ adapter })).rejects.toMatchObject({ code: 0 });
		expect(stdout.join('')).toBe('--config=missing\n');
	});
});
