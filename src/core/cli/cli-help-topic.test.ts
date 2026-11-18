import { describe, expect, it, vi } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command, createCommandSchema } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/index.ts';
import { cli } from './index.ts';

function checkCommand() {
	return command('check')
		.arg('paths', arg.string().variadic().optional())
		.flag('runner-provider', flag.string().group('Runners').advanced())
		.flag('output', flag.string().group('Output'))
		.helpTopic('runners', 'Runners');
}

describe('command help topics', () => {
	it('renders only the selected flag group, with advanced flags and without running the action', async () => {
		const action = vi.fn();
		const app = cli('demo').command(checkCommand().action(action));
		const focused = await app.execute(['check', '--help=runners']);
		expect(focused.exitCode).toBe(0);
		expect(focused.stdout.join('')).toMatch(/^Runners options:\n  --runner-provider[^\n]*\n$/u);
		expect(focused.stderr).toEqual([]);
		expect(action).not.toHaveBeenCalled();
		const short = await app.execute(['check', '--help']);
		expect(short.stdout.join('')).toContain('--output');
		expect(short.stdout.join('')).not.toContain('--runner-provider');
		const full = await app.execute(['check', '--help=all']);
		expect(full.stdout.join('')).toContain('--output');
		expect(full.stdout.join('')).toContain('--runner-provider');
		const json = await app.execute(['check', '--help=runners', '--json']);
		const ordinaryJSON = await app.execute(['check', '--help', '--json']);
		expect(json.exitCode).toBe(0);
		expect(json.stdout).toEqual(ordinaryJSON.stdout);
		expect(JSON.parse(json.stdout.join(''))).not.toHaveProperty('helpTopics');
	});

	it('works for a default command and the standalone testkit', async () => {
		const command = checkCommand().action(() => {});
		const root = await cli('demo').default(command).execute(['--help=runners']);
		const standalone = await runCommand(command, ['--help=runners']);
		expect(root.exitCode).toBe(0);
		expect(standalone.exitCode).toBe(0);
		expect(root.stdout).toEqual(standalone.stdout);
		expect(root.stdout.join('')).toContain('--runner-provider');
	});

	it('keeps completion generation unchanged and skips stdin during topic help', async () => {
		const base = command('check')
			.flag('input', flag.string().stdin())
			.flag('runner', flag.string().group('Runners').advanced())
			.action(() => {});
		const build = (cmd: typeof base) => cli('demo').command(cmd).completions({ as: 'flag' });
		const app = build(base.helpTopic('runners', 'Runners'));
		const argv = ['--completions', 'bash'];
		const original = await build(base).execute(argv);
		const withTopic = await app.execute(argv);
		expect(withTopic.exitCode).toBe(0);
		expect(withTopic.stdout).toEqual(original.stdout);
		const readStdin = vi.fn(async () => null);
		const adapter = {
			...createTestAdapter({ argv: ['node', 'demo', 'check', '--help=runners'] }),
			readStdin,
		};
		await expect(app.run({ adapter })).rejects.toEqual(new ExitError(0));
		expect(readStdin).not.toHaveBeenCalled();
	});

	it('works for an actionless group and uses the effective inherited flags', async () => {
		const parent = command('parent')
			.flag('runner-provider', flag.string().group('Runners').propagate())
			.helpTopic('runners', 'Runners')
			.command(
				command('nested')
					.helpTopic('runners', 'Runners')
					.command(
						command('check')
							.helpTopic('runners', 'Runners')
							.action(() => {}),
					),
			);
		const app = cli('demo').command(parent);
		const group = await app.execute(['parent', '--help=runners']);
		expect(group.exitCode).toBe(0);
		expect(group.stdout.join('')).toMatch(/^Runners options:\n  --runner-provider[^\n]*\n$/u);
		const nested = await app.execute(['parent', 'nested', 'check', '--help=runners']);
		expect(nested.stdout).toEqual(group.stdout);
		const groupTopicJson = await app.execute(['parent', 'nested', '--help=runners', '--json']);
		const groupJson = await app.execute(['parent', 'nested', '--help', '--json']);
		expect(groupTopicJson.stdout).toEqual(groupJson.stdout);
	});

	it('keeps unknown names and post-separator text out of built-in help', async () => {
		const action = vi.fn();
		const app = cli('demo').command(checkCommand().action(action));
		const unknown = await app.execute(['check', '--help=constructor']);
		expect(unknown.error?.code).toBe('UNKNOWN_FLAG');
		await app.execute(['check', '--', '--help=runners']);
		expect(action).toHaveBeenCalledWith(
			expect.objectContaining({ args: { paths: ['--help=runners'] } }),
		);
		const off = cli('demo')
			.builtins({ help: 'off' })
			.command(
				checkCommand()
					.flag('help', flag.string())
					.action(({ flags, out }) => out.log(flags.help ?? '')),
			);
		expect((await off.execute(['check', '--help=runners'])).stdout).toEqual(['runners\n']);
	});

	it('validates registered names and reports an empty selected group', async () => {
		expect(() => checkCommand().helpTopic('all', 'Runners')).toThrow(/Invalid help topic name/u);
		expect(() => createCommandSchema({ name: 'deploy', helpTopics: { invalid: '' } })).toThrow(
			/requires a flag group name/u,
		);
		const app = cli('demo').command(
			checkCommand()
				.helpTopic('missing', 'Missing')
				.action(() => {}),
		);
		const result = await app.execute(['check', '--help=missing']);
		expect(result.error?.code).toBe('INVALID_SCHEMA');
		expect(result.stderr.join('')).toContain("has no flags in group 'Missing'");
	});
});
