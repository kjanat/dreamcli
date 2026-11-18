import { describe, expect, it } from 'vitest';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { cli } from './index.ts';

const modes = ['auto', 'always', 'never'] as const;
const check = command('check')
	.flag('color', flag.enum(modes))
	.flag('hyperlinks', flag.enum(modes))
	.flag('runner', flag.string().group('Runners'))
	.helpTopic('runners', 'Runners')
	.action(({ flags, out }) => out.log(String(flags.color)));
const base = cli('demo')
	.version('1.2.3')
	.links({ name: 'https://example.com/demo', version: 'https://example.com/releases/v1.2.3' })
	.command(check);
const app = base.help({
	commandHeader: true,
	outputFlags: { color: 'color', hyperlinks: 'hyperlinks' },
});

describe('native help output options', () => {
	it.each([
		{ argv: ['--color', 'always', '--help', '--hyperlinks=always'], expected: 'Commands:' },
		{ argv: ['check', '--help', '--color=always', '--hyperlinks=always'], expected: 'Usage:' },
		{
			argv: ['--hyperlinks', 'always', 'check', '--help=runners', '--color=always'],
			expected: 'Runners options:',
		},
	])('forces color and header links for $expected on a pipe', async ({ argv, expected }) => {
		const result = await app.execute(argv, { isTTY: false, env: {} });
		const text = result.stdout.join('');
		expect(result.exitCode).toBe(0);
		expect(text).toContain(expected);
		expect(text).toContain('\x1b[');
		expect(text).toContain('\x1b]8;');
		expect(text.split('\n')[0]).toContain('https://example.com/demo');
		expect(text.split('\n')[0]).toContain('https://example.com/releases/v1.2.3');
	});

	it('lets never override a TTY and auto fall back to the configured policy', async () => {
		const never = await app.execute(['check', '--help', '--color=never', '--hyperlinks', 'never'], {
			isTTY: true,
			env: { FORCE_COLOR: '1', FORCE_HYPERLINKS: '1' },
		});
		expect(never.stdout.join('')).toMatch(/^demo v1\.2\.3\n\nUsage:/u);
		expect(never.stdout.join('')).not.toContain('\x1b');
		const auto = await app.execute(
			['check', '--help', '--color=always', '--color=auto', '--hyperlinks', 'auto'],
			{ isTTY: false, env: {} },
		);
		expect(auto.stdout.join('')).not.toContain('\x1b');
		const forced = await app.execute(['check', '--help', '--color=auto', '--hyperlinks=auto'], {
			isTTY: false,
			env: { FORCE_COLOR: '1', FORCE_HYPERLINKS: '1' },
		});
		expect(forced.stdout.join('')).toContain('\x1b[');
		expect(forced.stdout.join('')).toContain('\x1b]8;');
	});

	it('keeps JSON and tokens after the separator out of the terminal output policy', async () => {
		for (const argv of [['--help'], ['check', '--help'], ['check', '--help=runners']]) {
			const json = await app.execute([...argv, '--json', '--color=always', '--hyperlinks=always'], {
				isTTY: true,
			});
			expect(json.exitCode).toBe(0);
			expect(json.stdout.join('')).not.toContain('\x1b');
			expect(JSON.parse(json.stdout.join(''))).toBeTypeOf('object');
			const plain = await app.execute([...argv, '--', '--color=always', '--hyperlinks=always'], {
				isTTY: false,
			});
			expect(plain.exitCode).toBe(0);
			expect(plain.stdout.join('')).not.toContain('\x1b');
		}
	});

	it('keeps both features opt-in and preserves normal command flag resolution', async () => {
		const help = await base.execute(['check', '--help=runners', '--color=always'], {
			isTTY: false,
			help: { hyperlinks: true },
		});
		expect(help.stdout.join('')).toMatch(/^Runners options:/u);
		expect(help.stdout.join('')).not.toContain('\x1b');
		const invocation = await app.execute(['check', '--color', 'always']);
		expect(invocation.stdout).toEqual(['always\n']);
	});

	it('uses the program header on nested group help when run through the adapter', async () => {
		const nested = app.command(command('parent').command(check));
		const stdout: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'demo', 'parent', '--hyperlinks', 'always', 'check', '--help=runners'],
			stdout: (line) => stdout.push(line),
		});
		await expect(nested.run({ adapter })).rejects.toMatchObject({ code: 0 });
		expect(stdout.join('')).toContain('https://example.com/demo');
		expect(stdout.join('')).toContain('Runners options:');
		const group = await nested.execute(['parent', '--help'], {
			isTTY: false,
			help: { hyperlinks: true },
		});
		expect(group.stdout.join('').split('\n')[0]).toContain('https://example.com/demo');
		expect(group.stdout.join('')).toContain('Usage: demo parent');
	});
});
