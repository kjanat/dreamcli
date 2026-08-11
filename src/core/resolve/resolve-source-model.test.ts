import { describe, expect, it } from 'vitest';
import { isValidationError } from '#internals/core/errors/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { createTestPrompter } from '#internals/core/prompt/index.ts';
import type { ArgConfig } from '#internals/core/schema/arg.ts';
import { ArgBuilder, arg, createArgSchema } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { resolve } from './index.ts';

// === L15 — the unified source model

// --- helpers

function flagCase(builder: FlagBuilder<FlagConfig>, argv: readonly string[]) {
	const schema = command('deploy')
		.flag('value', builder)
		.action(() => {}).schema;
	return { schema, parsed: parse(schema, argv) };
}

function argCase(builder: ArgBuilder<ArgConfig>, argv: readonly string[]) {
	const schema = command('deploy')
		.arg('value', builder)
		.action(() => {}).schema;
	return { schema, parsed: parse(schema, argv) };
}

const everySource = {
	stdinData: 'stdin-value',
	env: { VALUE: 'env-value' },
	config: { deploy: { value: 'config-value' } },
	prompter: createTestPrompter(['prompt-value']),
};

// --- precedence matrix, flag surface

describe('flag precedence — every adjacent stage beats the next', () => {
	const full = () =>
		flag
			.string()
			.stdin()
			.env('VALUE')
			.config('deploy.value')
			.prompt({ kind: 'input', message: 'Value' })
			.default('default-value');

	it('cli beats stdin', async () => {
		const { schema, parsed } = flagCase(full(), ['--value', 'cli-value']);
		const result = await resolve(schema, parsed, everySource);
		expect(result.flags.value).toBe('cli-value');
	});

	it('stdin beats env', async () => {
		const { schema, parsed } = flagCase(full(), []);
		const result = await resolve(schema, parsed, everySource);
		expect(result.flags.value).toBe('stdin-value');
	});

	it('env beats config', async () => {
		const { schema, parsed } = flagCase(full(), []);
		const result = await resolve(schema, parsed, {
			env: everySource.env,
			config: everySource.config,
			prompter: createTestPrompter(['prompt-value']),
		});
		expect(result.flags.value).toBe('env-value');
	});

	it('config beats prompt', async () => {
		const { schema, parsed } = flagCase(full(), []);
		const result = await resolve(schema, parsed, {
			config: everySource.config,
			prompter: createTestPrompter(['prompt-value']),
		});
		expect(result.flags.value).toBe('config-value');
	});

	it('prompt beats default', async () => {
		const { schema, parsed } = flagCase(full(), []);
		const result = await resolve(schema, parsed, {
			prompter: createTestPrompter(['prompt-value']),
		});
		expect(result.flags.value).toBe('prompt-value');
	});

	it('default wins when every earlier stage is absent', async () => {
		const { schema, parsed } = flagCase(full(), []);
		const result = await resolve(schema, parsed, {});
		expect(result.flags.value).toBe('default-value');
	});

	it('reads stdin even when the flag is set in the environment', async () => {
		const { schema, parsed } = flagCase(flag.string().stdin().env('VALUE'), []);
		const result = await resolve(schema, parsed, {
			stdinData: 'stdin-value',
			env: { VALUE: 'env-value' },
		});
		expect(result.flags.value).toBe('stdin-value');
	});
});

// --- precedence matrix, arg surface

describe('arg precedence — every adjacent stage beats the next', () => {
	const full = () =>
		arg
			.string()
			.stdin()
			.env('VALUE')
			.config('deploy.value')
			.prompt({ kind: 'input', message: 'Value' })
			.default('default-value');

	it('cli beats stdin', async () => {
		const { schema, parsed } = argCase(full(), ['cli-value']);
		const result = await resolve(schema, parsed, everySource);
		expect(result.args.value).toBe('cli-value');
	});

	it('stdin beats env', async () => {
		const { schema, parsed } = argCase(full(), []);
		const result = await resolve(schema, parsed, everySource);
		expect(result.args.value).toBe('stdin-value');
	});

	it('env beats config', async () => {
		const { schema, parsed } = argCase(full(), []);
		const result = await resolve(schema, parsed, {
			env: everySource.env,
			config: everySource.config,
			prompter: createTestPrompter(['prompt-value']),
		});
		expect(result.args.value).toBe('env-value');
	});

	it('config beats prompt', async () => {
		const { schema, parsed } = argCase(full(), []);
		const result = await resolve(schema, parsed, {
			config: everySource.config,
			prompter: createTestPrompter(['prompt-value']),
		});
		expect(result.args.value).toBe('config-value');
	});

	it('prompt beats default', async () => {
		const { schema, parsed } = argCase(full(), []);
		const result = await resolve(schema, parsed, {
			prompter: createTestPrompter(['prompt-value']),
		});
		expect(result.args.value).toBe('prompt-value');
	});

	it('default wins when every earlier stage is absent', async () => {
		const { schema, parsed } = argCase(full(), []);
		const result = await resolve(schema, parsed, {});
		expect(result.args.value).toBe('default-value');
	});

	it('reads stdin even when the arg is set in the environment', async () => {
		const { schema, parsed } = argCase(arg.string().stdin().env('VALUE'), []);
		const result = await resolve(schema, parsed, {
			stdinData: 'stdin-value',
			env: { VALUE: 'env-value' },
		});
		expect(result.args.value).toBe('stdin-value');
	});
});

// --- new arg sources end to end

describe('arg config and prompt sources', () => {
	it('resolves an arg from a dotted config path', async () => {
		const { schema, parsed } = argCase(arg.string().config('deploy.target').optional(), []);
		const result = await resolve(schema, parsed, { config: { deploy: { target: 'eu' } } });
		expect(result.args.value).toBe('eu');
	});

	it('coerces a config number for a number arg', async () => {
		const { schema, parsed } = argCase(arg.number().config('deploy.port').optional(), []);
		const result = await resolve(schema, parsed, { config: { deploy: { port: 8080 } } });
		expect(result.args.value).toBe(8080);
	});

	it('resolves an arg from a prompt answer', async () => {
		const { schema, parsed } = argCase(
			arg.string().prompt({ kind: 'input', message: 'Target' }),
			[],
		);
		const result = await resolve(schema, parsed, { prompter: createTestPrompter(['staging']) });
		expect(result.args.value).toBe('staging');
	});

	it('falls through to the default when no prompter is available', async () => {
		const { schema, parsed } = argCase(
			arg.string().prompt({ kind: 'input', message: 'Target' }).default('fallback'),
			[],
		);
		const result = await resolve(schema, parsed, {});
		expect(result.args.value).toBe('fallback');
	});

	it('rejects a prompt kind the arg kind cannot carry', async () => {
		const schema = command('deploy')
			.arg(
				'value',
				new ArgBuilder(
					createArgSchema('number', { prompt: { kind: 'confirm', message: 'Port?' } }),
				),
			)
			.action(() => {}).schema;

		await expect(
			resolve(schema, parse(schema, []), { prompter: createTestPrompter(['yes']) }),
		).rejects.toMatchObject({
			code: 'CONSTRAINT_VIOLATED',
			message:
				"Prompt kind 'confirm' is not compatible with number argument <value>. Use 'input' instead",
			suggest: "Change the prompt to { kind: 'input' } for <value>",
		});
	});

	it('names config in the missing-arg suggestion', async () => {
		const { schema, parsed } = argCase(arg.string().stdin().env('VALUE').config('a.b'), []);
		await expect(resolve(schema, parsed, {})).rejects.toMatchObject({
			suggest:
				"Provide a value for <value>, pipe a value to stdin or pass '-', set VALUE, or add a.b to config",
		});
	});

	it('describes the dash-only stdin form for a missing flag', async () => {
		const { schema, parsed } = flagCase(flag.string().stdin({ when: 'dash' }).required(), []);
		await expect(resolve(schema, parsed, {})).rejects.toMatchObject({
			suggest: 'Provide --value <value> or pass --value - to read stdin',
		});
	});

	it('describes the missing-only stdin form for a missing flag', async () => {
		const { schema, parsed } = flagCase(flag.string().stdin({ when: 'missing' }).required(), []);
		await expect(resolve(schema, parsed, {})).rejects.toMatchObject({
			suggest: 'Provide --value <value> or pipe a value to stdin',
		});
	});

	it('redacts a config value that fails arg coercion', async () => {
		const { schema, parsed } = argCase(arg.number().config('deploy.port'), []);
		const error = await resolve(schema, parsed, {
			config: { deploy: { port: 'not-a-number' } },
		}).catch((thrown: unknown) => thrown);
		expect(isValidationError(error)).toBe(true);
		expect(error).toMatchObject({
			message: "Invalid number value '<redacted>' from config deploy.port for argument <value>",
		});
	});
});

// --- stdin trigger modes

describe('stdin trigger modes', () => {
	it("'dash-or-missing' reads stdin for an absent input", async () => {
		const { schema, parsed } = argCase(arg.string().stdin().optional(), []);
		const result = await resolve(schema, parsed, { stdinData: 'piped' });
		expect(result.args.value).toBe('piped');
	});

	it("'dash-or-missing' reads stdin for an explicit dash", async () => {
		const { schema, parsed } = argCase(arg.string().stdin(), ['-']);
		const result = await resolve(schema, parsed, { stdinData: 'piped' });
		expect(result.args.value).toBe('piped');
	});

	it("'dash' ignores an absent input", async () => {
		const { schema, parsed } = argCase(
			arg.string().stdin({ when: 'dash' }).env('VALUE').optional(),
			[],
		);
		const result = await resolve(schema, parsed, {
			stdinData: 'piped',
			env: { VALUE: 'env-value' },
		});
		expect(result.args.value).toBe('env-value');
	});

	it("'dash' reads stdin for an explicit dash", async () => {
		const { schema, parsed } = argCase(arg.string().stdin({ when: 'dash' }).env('VALUE'), ['-']);
		const result = await resolve(schema, parsed, {
			stdinData: 'piped',
			env: { VALUE: 'env-value' },
		});
		expect(result.args.value).toBe('piped');
	});

	it("'missing' reads stdin for an absent input", async () => {
		const { schema, parsed } = argCase(arg.string().stdin({ when: 'missing' }).env('VALUE'), []);
		const result = await resolve(schema, parsed, {
			stdinData: 'piped',
			env: { VALUE: 'env-value' },
		});
		expect(result.args.value).toBe('piped');
	});

	it("'missing' keeps a dash as the literal value", async () => {
		const { schema, parsed } = argCase(arg.string().stdin({ when: 'missing' }), ['-']);
		const result = await resolve(schema, parsed, { stdinData: 'piped' });
		expect(result.args.value).toBe('-');
	});

	it('applies the same three modes to a flag', async () => {
		const dashOnly = flagCase(flag.string().stdin({ when: 'dash' }).env('VALUE'), []);
		expect(
			(
				await resolve(dashOnly.schema, dashOnly.parsed, {
					stdinData: 'piped',
					env: { VALUE: 'env-value' },
				})
			).flags.value,
		).toBe('env-value');

		const missingOnly = flagCase(flag.string().stdin({ when: 'missing' }), ['--value', '-']);
		expect(
			(await resolve(missingOnly.schema, missingOnly.parsed, { stdinData: 'piped' })).flags.value,
		).toBe('-');
	});

	it("falls through from '-' to the later stages when nothing was piped", async () => {
		const { schema, parsed } = argCase(arg.string().stdin().env('VALUE').default('fallback'), [
			'-',
		]);
		const result = await resolve(schema, parsed, { env: { VALUE: 'env-value' } });
		expect(result.args.value).toBe('env-value');
	});
});

// --- an explicit dash keeps CLI precedence

describe("explicit '-' is CLI-sourced", () => {
	it('outranks env for an arg', async () => {
		const { schema, parsed } = argCase(arg.string().stdin().env('VALUE'), ['-']);
		const result = await resolve(schema, parsed, {
			stdinData: 'piped',
			env: { VALUE: 'env-value' },
		});
		expect(result.args.value).toBe('piped');
		expect(result.provenance.args.value).toEqual({
			stage: 'cli',
			via: 'stdin',
			trigger: 'dash',
		});
	});

	it('outranks env for a flag', async () => {
		const { schema, parsed } = flagCase(flag.string().stdin().env('VALUE'), ['--value', '-']);
		const result = await resolve(schema, parsed, {
			stdinData: 'piped',
			env: { VALUE: 'env-value' },
		});
		expect(result.flags.value).toBe('piped');
		expect(result.provenance.flags.value).toEqual({
			stage: 'cli',
			via: 'stdin',
			trigger: 'dash',
		});
	});

	it('survives the parse boundary for a number flag', async () => {
		const { schema, parsed } = flagCase(flag.number().stdin(), ['--value', '-']);
		const result = await resolve(schema, parsed, { stdinData: '8080\n' });
		expect(result.flags.value).toBe(8080);
	});

	it('survives the parse boundary for an enum arg', async () => {
		const { schema, parsed } = argCase(arg.enum(['us', 'eu']).stdin(), ['-']);
		const result = await resolve(schema, parsed, { stdinData: 'eu\n' });
		expect(result.args.value).toBe('eu');
	});

	it('stays the literal value for an input that never reads stdin', async () => {
		const { schema, parsed } = argCase(arg.string(), ['-']);
		const result = await resolve(schema, parsed, { stdinData: 'piped' });
		expect(result.args.value).toBe('-');
	});
});

// --- broadcast consumption

describe('broadcast stdin consumers', () => {
	it('hands the same buffer to every broadcast consumer', async () => {
		const schema = command('deploy')
			.flag('body', flag.string().stdin({ consume: 'broadcast' }))
			.arg('input', arg.string().stdin({ consume: 'broadcast' }))
			.action(() => {}).schema;
		const result = await resolve(schema, parse(schema, []), { stdinData: 'shared\n' });

		expect(result.flags.body).toBe('shared\n');
		expect(result.args.input).toBe('shared\n');
	});
});

// --- stdin decoding

describe('stdin decoding', () => {
	it('preserves the buffer byte for byte for a string input', async () => {
		const argResult = await (async () => {
			const { schema, parsed } = argCase(arg.string().stdin(), []);
			return resolve(schema, parsed, { stdinData: 'hello\n' });
		})();
		const flagResult = await (async () => {
			const { schema, parsed } = flagCase(flag.string().stdin(), []);
			return resolve(schema, parsed, { stdinData: 'hello\n' });
		})();

		expect(argResult.args.value).toBe('hello\n');
		expect(flagResult.flags.value).toBe('hello\n');
	});

	it('preserves interior newlines and a blank final line', async () => {
		const { schema, parsed } = argCase(arg.string().stdin(), []);
		const result = await resolve(schema, parsed, { stdinData: 'a\nb\n\n' });
		expect(result.args.value).toBe('a\nb\n\n');
	});

	it('drops one trailing terminator before every non-string codec', async () => {
		const cases: readonly (readonly [string, unknown])[] = [
			['42\n', 42],
			['42\r\n', 42],
			['42\r', 42],
			['42', 42],
		];
		for (const [buffer, expected] of cases) {
			const { schema, parsed } = argCase(arg.number().stdin(), []);
			const result = await resolve(schema, parsed, { stdinData: buffer });
			expect(result.args.value).toBe(expected);
		}
	});

	it('decodes a piped boolean flag identically to a piped env value', async () => {
		const piped = flagCase(flag.boolean().stdin(), []);
		const env = flagCase(flag.boolean().env('VALUE'), []);

		expect((await resolve(piped.schema, piped.parsed, { stdinData: 'true\n' })).flags.value).toBe(
			true,
		);
		expect((await resolve(env.schema, env.parsed, { env: { VALUE: 'true' } })).flags.value).toBe(
			true,
		);
		expect((await resolve(piped.schema, piped.parsed, { stdinData: 'yes\n' })).flags.value).toBe(
			true,
		);
		expect((await resolve(piped.schema, piped.parsed, { stdinData: 'no\n' })).flags.value).toBe(
			false,
		);
	});

	it('rejects the prompt-only boolean spellings from stdin, as env does', async () => {
		const { schema, parsed } = flagCase(flag.boolean().stdin(), []);
		await expect(resolve(schema, parsed, { stdinData: 'y\n' })).rejects.toMatchObject({
			code: 'TYPE_MISMATCH',
		});
	});

	it('decodes a piped enum on both surfaces', async () => {
		const flagResult = await (async () => {
			const { schema, parsed } = flagCase(flag.enum(['us', 'eu']).stdin(), []);
			return resolve(schema, parsed, { stdinData: 'eu\n' });
		})();
		const argResult = await (async () => {
			const { schema, parsed } = argCase(arg.enum(['us', 'eu']).stdin(), []);
			return resolve(schema, parsed, { stdinData: 'eu\n' });
		})();

		expect(flagResult.flags.value).toBe('eu');
		expect(argResult.args.value).toBe('eu');
	});

	it('decodes a piped duration, which the raw terminator would have rejected', async () => {
		const { schema, parsed } = argCase(arg.duration().stdin(), []);
		const result = await resolve(schema, parsed, { stdinData: '1h30m\n' });
		expect(result.args.value).toBe(5_400_000);
	});

	it('names stdin in a flag coercion failure', async () => {
		const { schema, parsed } = flagCase(flag.number().stdin(), []);
		await expect(resolve(schema, parsed, { stdinData: 'nope' })).rejects.toMatchObject({
			message: "Invalid number value '<redacted>' from stdin for flag --value",
			details: { flag: 'value', source: 'stdin', expected: 'number' },
		});
	});
});

// --- provenance

describe('provenance record', () => {
	const fullFlag = () =>
		flag
			.string()
			.stdin()
			.env('VALUE')
			.config('deploy.value')
			.prompt({ kind: 'input', message: 'Value' })
			.default('default-value');

	const fullArg = () =>
		arg
			.string()
			.stdin()
			.env('VALUE')
			.config('deploy.value')
			.prompt({ kind: 'input', message: 'Value' })
			.default('default-value');

	it('records every stage for a flag', async () => {
		const stages = [
			[['--value', 'cli'], {}, { stage: 'cli' }],
			[[], { stdinData: 'piped' }, { stage: 'stdin', via: 'stdin', trigger: 'fallback' }],
			[[], { env: { VALUE: 'e' } }, { stage: 'env', envVar: 'VALUE' }],
			[[], { config: { deploy: { value: 'c' } } }, { stage: 'config', configPath: 'deploy.value' }],
			[[], { prompter: createTestPrompter(['p']) }, { stage: 'prompt' }],
			[[], {}, { stage: 'default' }],
		] as const;

		for (const [argv, options, provenance] of stages) {
			const built = flagCase(fullFlag(), argv);
			const result = await resolve(built.schema, built.parsed, options);
			expect(result.provenance.flags.value).toEqual(provenance);
		}
	});

	it('records every stage for an arg', async () => {
		const stages = [
			[['cli'], {}, { stage: 'cli' }],
			[[], { stdinData: 'piped' }, { stage: 'stdin', via: 'stdin', trigger: 'fallback' }],
			[[], { env: { VALUE: 'e' } }, { stage: 'env', envVar: 'VALUE' }],
			[[], { config: { deploy: { value: 'c' } } }, { stage: 'config', configPath: 'deploy.value' }],
			[[], { prompter: createTestPrompter(['p']) }, { stage: 'prompt' }],
			[[], {}, { stage: 'default' }],
		] as const;

		for (const [argv, options, provenance] of stages) {
			const built = argCase(fullArg(), argv);
			const result = await resolve(built.schema, built.parsed, options);
			expect(result.provenance.args.value).toEqual(provenance);
		}
	});

	it('leaves an unresolved optional input out of the record', async () => {
		const { schema, parsed } = flagCase(flag.string(), []);
		const result = await resolve(schema, parsed, {});
		expect(Object.hasOwn(result.provenance.flags, 'value')).toBe(false);
	});

	it('records the kind fallback of an empty collection as a default', async () => {
		const schema = command('deploy')
			.flag('tags', flag.array(flag.string()))
			.flag('vars', flag.keyValue())
			.arg('rest', arg.string().variadic().optional())
			.action(() => {}).schema;
		const result = await resolve(schema, parse(schema, []), {});

		expect(result.provenance.flags.tags).toEqual({ stage: 'default' });
		expect(result.provenance.flags.vars).toEqual({ stage: 'default' });
		expect(result.provenance.args.rest).toEqual({ stage: 'default' });
	});
});
