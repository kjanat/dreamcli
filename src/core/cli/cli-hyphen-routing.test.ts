import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command, group } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { cli } from './index.ts';

const token = flag.string().alias('t').allowHyphenValues();
const run = command('run')
	.alias('r')
	.flag('token', token)
	.action(({ flags, out }) => out.log(flags.token ?? 'absent'));

describe('routing dash-prefixed flag operands', () => {
	it('retains an unclaimed lone dash before a named route', async () => {
		const app = cli('demo').command(
			command('read')
				.arg('input', arg.string())
				.action(() => {}),
		);
		expect(await app.inspect(['-', 'read'])).toMatchObject({
			kind: 'match',
			path: ['read'],
			args: { input: '-' },
		});
	});

	it('preserves default arity for a named route with overlapping non-opted-in flags', async () => {
		const app = cli('demo')
			.default(
				command('fallback')
					.flag('left', flag.string())
					.flag('right', flag.string())
					.flag('mode', flag.enum(['root']))
					.action(() => {}),
			)
			.command(
				command('named')
					.flag('left', flag.boolean())
					.flag('right', flag.boolean())
					.flag('mode', flag.enum(['named']))
					.action(() => {}),
			);
		expect(await app.inspect(['--left', '--right', 'named', '--mode', 'named'])).toMatchObject({
			kind: 'match',
			path: ['named'],
			flags: { left: true, right: true, mode: 'named' },
		});
	});

	it.each([
		['parent', '--token', '--label', 'r'],
		['parent', '--token=--label', 'r'],
		['parent', '-t', '-l', 'r'],
	])('dispatches through a parent whose value flag is an operand (%j)', async (...argv) => {
		const app = cli('demo').command(
			group('parent').flag('label', flag.string().alias('l').propagate()).command(run),
		);
		const result = await app.inspect(argv);
		expect(result).toMatchObject({
			kind: 'match',
			path: ['parent', 'run'],
			flags: { token: argv.includes('-t') ? '-l' : '--label' },
		});
	});

	it('distinguishes a named route’s operand from the default command’s option', async () => {
		const app = cli('demo')
			.default(
				command('default')
					.flag('mode', flag.string())
					.action(() => {}),
			)
			.command(run);
		expect(await app.inspect(['--token', '--mode', 'run'])).toMatchObject({
			kind: 'match',
			path: ['run'],
			flags: { token: '--mode' },
		});
		expect(await app.inspect(['--mode', 'run'])).toMatchObject({
			kind: 'match',
			flags: { mode: 'run' },
		});
	});

	it.each(['--json', '--quiet'])(
		'routes an owned %s and the next value to a variadic default',
		async (value) => {
			const app = cli('demo')
				.default(
					command('collect')
						.flag('items', flag.array(flag.string(), { variadic: true }).allowHyphenValues())
						.action(() => {}),
				)
				.command(run);
			const collected = { kind: 'match', flags: { items: [value, 'run'] } };
			expect(await app.inspect(['--items', value, 'run'])).toMatchObject(collected);
			expect(await app.inspect([`--items=${value}`, 'run'])).toMatchObject(collected);
			expect(await app.inspect(['run', '--token', value])).toMatchObject({
				kind: 'match',
				path: ['run'],
				flags: { token: value },
			});
		},
	);

	it('uses the leaf’s shadowing declaration when deciding whether a flag is an operand', async () => {
		const app = cli('demo')
			.version('1')
			.command(
				group('parent')
					.flag('token', token.propagate())
					.command(command('middle').command(command('inherited').action(() => {})))
					.command(
						command('strict')
							.flag('token', flag.string().alias('t'))
							.action(() => {}),
					),
			);
		expect(await app.inspect(['parent', 'middle', '-t', '--version', 'inherited'])).toMatchObject({
			kind: 'match',
			path: ['parent', 'middle', 'inherited'],
			flags: { token: '--version' },
		});
		expect((await app.inspect(['parent', '-t', '--version', 'strict'])).kind).toBe('root-version');
	});

	it.each([
		['help', 'r', '--token', '--version'],
		['help', 'r', '--token'],
		['help', 'r', '--token', '--json'],
		['--color', 'always', 'help', 'r', '--token', '--version'],
		['--color', 'always', 'r', '--token', '--version', '--help'],
	])('shows command help through virtual help and help output flags (%j)', async (...argv) => {
		const app = cli('demo')
			.version('1')
			.help({ outputFlags: { color: 'color' } })
			.command(run);
		expect(await app.inspect(argv)).toMatchObject({ kind: 'command-help', path: ['run'] });
		const result = await app.execute(argv);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('demo run');
		if (argv.includes('--color')) expect(result.stdout.join('')).toContain('\u001b[');
	});

	it('keeps version in the virtual help prefix and scopes only the tail to the target', async () => {
		const app = cli('demo').version('1').command(run);
		expect((await app.inspect(['--token', '--version', 'help', 'run'])).kind).toBe('root-version');
		expect((await app.inspect(['--quiet', '--token', '--version', 'help', 'run'])).kind).toBe(
			'root-version',
		);
		expect(
			(await app.inspect(['--token', '--version', 'help', 'run', '--token', '--version'])).kind,
		).toBe('root-version');
		expect((await app.inspect(['help', 'run', '--token', '--version'])).kind).toBe('command-help');
	});

	it('keeps a real version flag and ignores the default’s operand policy for unknown nested routes', async () => {
		const app = cli('demo')
			.version('1')
			.default(run)
			.command(group('parent').command(command('child').action(() => {})));
		expect((await app.inspect(['parent', 'unknown', '-t', '--version'])).kind).toBe('root-version');
		expect((await app.inspect(['-t', '--quiet', '--version'])).kind).toBe('root-version');
	});

	it('does not borrow a dash-prefixed operand across a removed route or a separator', async () => {
		const app = cli('demo').version('1').command(run);
		expect((await app.inspect(['--token', 'r', '--version'])).kind).toBe('root-version');
		expect(await app.inspect(['r', '--token', '--', '--version'])).toMatchObject({
			kind: 'command-error',
			error: { code: 'MISSING_VALUE' },
		});
	});

	it.each([
		{
			argv: ['--config', 'config.json', '--token', '--config=operand', 'r'],
			value: '--config=operand',
		},
		{ argv: ['--token', '--config', '--config', 'config.json', 'r'], value: '--config' },
	])(
		'finds the named route past a real config path and retains an owned $value',
		async ({ argv, value }) => {
			const app = cli('demo').config('demo').command(run);
			const stdout: string[] = [];
			const readPaths: string[] = [];
			const adapter = createTestAdapter({
				argv: ['node', 'demo', ...argv],
				readFile: async (path) => {
					readPaths.push(path);
					return '{}';
				},
				stdout: (value) => stdout.push(value),
			});
			await expect(app.run({ adapter })).rejects.toMatchObject({ code: 0 });
			expect(readPaths).toEqual(['config.json']);
			expect(stdout).toEqual([`${value}\n`]);
		},
	);
});
