/** Authentication branches are chosen before credentials or server challenges are requested. */
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { prompt } from '#internals/core/prompt/definitions.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { runCommand } from './index.ts';

function authentication(name: 'login' | 'unlock', challenge = false) {
	const calls: unknown[] = [];
	const cmd = command(name)
		.arg('email', arg.string().optional().env('EMAIL').config('auth.email'))
		.flag('password', flag.string().sensitive().env('PASSWORD').config('auth.password'))
		.flag('client-id', flag.string().env('CLIENT_ID').config('auth.clientId'))
		.flag(
			'client-secret',
			flag.string().sensitive().env('CLIENT_SECRET').config('auth.clientSecret'),
		)
		.flag('check', flag.boolean())
		.flag('apikey', flag.boolean())
		.action(async ({ flags, args, ask, out }) => {
			if (flags.check) {
				calls.push('check');
				out.log('checked');
				return;
			}
			if (flags.apikey) {
				const id = flags['client-id'] ?? (await ask(prompt.input({ message: 'Client ID' })));
				const secret =
					flags['client-secret'] ?? (await ask(prompt.password({ message: 'Client secret' })));
				calls.push({ kind: 'apikey', id, secret });
				return;
			}
			const email = args.email ?? (await ask(prompt.input({ message: 'Email' })));
			const password =
				flags.password ?? (await ask(prompt.password({ message: 'Master password' })));
			calls.push({ kind: 'password', email, password });
			// Only a server response determines whether the challenge exists.
			const response = await Promise.resolve({ challenge });
			if (response.challenge) {
				const method = await ask(
					prompt.select({
						message: 'Two-factor method',
						choices: [{ value: 'totp' }, { value: 'email' }],
					}),
				);
				const code = await ask(prompt.input({ message: 'Verification code' }));
				calls.push({ method, code });
			}
		});
	return { cmd, calls };
}

describe('authentication prompt acceptance', () => {
	it.each(['login', 'unlock'] as const)(
		'%s --check completes with no engine or credentials',
		async (name) => {
			const { cmd, calls } = authentication(name);
			const result = await runCommand(cmd, ['--check'], { answers: [] });
			expect(result.exitCode).toBe(0);
			expect(calls).toEqual(['check']);
			expect(result.stdout).toEqual(['checked\n']);
		},
	);

	it('API-key login asks only for client ID and client secret', async () => {
		const { cmd, calls } = authentication('login');
		const result = await runCommand(cmd, ['--apikey'], {
			answers: ['client-id', '  client-secret  '],
		});
		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([{ kind: 'apikey', id: 'client-id', secret: '  client-secret  ' }]);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toEqual([]);
	});

	it('password login asks only for email and master password', async () => {
		const { cmd, calls } = authentication('login');
		const result = await runCommand(cmd, [], {
			answers: ['user@example.test', '  master password  '],
		});
		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([
			{ kind: 'password', email: 'user@example.test', password: '  master password  ' },
		]);
	});

	it('retains argv, env, and config precedence before handler fallback', async () => {
		for (const source of ['argv', 'env', 'config'] as const) {
			const { cmd, calls } = authentication('login');
			const config = { auth: { email: 'config@example.test', password: 'config-secret' } };
			const env = source === 'config' ? {} : { EMAIL: 'env@example.test', PASSWORD: 'env-secret' };
			const argv = source === 'argv' ? ['argv@example.test', '--password', 'argv-secret'] : [];
			const result = await runCommand(cmd, argv, { env, config, answers: [] });
			expect(result.exitCode).toBe(0);
			expect(calls).toEqual([
				{ kind: 'password', email: `${source}@example.test`, password: `${source}-secret` },
			]);
		}
	});

	it('requests two-factor questions only after password authentication', async () => {
		const { cmd, calls } = authentication('login', true);
		const result = await runCommand(cmd, ['user@example.test', '--password', 'provided-secret'], {
			answers: ['totp', '123456'],
		});
		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([
			{ kind: 'password', email: 'user@example.test', password: 'provided-secret' },
			{ method: 'totp', code: '123456' },
		]);
	});

	it('fails explicitly when a branch needs interaction in a non-interactive run', async () => {
		const { cmd, calls } = authentication('login');
		const result = await runCommand(cmd, []);
		expect(result.error?.code).toBe('PROMPT_UNAVAILABLE');
		expect(calls).toEqual([]);
	});

	it('shares the answer queue with schema prompts, derives, and middleware', async () => {
		const cmd = command('flow')
			.flag('first', flag.string().prompt(prompt.input({ message: 'First' })))
			.derive(async ({ ask }) => ({ second: await ask(prompt.input({ message: 'Second' })) }))
			.middleware(
				middleware<{ third: string }>(async ({ ask, next }) =>
					next({ third: await ask(prompt.input({ message: 'Third' })) }),
				),
			)
			.action(async ({ flags, ctx, ask, out }) =>
				out.json([
					flags.first,
					ctx.second,
					ctx.third,
					await ask(prompt.input({ message: 'Fourth' })),
				]),
			);
		const result = await runCommand(cmd, [], { answers: ['one', 'two', 'three', 'four'] });
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual(['one', 'two', 'three', 'four']);
	});

	it('auto-wires the runtime hidden reader for handler-only password prompts', async () => {
		const seen: string[] = [];
		const cmd = command('unlock').action(async ({ ask }) => {
			seen.push(await ask(prompt.password({ message: 'Password' })));
		});
		const adapter = createTestAdapter({
			argv: ['node', 'cli', 'unlock'],
			stdinIsTTY: true,
			readSecret: async () => '  password  ',
			stdin: async () => {
				throw new Error('Visible input was used');
			},
		});
		await expect(cli('vault').command(cmd).run({ adapter })).rejects.toMatchObject({ code: 0 });
		expect(seen).toEqual(['  password  ']);
	});
});
