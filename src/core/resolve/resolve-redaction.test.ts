import { describe, expect, it, test } from 'vitest';
import { isValidationError, type ValidationError } from '#internals/core/errors/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { createCommandSchema } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import type { ResolveOptions } from './index.ts';
import { resolve } from './index.ts';

// === Schema sensitivity, independent of resolution source

const SECRET = 'sk-live-secret';

/** Resolve a schema that must fail, and hand back the failure. */
async function failure(
	schema: CommandSchema,
	argv: readonly string[],
	options?: ResolveOptions,
): Promise<ValidationError> {
	try {
		await resolve(schema, parse(schema, [...argv]), options);
	} catch (error) {
		if (isValidationError(error)) return error;
		throw error;
	}
	throw new Error('expected resolution to fail');
}

/** A command with one number flag reachable from every resolver source. */
function numberFlagCommand(sensitive: boolean): CommandSchema {
	return createCommandSchema({
		name: 'test',
		flags: {
			port: flag
				.number()
				.stdin()
				.env('PORT')
				.config('serve.port')
				.prompt({ kind: 'input', message: 'Port' })
				.sensitive(sensitive).schema,
		},
	});
}

describe('flag diagnostics', () => {
	describe('sensitive inputs redact every resolver source', () => {
		const cases: ReadonlyArray<readonly [string, ResolveOptions]> = [
			['stdin', { stdinData: SECRET }],
			['env', { env: { PORT: SECRET } }],
			['config', { config: { serve: { port: SECRET } } }],
		];

		test.each(cases)('keeps a %s value out of the message and the details', async (_, options) => {
			const error = await failure(numberFlagCommand(true), [], options);

			expect(error.message).toContain("'<redacted>'");
			expect(error.message).not.toContain(SECRET);
			expect(JSON.stringify(error.details)).not.toContain(SECRET);
			expect(error.details).not.toHaveProperty('value');
		});

		it('keeps a prompt answer out of the message and the details', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: {
					port: flag.number().prompt({ kind: 'input', message: 'Port' }).sensitive().schema,
				},
			});
			const error = await failure(schema, [], {
				prompter: { promptOne: async () => ({ answered: true, value: SECRET }) },
			});

			expect(error.message).toContain("'<redacted>'");
			expect(error.message).not.toContain(SECRET);
			expect(JSON.stringify(error.details)).not.toContain(SECRET);
		});

		it('redacts an enum value and keeps the allowed list', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: { region: flag.enum(['us', 'eu']).env('REGION').sensitive().schema },
			});
			const error = await failure(schema, [], { env: { REGION: SECRET } });

			expect(error.message).toBe(
				"Invalid value '<redacted>' from env REGION for flag --region. Allowed: us, eu",
			);
			expect(error.details).toEqual({
				flag: 'region',
				source: 'env',
				envVar: 'REGION',
				allowed: ['us', 'eu'],
			});
		});

		it('redacts a constraint violation and keeps the reason', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: { token: flag.string().pattern(/^ghp_/).env('TOKEN').sensitive().schema },
			});
			const error = await failure(schema, [], { env: { TOKEN: SECRET } });

			expect(error.message).toBe(
				"Invalid value '<redacted>' from env TOKEN for flag --token: must match /^ghp_/",
			);
		});

		it('redacts an unreadable key-value pair', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: { env: flag.keyValue().env('VARS').sensitive().schema },
			});
			const error = await failure(schema, [], { env: { VARS: SECRET } });

			expect(error.message).toBe(
				"Invalid key-value pair '<redacted>' from env VARS for flag --env",
			);
		});

		it('names JSON as unreadable without quoting the text', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: {
					tags: flag.array(flag.string()).split({ env: 'json' }).env('TAGS').sensitive().schema,
				},
			});
			const error = await failure(schema, [], { env: { TAGS: SECRET } });

			expect(error.message).toBe("Invalid JSON value '<redacted>' from env TAGS for flag --tags");
			expect(error.details).toEqual({
				flag: 'tags',
				source: 'env',
				envVar: 'TAGS',
				expected: 'json',
			});
		});

		it('omits a JSON parser cause that may contain the sensitive input', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: {
					tags: flag.array(flag.string()).split({ env: 'json' }).env('TAGS').sensitive().schema,
				},
			});
			const error = await failure(schema, [], { env: { TAGS: SECRET } });

			expect(error.details).not.toHaveProperty('cause');
			expect(error.cause).toBeUndefined();
			expect(JSON.stringify(error.toJSON())).not.toContain(SECRET);
		});
	});

	describe('non-sensitive inputs expose every resolver source', () => {
		const cases: ReadonlyArray<readonly [string, readonly string[], ResolveOptions]> = [
			['stdin fallback', [], { stdinData: SECRET }],
			['explicit dash', ['--port', '-'], { stdinData: SECRET }],
			['env', [], { env: { PORT: SECRET } }],
			['config', [], { config: { serve: { port: SECRET } } }],
			['prompt', [], { prompter: { promptOne: async () => ({ answered: true, value: SECRET }) } }],
		];

		test.each(cases)('keeps a %s value in message, details, and JSON', async (_, argv, options) => {
			const error = await failure(numberFlagCommand(false), argv, options);

			expect(error.message).toContain(`'${SECRET}'`);
			expect(error.details).toHaveProperty('value', SECRET);
			expect(JSON.stringify(error.toJSON())).toContain(SECRET);
		});

		it('keeps malformed JSON and its parser cause', async () => {
			const raw = '{private-json';
			const schema = createCommandSchema({
				name: 'test',
				flags: {
					tags: flag.array(flag.string()).split({ env: 'json' }).env('TAGS').schema,
				},
			});
			const error = await failure(schema, [], { env: { TAGS: raw } });

			expect(error.message).toContain(`'${raw}'`);
			expect(error.details).toMatchObject({
				value: raw,
				expected: 'json',
				cause: expect.any(String),
			});
			expect(JSON.stringify(error.toJSON())).toContain(raw);
		});
	});
});

describe('a duplicate key follows the owning input sensitivity', () => {
	/** An entries input reachable from stdin, env, and config under `'error'`. */
	function entriesCommand(surface: 'flag' | 'arg', sensitive = true): CommandSchema {
		const entries = { stdin: {}, env: 'VARS', config: 'run.vars', duplicateKeys: 'error' } as const;
		return surface === 'flag'
			? createCommandSchema({
					name: 'test',
					flags: {
						vars: flag
							.keyValue()
							.stdin()
							.env(entries.env)
							.config(entries.config)
							.duplicateKeys(entries.duplicateKeys)
							.sensitive(sensitive).schema,
					},
				})
			: createCommandSchema({
					name: 'test',
					args: [
						{
							name: 'vars',
							schema: arg
								.keyValue()
								.variadic()
								.stdin()
								.env(entries.env)
								.config(entries.config)
								.duplicateKeys(entries.duplicateKeys)
								.sensitive(sensitive).schema,
						},
					],
				});
	}

	it('redacts a key the environment carried', async () => {
		const error = await failure(entriesCommand('flag'), [], {
			env: { VARS: `${SECRET}=1,${SECRET}=2` },
		});

		expect(error.message).toBe("Duplicate key '<redacted>' from env VARS for flag --vars");
		expect(error.details).toEqual({ flag: 'vars', source: 'env', envVar: 'VARS' });
		expect(error.suggest).toBe('Set the repeated key once for --vars');
	});

	it('redacts a key a pipe carried', async () => {
		const error = await failure(entriesCommand('flag'), [], {
			stdinData: `${SECRET}=1\n${SECRET}=2\n`,
		});

		expect(error.message).toBe("Duplicate key '<redacted>' from stdin for flag --vars");
		expect(error.details).toEqual({ flag: 'vars', source: 'stdin' });
	});

	it('redacts a key a config file carried', async () => {
		const error = await failure(entriesCommand('flag'), [], {
			config: { run: { vars: `${SECRET}=1,${SECRET}=2` } },
		});

		expect(error.message).toBe("Duplicate key '<redacted>' from config run.vars for flag --vars");
		expect(error.details).toEqual({
			flag: 'vars',
			source: 'config',
			configPath: 'run.vars',
		});
	});

	it('redacts a key a pipe carried into a positional tail', async () => {
		const error = await failure(entriesCommand('arg'), [], {
			stdinData: `${SECRET}=1\n${SECRET}=2\n`,
		});

		expect(error.message).toBe("Duplicate key '<redacted>' from stdin for argument <vars>");
		expect(error.details).toEqual({ arg: 'vars', source: 'stdin' });
		expect(error.suggest).toBe('Set the repeated key once for <vars>');
	});

	it('keeps a key from non-sensitive CLI input', async () => {
		const error = await failure(entriesCommand('flag', false), [
			'--vars',
			`${SECRET}=1`,
			'--vars',
			`${SECRET}=2`,
		]);

		expect(error.message).toBe(`Duplicate key '${SECRET}' for flag --vars`);
		expect(error.details).toEqual({ flag: 'vars', key: SECRET });
		expect(error.suggest).toBe(`Set '${SECRET}' once for --vars`);
	});

	it('redacts a key from sensitive CLI input', async () => {
		const error = await failure(entriesCommand('flag'), [
			'--vars',
			`${SECRET}=1`,
			'--vars',
			`${SECRET}=2`,
		]);

		expect(error.message).toBe("Duplicate key '<redacted>' for flag --vars");
		expect(error.details).toEqual({ flag: 'vars' });
		expect(error.suggest).toBe('Set the repeated key once for --vars');
		expect(JSON.stringify(error.toJSON())).not.toContain(SECRET);
	});
});

describe('a JSON shape fault words the source the same way on both surfaces', () => {
	it('names the source and value before the expectation on a flag', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: { vars: flag.keyValue().split({ env: 'json' }).env('VARS').schema },
		});
		const error = await failure(schema, [], { env: { VARS: '["a"]' } });

		expect(error.message).toBe(
			'Invalid JSON value \'["a"]\' from env VARS for flag --vars, expected an object',
		);
		expect(error.details).toEqual({
			flag: 'vars',
			source: 'env',
			envVar: 'VARS',
			value: '["a"]',
			expected: 'object',
		});
	});

	it('names the source before the expectation on an arg', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [
				{
					name: 'vars',
					schema: arg.keyValue().variadic().split({ env: 'json' }).env('VARS').schema,
				},
			],
		});
		const error = await failure(schema, [], { env: { VARS: '["a"]' } });

		expect(error.message).toBe(
			'Invalid JSON value \'["a"]\' from env VARS for argument <vars>, expected an object',
		);
		expect(error.details).toMatchObject({ value: '["a"]', expected: 'object' });
	});
});

describe('Standard Schema failures follow the same rule', () => {
	/** A validator that always fails, so only the diagnostic shape is under test. */
	const rejects = {
		'~standard': {
			version: 1 as const,
			vendor: 'test',
			validate: () => ({ issues: [{ message: 'rejected' }] }),
		},
	};
	const rejectsAsync: StandardSchemaV1 = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: async () => ({ issues: [{ message: 'rejected' }] }),
		},
	};

	/** A command whose one flag is reachable from argv, a dash, and the environment. */
	function validatedCommand(sensitive = false): CommandSchema {
		return createCommandSchema({
			name: 'test',
			flags: { token: flag.custom(rejects).stdin().env('TOKEN').sensitive(sensitive).schema },
		});
	}

	it('records a value the user typed on the command line', async () => {
		const error = await failure(validatedCommand(), ['--token', 'typed']);

		expect(error.details).toEqual({ value: 'typed', issues: ['rejected'] });
	});

	for (const [name, argv, options] of [
		['a piped value', ['--token', '-'], { stdinData: SECRET }],
		['an environment value', [], { env: { TOKEN: SECRET } }],
	] as const) {
		it(`omits ${name} for a sensitive input`, async () => {
			const error = await failure(validatedCommand(true), [...argv], options);

			expect(error.details).toEqual({ issues: ['rejected'] });
			expect(JSON.stringify(error.details)).not.toContain(SECRET);
		});
	}

	it('omits an env-sourced positional value', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'token', schema: arg.custom(rejects).env('TOKEN').sensitive().schema }],
		});
		const error = await failure(schema, [], { env: { TOKEN: SECRET } });

		expect(error.details).toEqual({ issues: ['rejected'] });
	});

	it('omits a sensitive CLI value too', async () => {
		const error = await failure(validatedCommand(true), ['--token', SECRET]);

		expect(error.details).toEqual({ issues: ['rejected'] });
		expect(JSON.stringify(error.toJSON())).not.toContain(SECRET);
	});

	it('shows a non-sensitive default rejected by deferred validation', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: { token: flag.custom(rejectsAsync).default(SECRET).schema },
		});
		const error = await failure(schema, []);

		expect(error.details).toEqual({ value: SECRET, issues: ['rejected'] });
	});

	it('omits a sensitive default rejected by deferred validation', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: { token: flag.custom(rejectsAsync).default(SECRET).sensitive().schema },
		});
		const error = await failure(schema, []);

		expect(error.details).toEqual({ issues: ['rejected'] });
		expect(JSON.stringify(error.toJSON())).not.toContain(SECRET);
	});
});

// === L19 — the one channel redaction does not reach

describe('caller-authored text passes through verbatim', () => {
	it('keeps a parse function message intact while every framework field redacts', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: {
				token: flag
					.custom((raw) => {
						throw new Error(`bad input ${String(raw)}`);
					})
					.env('TOKEN')
					.sensitive().schema,
			},
		});
		const error = await failure(schema, [], { env: { TOKEN: SECRET } });

		expect(error.message).toBe(
			`Failed to parse env TOKEN for flag --token value '<redacted>': bad input ${SECRET}`,
		);
		expect(error.details).toEqual({
			flag: 'token',
			source: 'env',
			envVar: 'TOKEN',
			expected: 'custom',
		});
	});

	it('keeps the same message intact for a positional', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [
				{
					name: 'token',
					schema: arg
						.custom((raw) => {
							throw new Error(`bad input ${String(raw)}`);
						})
						.env('TOKEN')
						.sensitive().schema,
				},
			],
		});
		const error = await failure(schema, [], { env: { TOKEN: SECRET } });

		expect(error.message).toContain(`bad input ${SECRET}`);
		expect(error.details).not.toHaveProperty('value');
	});

	it('keeps a Standard Schema issue message intact', async () => {
		const echoes = {
			'~standard': {
				version: 1 as const,
				vendor: 'test',
				validate: (value: unknown) => ({ issues: [{ message: `rejected ${String(value)}` }] }),
			},
		};
		const schema = createCommandSchema({
			name: 'test',
			flags: { token: flag.custom(echoes).env('TOKEN').sensitive().schema },
		});
		const error = await failure(schema, [], { env: { TOKEN: SECRET } });

		expect(error.message).toContain(`rejected ${SECRET}`);
		expect(error.details).toEqual({ issues: [`rejected ${SECRET}`] });
	});
});

describe('argv keeps its diagnostics literal', () => {
	it('quotes the token the user typed for a flag', () => {
		const schema = numberFlagCommand(false);

		expect(() => parse(schema, ['--port', 'nope'])).toThrow(/Invalid number value 'nope'/);
	});

	it('quotes the token the user typed for an arg', () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'port', schema: arg.number().schema }],
		});

		expect(() => parse(schema, ['nope'])).toThrow(/'nope'/);
	});
});

describe('arg diagnostics', () => {
	it('redacts an env-sourced value and names its source', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'port', schema: arg.number().env('PORT').sensitive().schema }],
		});
		const error = await failure(schema, [], { env: { PORT: SECRET } });

		expect(error.message).toBe(
			"Invalid number value '<redacted>' from env PORT for argument <port>",
		);
		expect(error.details).toEqual({
			arg: 'port',
			source: 'env',
			envVar: 'PORT',
			expected: 'number',
		});
	});
});

// === L18 — the dedicated code for a dash with nothing piped

describe('MISSING_STDIN', () => {
	it('names the flag occurrence a pipe never filled', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: { tag: flag.array(flag.string()).stdin().schema },
		});
		const error = await failure(schema, ['--tag', 'a', '--tag', '-']);

		expect(error.code).toBe('MISSING_STDIN');
		expect(error.message).toBe("No piped stdin for the '-' occurrence of flag --tag");
		expect(error.details).toEqual({ flag: 'tag', source: 'stdin' });
	});

	it('names the positional occurrence a pipe never filled', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'files', schema: arg.string().variadic().stdin().schema }],
		});
		const error = await failure(schema, ['a', '-']);

		expect(error.code).toBe('MISSING_STDIN');
		expect(error.message).toBe("No piped stdin for the '-' occurrence of argument <files>");
		expect(error.details).toEqual({ arg: 'files', source: 'stdin' });
	});

	it('names the token a flag reading stdin only on a dash needs', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: { body: flag.string().stdin({ when: 'dash' }).required().schema },
		});
		const error = await failure(schema, []);

		expect(error.suggest).toBe('Provide --body <value> or pass --body - to read stdin');
	});

	it('leaves a scalar dash to the later sources instead', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'body', schema: arg.string().stdin().env('BODY').schema }],
		});

		const resolved = await resolve(schema, parse(schema, ['-']), { env: { BODY: 'from-env' } });

		expect(resolved.args).toEqual({ body: 'from-env' });
	});
});

// === L19 — a positional words its diagnostic from the value layer's verdict

describe('a positional keeps the whole reason a parse function threw', () => {
	/** A command whose one input rejects everything with `message`. */
	function throwing(surface: 'flag' | 'arg', message: string): CommandSchema {
		const parseFn = () => {
			throw new Error(message);
		};
		return surface === 'flag'
			? createCommandSchema({
					name: 'test',
					flags: { token: flag.custom(parseFn).env('TOKEN').schema },
				})
			: createCommandSchema({
					name: 'test',
					args: [{ name: 'token', schema: arg.custom(parseFn).env('TOKEN').schema }],
				});
	}

	for (const message of ['plain', 'bad input: really bad', 'a: b: c']) {
		it(`carries '${message}' through on both surfaces`, async () => {
			const forFlag = await failure(throwing('flag', message), [], { env: { TOKEN: 'v' } });
			const forArg = await failure(throwing('arg', message), [], { env: { TOKEN: 'v' } });

			expect(forFlag.message).toBe(
				`Failed to parse env TOKEN for flag --token value 'v': ${message}`,
			);
			expect(forArg.message).toBe(
				`Failed to parse env TOKEN for argument <token> value 'v': ${message}`,
			);
		});
	}

	it('carries a URL protocol reason a positional would otherwise cut to one word', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [
				{ name: 'endpoint', schema: arg.url({ protocols: ['https'] }).env('ENDPOINT').schema },
			],
		});
		const error = await failure(schema, [], { env: { ENDPOINT: 'http://example.com' } });

		expect(error.message).toBe(
			"Failed to parse env ENDPOINT for argument <endpoint> value 'http://example.com': URL protocol is not allowed. Allowed: https",
		);
	});

	it('carries a date reason whose own text holds colons', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'since', schema: arg.date().env('SINCE').schema }],
		});
		const error = await failure(schema, [], { env: { SINCE: 'nope' } });

		expect(error.message).toBe(
			"Failed to parse env SINCE for argument <since> value 'nope': Invalid date: expected ISO-8601 (e.g. 2026-07-10 or 2026-07-10T14:30:00Z)",
		);
	});
});

describe('a type mismatch says the same thing on both surfaces', () => {
	it('names the boolean spellings a positional accepts', async () => {
		const forFlag = await failure(
			createCommandSchema({
				name: 'test',
				flags: { yes: flag.boolean().env('YES').sensitive().schema },
			}),
			[],
			{ env: { YES: SECRET } },
		);
		const forArg = await failure(
			createCommandSchema({
				name: 'test',
				args: [{ name: 'yes', schema: arg.boolean().env('YES').sensitive().schema }],
			}),
			[],
			{ env: { YES: SECRET } },
		);

		expect(forFlag.message).toBe("Invalid boolean value '<redacted>' from env YES for flag --yes");
		expect(forArg.message).toBe(
			"Invalid boolean value '<redacted>' from env YES for argument <yes>",
		);
		expect(forFlag.suggest).toBe('Set YES to true/false, 1/0, or yes/no');
		expect(forArg.suggest).toBe('Set YES to true/false, 1/0, or yes/no');
		expect(forArg.details).toEqual({
			arg: 'yes',
			source: 'env',
			envVar: 'YES',
			expected: 'boolean',
		});
	});

	it('shows a non-sensitive config object a positional could not read as a string', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'target', schema: arg.string().config('deploy.target').schema }],
		});
		const error = await failure(schema, [], { config: { deploy: { target: {} } } });

		expect(error.message).toBe(
			"Invalid string value '{}' from config deploy.target for argument <target>",
		);
		expect(error.details).toEqual({
			arg: 'target',
			source: 'config',
			configPath: 'deploy.target',
			value: {},
			expected: 'string',
		});
		expect(error.suggest).toBe('Set deploy.target to a valid string for <target>');
	});
});

// === Filesystem checks use schema sensitivity too

describe('sensitive path checks redact every source', () => {
	const MISSING = '/home/u/.ssh/id_rsa';
	const nothingExists = (): Promise<'file' | 'directory' | null> => Promise.resolve(null);

	function pathFlagCommand(): CommandSchema {
		return createCommandSchema({
			name: 'test',
			flags: {
				key: flag
					.path({ mustExist: true })
					.stdin()
					.env('KEY')
					.config('auth.key')
					.default(MISSING)
					.sensitive().schema,
			},
		});
	}

	function pathArgCommand(): CommandSchema {
		return createCommandSchema({
			name: 'test',
			args: [
				{
					name: 'key',
					schema: arg
						.path({ mustExist: true })
						.stdin()
						.env('KEY')
						.config('auth.key')
						.default(MISSING)
						.sensitive().schema,
				},
			],
		});
	}

	const cases: ReadonlyArray<readonly [string, ResolveOptions]> = [
		['stdin', { stdinData: MISSING }],
		['env', { env: { KEY: MISSING } }],
		['config', { config: { auth: { key: MISSING } } }],
		['default', {}],
	];

	for (const [source, options] of cases) {
		it(`hides a ${source} path from a flag's message and details`, async () => {
			const error = await failure(pathFlagCommand(), [], { ...options, stat: nothingExists });

			expect(error.message).toBe("Path '<redacted>' for flag --key does not exist");
			expect(error.details).toEqual({ flag: 'key', constraint: 'mustExist' });
			expect(error.suggest).toBe('Provide an existing path for --key');
		});

		it(`hides a ${source} path from a positional's message and details`, async () => {
			const error = await failure(pathArgCommand(), [], { ...options, stat: nothingExists });

			expect(error.message).toBe("Path '<redacted>' for argument <key> does not exist");
			expect(error.details).toEqual({ arg: 'key', constraint: 'mustExist' });
			expect(error.suggest).toBe('Provide an existing path for <key>');
		});
	}

	it('redacts a path typed on the command line too', async () => {
		const forFlag = await failure(pathFlagCommand(), ['--key', MISSING], {
			stat: nothingExists,
		});
		const forArg = await failure(pathArgCommand(), [MISSING], { stat: nothingExists });

		expect(forFlag.message).toBe("Path '<redacted>' for flag --key does not exist");
		expect(forFlag.details).toEqual({ flag: 'key', constraint: 'mustExist' });
		expect(forArg.message).toBe("Path '<redacted>' for argument <key> does not exist");
		expect(forArg.details).toEqual({ arg: 'key', constraint: 'mustExist' });
	});

	it('hides a path an explicit dash piped in', async () => {
		const error = await failure(pathFlagCommand(), ['--key', '-'], {
			stdinData: MISSING,
			stat: nothingExists,
		});

		expect(error.message).toBe("Path '<redacted>' for flag --key does not exist");
		expect(error.details).toEqual({ flag: 'key', constraint: 'mustExist' });
	});

	it('hides a non-argv path from a wrong-type report', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: { key: flag.path({ type: 'file' }).env('KEY').sensitive().schema },
		});
		const error = await failure(schema, [], {
			env: { KEY: MISSING },
			stat: () => Promise.resolve('directory'),
		});

		expect(error.message).toBe("Path '<redacted>' for flag --key is a directory, expected a file");
		expect(error.details).toEqual({ flag: 'key', constraint: 'pathType', expected: 'file' });
	});

	it('hides a non-argv path from a failed directory creation', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: {
				out: flag.path({ type: 'directory', create: true }).env('OUT').sensitive().schema,
			},
		});
		const error = await failure(schema, [], {
			env: { OUT: MISSING },
			stat: nothingExists,
			mkdir: () => Promise.reject(new Error('EACCES')),
		});

		expect(error.message).toBe("Failed to create directory '<redacted>' for flag --out");
		expect(error.details).toEqual({ flag: 'out', constraint: 'create' });
		expect(JSON.stringify(error.toJSON())).not.toContain('EACCES');
	});

	it('checks every element of a collection an env value split', async () => {
		const schema = createCommandSchema({
			name: 'test',
			flags: {
				keys: flag
					.array(flag.path({ mustExist: true }))
					.env('KEYS')
					.sensitive().schema,
			},
		});
		const error = await failure(schema, [], {
			env: { KEYS: `${MISSING},/other/secret` },
			stat: nothingExists,
		});

		expect(error.message).toContain("Path '<redacted>' for flag --keys does not exist");
		expect(error.message).not.toContain(MISSING);
		expect(error.message).not.toContain('/other/secret');
		expect(JSON.stringify(error.details)).not.toContain('secret');
	});
});
