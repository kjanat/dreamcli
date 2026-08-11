import { describe, expect, it, test } from 'vitest';
import { isValidationError, type ValidationError } from '#internals/core/errors/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { createCommandSchema } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { ResolveOptions } from './index.ts';
import { resolve } from './index.ts';

// === L18 — no non-literal-CLI source echoes its value into a diagnostic

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

/** A command with one number flag reachable from every non-literal-CLI source. */
function numberFlagCommand(): CommandSchema {
	return createCommandSchema({
		name: 'test',
		flags: {
			port: flag
				.number()
				.stdin()
				.env('PORT')
				.config('serve.port')
				.prompt({ kind: 'input', message: 'Port' }).schema,
		},
	});
}

describe('flag diagnostics', () => {
	describe('redact every non-literal CLI source', () => {
		const cases: ReadonlyArray<readonly [string, ResolveOptions]> = [
			['stdin', { stdinData: SECRET }],
			['env', { env: { PORT: SECRET } }],
			['config', { config: { serve: { port: SECRET } } }],
		];

		test.each(cases)('keeps a %s value out of the message and the details', async (_, options) => {
			const error = await failure(numberFlagCommand(), [], options);

			expect(error.message).toContain("'<redacted>'");
			expect(error.message).not.toContain(SECRET);
			expect(JSON.stringify(error.details)).not.toContain(SECRET);
			expect(error.details).not.toHaveProperty('value');
		});

		it('keeps a prompt answer out of the message and the details', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: { port: flag.number().prompt({ kind: 'input', message: 'Port' }).schema },
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
				flags: { region: flag.enum(['us', 'eu']).env('REGION').schema },
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
				flags: { token: flag.string().pattern(/^ghp_/).env('TOKEN').schema },
			});
			const error = await failure(schema, [], { env: { TOKEN: SECRET } });

			expect(error.message).toBe(
				"Invalid value '<redacted>' from env TOKEN for flag --token: must match /^ghp_/",
			);
		});

		it('redacts an unreadable key-value pair', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: { env: flag.keyValue().env('VARS').schema },
			});
			const error = await failure(schema, [], { env: { VARS: SECRET } });

			expect(error.message).toBe(
				"Invalid key-value pair '<redacted>' from env VARS for flag --env",
			);
		});

		it('names JSON as unreadable without quoting the text', async () => {
			const schema = createCommandSchema({
				name: 'test',
				flags: { tags: flag.array(flag.string()).split({ env: 'json' }).env('TAGS').schema },
			});
			const error = await failure(schema, [], { env: { TAGS: SECRET } });

			expect(error.message).toBe('Invalid JSON value from env TAGS for flag --tags');
		});
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

	/** A command whose one flag is reachable from argv, a dash, and the environment. */
	function validatedCommand(): CommandSchema {
		return createCommandSchema({
			name: 'test',
			flags: { token: flag.custom(rejects).stdin().env('TOKEN').schema },
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
		it(`omits ${name}`, async () => {
			const error = await failure(validatedCommand(), [...argv], options);

			expect(error.details).toEqual({ issues: ['rejected'] });
			expect(JSON.stringify(error.details)).not.toContain(SECRET);
		});
	}

	it('omits an env-sourced positional value', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'token', schema: arg.custom(rejects).env('TOKEN').schema }],
		});
		const error = await failure(schema, [], { env: { TOKEN: SECRET } });

		expect(error.details).toEqual({ issues: ['rejected'] });
	});
});

describe('argv keeps its diagnostics literal', () => {
	it('quotes the token the user typed for a flag', () => {
		const schema = numberFlagCommand();

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

describe('arg diagnostics are unchanged', () => {
	it('still redacts an env-sourced value', async () => {
		const schema = createCommandSchema({
			name: 'test',
			args: [{ name: 'port', schema: arg.number().env('PORT').schema }],
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
