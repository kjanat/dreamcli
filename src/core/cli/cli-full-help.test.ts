/** End-to-end coverage for short and full text help. */
import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli } from './index.ts';

describe('full help', () => {
	const check = command('check')
		.flag('offline', flag.boolean().describe('Use cached dependencies'))
		.flag('runner-provider', flag.string().advanced().group('Runner'))
		.action(({ flags, out }) => out.log(flags['runner-provider'] ?? 'default'));
	const app = cli('demo').default(check, { route: true });

	it.each([{ path: [] }, { path: ['check'] }])(
		'includes advanced flags with --help=all at $path',
		async ({ path }) => {
			const short = await app.execute([...path, '--help']);
			const full = await app.execute([...path, '--help=all']);
			expect(short.stdout.join('')).toContain('--offline');
			expect(short.stdout.join('')).not.toContain('Runner options:');
			expect(full.exitCode).toBe(0);
			expect(full.stdout.join('')).toContain('Runner options:\n  --runner-provider <string>');
		},
	);

	it('keeps advanced flags in JSON help, completion, and parsing', async () => {
		const json = await app.execute(['check', '--help', '--json']);
		expect(JSON.parse(json.stdout.join(''))).toHaveProperty(
			['flags', 'runner-provider', 'advanced'],
			true,
		);
		const completion = await app.completions().execute(['completions', 'bash']);
		expect(completion.stdout.join('')).toContain('--runner-provider');
		const run = await app.execute(['check', '--runner-provider', 'local']);
		expect(run.stdout.join('')).toBe('local\n');
	});

	it('includes advanced flags when a group command has no action', async () => {
		const result = await cli('demo')
			.command(command('group').flag('debug', flag.boolean().advanced()).command(check))
			.execute(['group', '--help=all']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('--debug');
	});

	it('treats --help=all as a literal after the end-of-options separator', async () => {
		const result = await cli('demo')
			.default(
				command('echo')
					.arg('text', arg.string())
					.action(({ args, out }) => out.log(args.text)),
			)
			.execute(['--', '--help=all']);
		expect(result.stdout.join('')).toBe('--help=all\n');
	});
});
