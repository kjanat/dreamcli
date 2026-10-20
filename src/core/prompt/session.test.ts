/** Typed sessions, engine parity, and hidden-input contracts. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { generateCommandSchema } from '#internals/core/json-schema/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { type Ask, prompt } from './definitions.ts';
import { PromptCancelledError } from './errors.ts';
import type { PromptEngine } from './index.ts';
import { createPromptSession } from './session.ts';
import { createTerminalPrompter } from './terminal.ts';
import { createTestPrompter, PROMPT_CANCEL } from './test-prompter.ts';

describe('prompt sessions', () => {
	it.each([true, false])('hides sensitive confirmation defaults (%s)', async (defaultValue) => {
		for (const mode of ['engine', 'session', 'schema'] as const) {
			const output: string[] = [];
			const prompter = createTerminalPrompter(
				async () => '',
				(text) => output.push(text),
			);
			const definition = prompt.confirm({
				message: 'Continue?',
				default: defaultValue,
				sensitive: true,
			});
			if (mode === 'engine')
				expect(await prompter.promptOne(definition)).toEqual({
					answered: true,
					value: defaultValue,
				});
			else if (mode === 'session')
				expect(await createPromptSession({ prompter }).ask(definition)).toBe(defaultValue);
			else {
				const cmd = command('test')
					.flag('confirm', flag.boolean().prompt(definition))
					.action(({ flags }) => {
						expect(flags.confirm).toBe(defaultValue);
					});
				expect((await runCommand(cmd, [], { prompter })).exitCode).toBe(0);
			}
			expect(output.join('')).toBe('Continue? (y/n) ');
		}
	});

	it('uses one scripted queue on a TTY without reading real input', async () => {
		let reads = 0;
		const read = async () => {
			reads++;
			throw new Error('Unexpected terminal read');
		};
		const cmd = command('login')
			.flag('email', flag.string().prompt(prompt.input({ message: 'Email' })))
			.action(async ({ flags, ask, out }) => {
				const password = await ask(prompt.password({ message: 'Password' }));
				out.log(`${flags.email}:${password}`);
			});
		const output: string[] = [];
		const adapter = createTestAdapter({
			argv: ['bun', 'test', 'login'],
			stdinIsTTY: true,
			stdin: read,
			readSecret: read,
			stdout: (text) => output.push(text),
		});
		await expect(
			cli('test')
				.command(cmd)
				.run({ adapter, answers: ['email', 'secret'] }),
		).rejects.toMatchObject({ code: 0 });
		expect(reads).toBe(0);
		expect(output).toEqual(['email:secret\n']);
	});

	it.each(['flag', 'arg'] as const)('retries scripted empty schema %s input', async (surface) => {
		const definition = prompt.input({ message: 'Value' });
		const cmd =
			surface === 'flag'
				? command('test')
						.flag('value', flag.string().default('fallback').prompt(definition))
						.action(({ flags, out }) => out.log(flags.value))
				: command('test')
						.arg('value', arg.string().default('fallback').prompt(definition))
						.action(({ args, out }) => out.log(args.value));
		const result = await runCommand(cmd, [], { answers: ['', 'valid'] });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['valid\n']);
	});

	it.each([['--unknown'], ['--later'], ['-x'], ['extra']])(
		'retains the first invalid CLI value before %j',
		async (...later) => {
			const cmd = command('test')
				.flag('count', flag.number())
				.flag('later', flag.string())
				.interactive(() => ({}))
				.action(() => {});
			const result = await runCommand(cmd, ['--count=bad', ...later]);
			expect(result.error).toMatchObject({ code: 'INVALID_VALUE', details: { flag: 'count' } });
		},
	);

	it('does not run unrelated custom parsers after a retained parse error', async () => {
		let calls = 0;
		const cmd = command('test')
			.flag('count', flag.number())
			.flag(
				'later',
				flag.custom((value) => {
					calls++;
					return value;
				}),
			)
			.interactive(() => ({}))
			.action(() => {});
		const result = await runCommand(cmd, ['--count=bad', '--later=value']);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(calls).toBe(0);
	});

	it('preserves the first error and sensitivity across later syntax and positional failures', async () => {
		let positionalCalls = 0;
		const cmd = command('test')
			.flag('token', flag.string().pattern(/^valid$/))
			.flag('secret', flag.boolean())
			.arg(
				'other',
				arg.custom((value) => {
					positionalCalls++;
					return value;
				}),
			)
			.interactive(({ flags }) =>
				flags.secret ? { token: prompt.password({ message: 'Token' }) } : {},
			)
			.action(() => {});
		const result = await runCommand(cmd, [
			'--token=SYNTHETIC_SECRET',
			'--unknown',
			'--secret',
			'other',
		]);
		expect(result.error).toMatchObject({ code: 'INVALID_VALUE', details: { flag: 'token' } });
		expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
		expect(positionalCalls).toBe(0);
	});

	it('keeps partial flag presence accurate while reading custom sensitivity inputs', async () => {
		let observed: unknown;
		const cmd = command('test')
			.flag('token', flag.number())
			.flag(
				'absent',
				flag.custom((value) => value),
			)
			.interactive(({ flags }) => {
				observed = {
					present: 'absent' in flags,
					own: Object.hasOwn(flags, 'absent'),
					keys: Object.keys(flags),
				};
				return {};
			})
			.action(() => {});
		expect((await runCommand(cmd, ['--token=bad'])).error?.code).toBe('INVALID_VALUE');
		expect(observed).toEqual({ present: false, own: false, keys: [] });
	});

	it('keeps the earliest error private when a needed sensitivity parser fails', async () => {
		let calls = 0;
		const cmd = command('test')
			.flag('token', flag.number())
			.flag(
				'mode',
				flag.custom(() => {
					calls++;
					throw new Error('later failure');
				}),
			)
			.interactive(({ flags }) =>
				flags.mode ? { token: prompt.input({ message: 'Token', sensitive: true }) } : {},
			)
			.action(() => {});
		const result = await runCommand(cmd, ['--token=SYNTHETIC_SECRET', '--mode=bad']);
		expect(result.error).toMatchObject({ code: 'INVALID_VALUE', details: { flag: 'token' } });
		expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
		expect(result.error?.message).not.toContain('later failure');
		expect(calls).toBe(1);
	});

	it('retries empty scripted input without changing validator-failure cancellation', async () => {
		const engine = createTestPrompter(['', 'bad', 'good']);
		const definition = prompt.input({
			message: 'Value',
			validate: (value) => value === 'good' || 'Please enter a value.',
		});
		expect(await engine.promptOne(definition)).toEqual({ answered: false });
		expect(await engine.promptOne(definition)).toEqual({ answered: true, value: 'good' });
	});

	it('reports scripted empty-input exhaustion like the terminal engine', async () => {
		const definition = prompt.input({ message: 'Value' });
		for (const engine of [
			createTestPrompter(Array.from({ length: 10 }, () => '')),
			createTerminalPrompter(
				async () => '',
				() => {},
			),
		]) {
			expect(await engine.promptOne(definition)).toEqual({ answered: false, reason: 'invalid' });
		}
	});

	it('stamps the input kind even when options come from another definition', async () => {
		const config = prompt.input(prompt.password({ message: 'Secret' }));
		expect(config.kind).toBe('input');
		const { ask } = createPromptSession({
			prompter: createTerminalPrompter(
				async () => 'value',
				() => {},
			),
		});
		expect(await ask(config)).toBe('value');
	});

	const configs = [
		prompt.confirm({ message: 'Continue' }),
		prompt.select({ message: 'Choose', choices: [{ value: 'ok' }] }),
		prompt.multiselect({ message: 'Choose', choices: [{ value: 'ok' }] }),
		prompt.input({ message: 'Text', validate: () => 'invalid' }),
		prompt.password({ message: 'Secret', validate: () => 'invalid' }),
	] as const;
	for (const mode of ['scripted', 'terminal', 'custom'] as const) {
		it.each(configs)(`reports exhausted $kind answers as invalid in ${mode}`, async (config) => {
			const answers = Array.from({ length: 10 }, () => 'bad');
			const read = async () => answers.shift() ?? null;
			const prompter =
				mode === 'scripted'
					? createTestPrompter(answers)
					: mode === 'terminal'
						? createTerminalPrompter(read, () => {}, { readSecret: read })
						: { promptOne: async () => ({ answered: true as const, value: answers.shift() }) };
			const { ask } = createPromptSession({ prompter });
			await expect(ask(config)).rejects.toMatchObject({ code: 'PROMPT_INVALID', exitCode: 2 });
		});
		it.each(configs)(`preserves cancellation for $kind in ${mode}`, async (config) => {
			const prompter =
				mode === 'scripted'
					? createTestPrompter([PROMPT_CANCEL])
					: mode === 'terminal'
						? createTerminalPrompter(
								async () => null,
								() => {},
								{ readSecret: async () => null },
							)
						: { promptOne: async () => ({ answered: false as const }) };
			const { ask } = createPromptSession({ prompter });
			await expect(ask(config)).rejects.toMatchObject({ code: 'PROMPT_CANCELLED', exitCode: 130 });
		});
	}

	it('accepts an explicit retry-exhaustion result from a custom engine', async () => {
		const { ask } = createPromptSession({
			prompter: { promptOne: async () => ({ answered: false, reason: 'invalid' }) },
		});
		await expect(ask(prompt.input({ message: 'Text' }))).rejects.toMatchObject({
			code: 'PROMPT_INVALID',
			exitCode: 2,
		});
	});

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
	it.each(['flag', 'arg'] as const)(
		'preserves custom password exhaustion for a schema %s',
		async (surface) => {
			let cmd = command('login');
			const definition = prompt.password({ message: 'Password' });
			if (surface === 'flag')
				cmd = cmd.flag('password', flag.string().default('fallback').prompt(definition));
			else cmd = cmd.arg('password', arg.string().default('fallback').prompt(definition));
			const result = await runCommand(
				cmd.action(({ out }) => out.log('executed')),
				[],
				{
					prompter: { promptOne: async () => ({ answered: false, reason: 'invalid' }) },
				},
			);
			expect(result.error?.code).toBe('PROMPT_INVALID');
			expect(result.exitCode).toBe(2);
			expect(result.stdout).toEqual([]);
		},
	);

	it.each([
		prompt.confirm({ message: 'Confirm', sensitive: true }),
		prompt.select({ message: 'Select', sensitive: true, choices: [{ value: 'a' }] }),
		prompt.multiselect({ message: 'Multi', sensitive: true, choices: [{ value: 'a' }] }),
	])('serializes sensitivity for $kind prompts', (definition) => {
		const cmd = command('test')
			.flag('value', flag.custom((value) => value).prompt(definition))
			.arg('value', arg.custom((value) => value).prompt(definition));
		const schema = generateCommandSchema(cmd.schema, { includePrompts: true });
		expect(schema.flags?.value?.prompt).toMatchObject({ kind: definition.kind, sensitive: true });
		expect(schema.args?.[0]?.prompt).toMatchObject({ kind: definition.kind, sensitive: true });
	});

	it.each(['password', 'sensitive'] as const)(
		'redacts dynamically %s CLI parse failures',
		async (mode) => {
			const secret = 'SYNTHETIC_SECRET';
			const cmd = command('login')
				.flag(
					'token',
					flag
						.string()
						.pattern(/^valid$/)
						.alias('t'),
				)
				.flag('secret', flag.boolean())
				.interactive(({ flags }) =>
					flags.secret
						? {
								token:
									mode === 'password'
										? prompt.password({ message: 'Token' })
										: prompt.input({ message: 'Token', sensitive: true }),
							}
						: {},
				)
				.action(({ out }) => out.log('executed'));
			for (const argv of [
				['--token', secret, '--secret'],
				[`--token=${secret}`, '--secret'],
				['-t', secret, '--secret'],
				[`-t${secret}`, '--secret'],
			]) {
				const result = await runCommand(cmd, argv);
				expect(result.error?.code).toBe('INVALID_VALUE');
				expect(result.exitCode).toBe(2);
				expect(JSON.stringify(result)).not.toContain(secret);
				expect(result.stdout).toEqual([]);
			}
			const ordinary = await runCommand(cmd, ['--token', secret]);
			expect(JSON.stringify(ordinary)).toContain(secret);
		},
	);

	it.each(['cli', 'env', 'config'] as const)(
		'uses %s branch inputs once when redacting a failed CLI parser',
		async (source) => {
			const secret = 'SYNTHETIC_SECRET';
			let tokenCalls = 0;
			let branchCalls = 0;
			let interactiveCalls = 0;
			let observed: unknown;
			const cmd = command('login')
				.flag(
					'token',
					flag.custom(() => {
						tokenCalls++;
						throw new Error('invalid token');
					}),
				)
				.flag(
					'mode',
					flag
						.custom((value) => {
							branchCalls++;
							return value;
						})
						.env('MODE')
						.config('mode'),
				)
				.interactive(({ flags }) => {
					interactiveCalls++;
					observed = { ...flags };
					return flags.mode === 'secret' ? { token: prompt.password({ message: 'Token' }) } : {};
				})
				.action(({ out }) => out.log('executed'));
			const result = await runCommand(
				cmd,
				['--token', secret, ...(source === 'cli' ? ['--mode', 'secret'] : [])],
				{
					...(source === 'env' ? { env: { MODE: 'secret' } } : {}),
					...(source === 'config' ? { config: { mode: 'secret' } } : {}),
					prompter: {
						promptOne: async () => {
							throw new Error('must not prompt');
						},
					},
				},
			);
			expect(result.error?.code).toBe('INVALID_VALUE');
			expect(JSON.stringify(result)).not.toContain(secret);
			expect(result.error?.cause).toBeUndefined();
			expect(result.stdout).toEqual([]);
			expect(tokenCalls).toBe(1);
			expect(branchCalls).toBe(1);
			expect(interactiveCalls).toBe(1);
			expect(observed).toEqual({ mode: 'secret' });
		},
	);

	it.each([
		{ builder: flag.number(), argv: ['--value=SYNTHETIC_SECRET'] },
		{ builder: flag.boolean(), argv: ['--value=SYNTHETIC_SECRET'] },
		{ builder: flag.count(), argv: ['--value=SYNTHETIC_SECRET'] },
		{ builder: flag.keyValue(flag.string()), argv: ['--value=SYNTHETIC_SECRET'] },
		{ builder: flag.array(flag.string().pattern(/^valid$/)), argv: ['--value=SYNTHETIC_SECRET'] },
		{
			builder: flag.string().duplicates('error'),
			argv: ['--value=first', '--value=SYNTHETIC_SECRET'],
		},
	])(
		'redacts dynamically sensitive CLI failures for $builder.schema.kind',
		async ({ builder, argv }) => {
			const cmd = command('test')
				.flag('value', builder)
				.interactive(() => ({ value: prompt.input({ message: 'Value', sensitive: true }) }))
				.action(() => {});
			const result = await runCommand(cmd, argv);
			expect(result.exitCode).toBe(2);
			expect(result.error?.name).toBe('ParseError');
			expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
		},
	);

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
