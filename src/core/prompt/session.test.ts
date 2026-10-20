/** Typed sessions, engine parity, and hidden-input contracts. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { generateCommandSchema } from '#internals/core/json-schema/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { type Ask, prompt } from './definitions.ts';
import { PromptCancelledError } from './errors.ts';
import type { PromptEngine } from './index.ts';
import { createPromptSession } from './session.ts';
import { createTerminalPrompter } from './terminal.ts';
import { createTestPrompter, PROMPT_CANCEL } from './test-prompter.ts';

describe('prompt sessions', () => {
	it('requires non-empty choices for standalone selection but permits schema inference', async () => {
		const select = prompt.select({ message: 'Region' });
		const multiselect = prompt.multiselect({ message: 'Regions' });
		expectTypeOf(select).not.toExtend<Parameters<Ask>[0]>();
		expectTypeOf(multiselect).not.toExtend<Parameters<Ask>[0]>();
		expectTypeOf(prompt.select({ message: 'Region', choices: [] })).not.toExtend<
			Parameters<Ask>[0]
		>();
		expectTypeOf(prompt.multiselect({ message: 'Regions', choices: [] })).not.toExtend<
			Parameters<Ask>[0]
		>();
		const cmd = command('choose')
			.flag('region', flag.enum(['eu', 'us']).prompt(select))
			.flag('regions', flag.array(flag.enum(['eu', 'us'])).prompt(multiselect))
			.action(() => {});
		expect((await runCommand(cmd, [], { answers: ['eu', ['us']] })).exitCode).toBe(0);
	});

	it('infers literals and uses one queue across several questions', async () => {
		const { ask } = createPromptSession({
			prompter: createTestPrompter(['eu', ['a'], true, 'name']),
		});
		const region = await ask(
			prompt.select({ message: 'Region', choices: [{ value: 'eu' }, { value: 'us' }] }),
		);
		expectTypeOf(region).toEqualTypeOf<'eu' | 'us'>();
		expect(region).toBe('eu');
		const many = await ask(
			prompt.multiselect({ message: 'Many', choices: [{ value: 'a' }, { value: 'b' }] }),
		);
		expectTypeOf(many).toEqualTypeOf<('a' | 'b')[]>();
		expect(many).toEqual(['a']);
		expectTypeOf(await ask(prompt.confirm({ message: 'Continue' }))).toEqualTypeOf<boolean>();
		expectTypeOf(await ask(prompt.input({ message: 'Name' }))).toEqualTypeOf<string>();
	});

	it('applies async validation and retries identically for scripted and terminal engines', async () => {
		for (const mode of ['scripted', 'terminal'] as const) {
			const answers = ['', 'wrong', '  accepted  '];
			const messages: string[] = [];
			const engine =
				mode === 'scripted'
					? createTestPrompter(answers)
					: createTerminalPrompter(
							async () => answers.shift() ?? null,
							(text) => messages.push(text),
						);
			const { ask } = createPromptSession({
				prompter: engine,
				write: (text) => messages.push(text),
			});
			let calls = 0;
			const value = await ask(
				prompt.input({
					message: 'Value',
					validate: async (value) => {
						calls++;
						return value === 'accepted' ? true : 'Try again';
					},
				}),
			);
			expect(value).toBe('accepted');
			expect(calls).toBe(2);
			expect(messages).toContain('Please enter a value.\n');
			expect(messages).toContain('Try again\n');
		}
	});

	it('preserves whitespace and accepts empty strings when explicitly requested', async () => {
		const { ask } = createPromptSession({ prompter: createTestPrompter(['  text  ', '']) });
		expect(await ask(prompt.input({ message: 'Text', trim: false }))).toBe('  text  ');
		expect(await ask(prompt.input({ message: 'Text', empty: 'accept' }))).toBe('');
	});

	it('applies prompt defaults exactly once without trimming or validating them', async () => {
		for (const mode of ['scripted', 'terminal'] as const) {
			const output: string[] = [];
			const engine =
				mode === 'scripted'
					? createTestPrompter([''])
					: createTerminalPrompter(
							async () => '',
							(text) => output.push(text),
						);
			const { ask } = createPromptSession({ prompter: engine });
			const answer = await ask(
				prompt.input({
					message: 'Value',
					default: '  fallback  ',
					validate: () => {
						throw new Error('Default was validated');
					},
				}),
			);
			expect(answer).toBe('  fallback  ');
			if (mode === 'terminal') expect(output.join('')).toBe('Value (default:   fallback  ): ');
		}
	});

	it('validates custom-engine answers instead of trusting their shape or choices', async () => {
		const values = [42, 'bad', 'ok'];
		const prompter: PromptEngine = {
			promptOne: async () => ({ answered: true, value: values.shift() }),
		};
		const { ask } = createPromptSession({ prompter });
		expect(await ask(prompt.select({ message: 'Choose', choices: [{ value: 'ok' }] }))).toBe('ok');
	});

	it('aborts on cancellation and leaves the session usable afterward', async () => {
		const { ask } = createPromptSession({ prompter: createTestPrompter([PROMPT_CANCEL, 'next']) });
		await expect(
			ask(prompt.input({ message: 'First', default: 'fallback' })),
		).rejects.toBeInstanceOf(PromptCancelledError);
		expect(await ask(prompt.input({ message: 'Next' }))).toBe('next');
	});

	it('fails only when an unavailable session is actually asked a question', async () => {
		const { ask } = createPromptSession({});
		await expect(ask(prompt.password({ message: 'Password' }))).rejects.toMatchObject({
			code: 'PROMPT_UNAVAILABLE',
		});
	});

	it('limits invalid attempts without treating exhaustion as cancellation', async () => {
		const { ask } = createPromptSession({
			prompter: createTestPrompter(Array.from({ length: 10 }, () => '')),
		});
		await expect(ask(prompt.input({ message: 'Value' }))).rejects.toMatchObject({
			code: 'PROMPT_INVALID',
			exitCode: 2,
		});
	});

	it('rejects overlapping reads before consuming a second answer', async () => {
		let finish: ((value: { answered: true; value: string }) => void) | undefined;
		const { ask } = createPromptSession({
			prompter: {
				promptOne: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			},
		});
		const first = ask(prompt.input({ message: 'First' }));
		await expect(ask(prompt.input({ message: 'Second' }))).rejects.toMatchObject({
			code: 'PROMPT_BUSY',
		});
		finish?.({ answered: true, value: 'done' });
		expect(await first).toBe('done');
	});
});

describe('password and text schema prompts', () => {
	it.each(['scripted', 'terminal'] as const)(
		'retries invalid schema passwords in %s mode',
		async (mode) => {
			const answers = ['bad', '  valid  '];
			let supplied: string | undefined;
			const cmd = command('login')
				.flag(
					'password',
					flag.string().prompt(
						prompt.password({
							message: 'Password',
							validate: async (value) => value === '  valid  ' || 'invalid',
						}),
					),
				)
				.action(({ flags }) => {
					supplied = flags.password;
				});
			const options =
				mode === 'scripted'
					? { answers }
					: {
							prompter: createTerminalPrompter(
								async () => null,
								() => {},
								{ readSecret: async () => answers.shift() ?? null },
							),
						};
			const result = await runCommand(cmd, [], options);
			expect(result.exitCode).toBe(0);
			expect(supplied).toBe('  valid  ');
		},
	);

	it.each(['scripted', 'terminal'] as const)(
		'reports invalid schema passwords distinctly in %s mode',
		async (mode) => {
			const answers = Array.from({ length: 10 }, () => 'bad');
			const cmd = command('login')
				.flag(
					'password',
					flag.string().prompt(prompt.password({ message: 'Password', validate: () => 'invalid' })),
				)
				.action(() => {});
			const options =
				mode === 'scripted'
					? { answers }
					: {
							prompter: createTerminalPrompter(
								async () => null,
								() => {},
								{ readSecret: async () => answers.shift() ?? null },
							),
						};
			const result = await runCommand(cmd, [], options);
			expect(result.error?.code).toBe('PROMPT_INVALID');
			expect(result.exitCode).toBe(2);
		},
	);

	it('rejects unsupported hidden input without reading or displaying a question', async () => {
		const output: string[] = [];
		let reads = 0;
		const engine = createTerminalPrompter(
			async () => {
				reads++;
				return 'visible';
			},
			(text) => output.push(text),
		);
		await expect(engine.promptOne(prompt.password({ message: 'Password' }))).rejects.toMatchObject({
			code: 'PROMPT_UNSUPPORTED',
		});
		expect(reads).toBe(0);
		expect(output).toEqual([]);
	});

	it('uses only hidden input and preserves password whitespace', async () => {
		const output: string[] = [];
		const engine = createTerminalPrompter(
			async () => {
				throw new Error('Visible reader used');
			},
			(text) => output.push(text),
			{ readSecret: async () => '  secret  ' },
		);
		const { ask } = createPromptSession({ prompter: engine });
		expect(await ask(prompt.password({ message: 'Password' }))).toBe('  secret  ');
		expect(output.join('')).toBe('Password: \n');
	});

	it('marks flag and argument passwords sensitive and omits their defaults from metadata', () => {
		const definition = prompt.password({ message: 'Password' });
		const token = flag.string().default('synthetic-secret').prompt(definition);
		const password = arg.string().default('synthetic-secret').prompt(definition);
		expect(token.schema.sensitive).toBe(true);
		expect(password.schema.sensitive).toBe(true);
		const schema = generateCommandSchema(
			command('login').flag('token', token).arg('password', password).schema,
			{ includePrompts: true },
		);
		expect(JSON.stringify(schema)).not.toContain('synthetic-secret');
		expect(JSON.stringify(schema)).toContain('"kind":"password"');
	});

	it('does not show a sensitive ordinary-input default', async () => {
		const output: string[] = [];
		const cmd = command('login')
			.flag(
				'token',
				flag
					.string()
					.sensitive()
					.prompt({ kind: 'input', message: 'Token', default: 'synthetic-secret' }),
			)
			.action(() => {});
		const result = await runCommand(cmd, [], {
			prompter: createTerminalPrompter(
				async () => '',
				(text) => output.push(text),
			),
		});
		expect(result.exitCode).toBe(0);
		expect(output.join('')).toBe('Token: ');
	});

	it('allows explicit empty and whitespace-only answers through both schema surfaces', async () => {
		const cmd = command('values')
			.flag(
				'empty',
				flag
					.string()
					.default('fallback')
					.prompt(prompt.input({ message: 'Empty', empty: 'accept' })),
			)
			.arg('space', arg.string().prompt(prompt.input({ message: 'Space', trim: false })))
			.action(({ flags, args, out }) => out.json({ empty: flags.empty, space: args.space }));
		const result = await runCommand(cmd, [], { answers: ['', '  '] });
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({ empty: '', space: '  ' });
	});

	it('cancelling a schema password never executes with a fallback password', async () => {
		const cmd = command('login')
			.flag(
				'password',
				flag
					.string()
					.default('fallback')
					.prompt(prompt.password({ message: 'Password' })),
			)
			.action(({ out }) => out.log('must not run'));
		const result = await runCommand(cmd, [], { answers: [PROMPT_CANCEL] });
		expect(result.exitCode).toBe(130);
		expect(result.error?.code).toBe('PROMPT_CANCELLED');
		expect(result.stdout).toEqual([]);
	});

	it('also aborts schema password cancellation from custom engines', async () => {
		const cmd = command('login')
			.arg(
				'password',
				arg
					.string()
					.default('fallback')
					.prompt(prompt.password({ message: 'Password' })),
			)
			.action(({ out }) => out.log('must not run'));
		const result = await runCommand(cmd, [], {
			prompter: { promptOne: async () => ({ answered: false }) },
		});
		expect(result.exitCode).toBe(130);
		expect(result.stdout).toEqual([]);
	});

	it('preserves dynamic password sensitivity through later schema and filesystem validation', async () => {
		const value = 'SYNTHETIC_SECRET';
		const token = flag.string().standard({
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: () => ({ issues: [{ message: 'invalid' }] }),
			},
		});
		const typed = command('login')
			.flag('token', token)
			.interactive(() => ({ token: prompt.password({ message: 'Token' }) }))
			.action(() => {});
		const schemaResult = await runCommand(typed, [], { answers: [value] });
		expect(schemaResult.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(JSON.stringify(schemaResult)).not.toContain(value);
		expect(token.schema.sensitive).toBe(false);
		const path = command('login')
			.flag('token', flag.path({ mustExist: true }))
			.interactive(() => ({ token: prompt.password({ message: 'Token' }) }))
			.action(() => {});
		const pathResult = await runCommand(path, [], { answers: [value], stat: async () => null });
		expect(pathResult.exitCode).toBe(2);
		expect(JSON.stringify(pathResult)).not.toContain(value);
	});
});
