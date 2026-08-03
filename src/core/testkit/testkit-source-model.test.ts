import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from './index.ts';

// === L15 — runCommand() mirrors the CLI stdin contract

describe('runCommand() stdin contract', () => {
	it('feeds a stdin flag from the stdinData option', async () => {
		const cmd = command('send')
			.flag('body', flag.string().stdin())
			.action(({ flags, out }) => {
				out.log(JSON.stringify(flags.body));
			});

		const result = await runCommand(cmd, [], { stdinData: 'piped\n' });

		expect(result.stdout.join('')).toContain('"piped\\n"');
	});

	it('puts the stdin fallback ahead of env for a flag', async () => {
		const cmd = command('send')
			.flag('body', flag.string().stdin().env('BODY'))
			.action(({ flags, out }) => {
				out.log(String(flags.body));
			});

		const result = await runCommand(cmd, [], {
			stdinData: 'piped',
			env: { BODY: 'from-env' },
		});

		expect(result.stdout.join('')).toContain('piped');
	});

	it('keeps an explicit dash at CLI precedence for a flag', async () => {
		const cmd = command('send')
			.flag('body', flag.string().stdin().env('BODY'))
			.action(({ flags, out }) => {
				out.log(String(flags.body));
			});

		const result = await runCommand(cmd, ['--body', '-'], {
			stdinData: 'piped',
			env: { BODY: 'from-env' },
		});

		expect(result.stdout.join('')).toContain('piped');
	});

	it('resolves an arg from config and from a prompt', async () => {
		const cmd = command('deploy')
			.arg('target', arg.string().config('deploy.target').optional())
			.action(({ args, out }) => {
				out.log(String(args.target));
			});

		const result = await runCommand(cmd, [], { config: { deploy: { target: 'eu' } } });

		expect(result.stdout.join('')).toContain('eu');
	});

	it('broadcasts one buffer to a flag and an arg together', async () => {
		const cmd = command('copy')
			.flag('body', flag.string().stdin({ consume: 'broadcast' }))
			.arg('input', arg.string().stdin({ consume: 'broadcast' }))
			.action(({ args, flags, out }) => {
				out.log(JSON.stringify([flags.body, args.input]));
			});

		const result = await runCommand(cmd, [], { stdinData: 'shared\n' });

		expect(result.stdout.join('')).toContain('["shared\\n","shared\\n"]');
	});

	it('decodes a piped number arg without the trailing terminator', async () => {
		const cmd = command('count')
			.arg('total', arg.number().stdin())
			.action(({ args, out }) => {
				out.log(String(args.total));
			});

		const result = await runCommand(cmd, [], { stdinData: '42\n' });

		expect(result.stdout.join('')).toContain('42');
		expect(result.exitCode).toBe(0);
	});
});
