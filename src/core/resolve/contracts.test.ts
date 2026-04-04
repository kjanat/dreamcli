import { describe, expect, it } from 'vitest';
import { isValidationError, type ValidationError } from '#internals/core/errors/index.ts';
import type { ParseResult } from '#internals/core/parse/index.ts';
import { createTestPrompter } from '#internals/core/prompt/index.ts';
import { createArgSchema } from '#internals/core/schema/arg.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { createSchema } from '#internals/core/schema/flag.ts';
import { resolverContract } from './contracts.ts';
import { resolve } from './index.ts';

function makeSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: false,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
	return {
		flags: {},
		args: {},
		...overrides,
	};
}

async function catchValidationError(
	schema: CommandSchema,
	parsed: ParseResult,
	options?: Parameters<typeof resolve>[2],
): Promise<ValidationError> {
	try {
		await resolve(schema, parsed, options);
		expect.unreachable('should have thrown');
	} catch (error) {
		expect(isValidationError(error)).toBe(true);
		if (isValidationError(error)) {
			return error;
		}
	}

	throw new Error('unreachable');
}

// === resolver contracts

describe('resolver contracts', () => {
	// --- explicit facts

	describe('explicit facts', () => {
		it('keeps precedence and error guarantees explicit', () => {
			expect(resolverContract).toEqual({
				flagPrecedence: ['cli', 'env', 'config', 'prompt', 'default'],
				argPrecedence: ['cli', 'stdin', 'env', 'default'],
				promptRunsAfterFlagConfig: true,
				aggregatesValidationErrors: true,
				aggregateDiagnosticsIncludePerIssueSummary: true,
				hardCoercionErrorsStopFallback: true,
				collectsDeprecationsFromExplicitSources: true,
			});
		});
	});

	// --- flag precedence matrix

	describe('flag precedence matrix', () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					configPath: 'deploy.region',
					prompt: { kind: 'input', message: 'Region' },
					presence: 'defaulted',
					defaultValue: 'default-region',
				}),
			},
		});

		const cases = [
			{
				name: 'cli wins over every later source',
				parsed: makeParsed({ flags: { region: 'cli-region' } }),
				options: {
					env: { REGION: 'env-region' },
					config: { deploy: { region: 'config-region' } },
					prompter: createTestPrompter(['prompt-region']),
				},
				expected: 'cli-region',
			},
			{
				name: 'env wins when cli is absent',
				parsed: makeParsed(),
				options: {
					env: { REGION: 'env-region' },
					config: { deploy: { region: 'config-region' } },
					prompter: createTestPrompter(['prompt-region']),
				},
				expected: 'env-region',
			},
			{
				name: 'config wins when cli and env are absent',
				parsed: makeParsed(),
				options: {
					env: {},
					config: { deploy: { region: 'config-region' } },
					prompter: createTestPrompter(['prompt-region']),
				},
				expected: 'config-region',
			},
			{
				name: 'prompt wins when earlier sources are absent',
				parsed: makeParsed(),
				options: {
					env: {},
					config: {},
					prompter: createTestPrompter(['prompt-region']),
				},
				expected: 'prompt-region',
			},
			{
				name: 'default wins when earlier sources are absent or unavailable',
				parsed: makeParsed(),
				options: {
					env: {},
					config: {},
				},
				expected: 'default-region',
			},
		] as const;

		for (const testCase of cases) {
			it(testCase.name, async () => {
				const result = await resolve(schema, testCase.parsed, testCase.options);
				expect(result.flags).toEqual({ region: testCase.expected });
			});
		}

		it('does not prompt after config already resolved the flag', async () => {
			const result = await resolve(schema, makeParsed(), {
				config: { deploy: { region: 'config-region' } },
				prompter: createTestPrompter([]),
			});

			expect(result.flags).toEqual({ region: 'config-region' });
		});
	});

	// --- arg precedence matrix

	describe('arg precedence matrix', () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', {
						stdinMode: true,
						envVar: 'TARGET',
						presence: 'defaulted',
						defaultValue: 'default-target',
					}),
				},
			],
		});

		const cases = [
			{
				name: 'cli wins over stdin env and default',
				parsed: makeParsed({ args: { target: 'cli-target' } }),
				options: {
					stdinData: 'stdin-target',
					env: { TARGET: 'env-target' },
				},
				expected: 'cli-target',
			},
			{
				name: 'stdin wins over env and default',
				parsed: makeParsed(),
				options: {
					stdinData: 'stdin-target',
					env: { TARGET: 'env-target' },
				},
				expected: 'stdin-target',
			},
			{
				name: 'env wins over default when cli and stdin are absent',
				parsed: makeParsed(),
				options: {
					env: { TARGET: 'env-target' },
				},
				expected: 'env-target',
			},
			{
				name: 'default wins when higher arg sources are absent',
				parsed: makeParsed(),
				options: {
					env: {},
				},
				expected: 'default-target',
			},
		] as const;

		for (const testCase of cases) {
			it(testCase.name, async () => {
				const result = await resolve(schema, testCase.parsed, testCase.options);
				expect(result.args).toEqual({ target: testCase.expected });
			});
		}

		it("treats '-' as stdin before env and default", async () => {
			const result = await resolve(schema, makeParsed({ args: { target: '-' } }), {
				stdinData: 'stdin-target',
				env: { TARGET: 'env-target' },
			});

			expect(result.args).toEqual({ target: 'stdin-target' });
		});
	});

	// --- hard errors and aggregation

	describe('hard errors and aggregation', () => {
		it('keeps env coercion errors authoritative for flags instead of falling through', async () => {
			const schema = makeSchema({
				flags: {
					port: createSchema('number', {
						envVar: 'PORT',
						configPath: 'deploy.port',
						prompt: { kind: 'input', message: 'Port' },
						presence: 'defaulted',
						defaultValue: 3000,
					}),
				},
			});

			const error = await catchValidationError(schema, makeParsed(), {
				env: { PORT: 'bad-port' },
				config: { deploy: { port: 7000 } },
				prompter: createTestPrompter(['8000']),
			});

			expect(error.code).toBe('TYPE_MISMATCH');
			expect(error.details).toEqual({
				flag: 'port',
				envVar: 'PORT',
				value: 'bad-port',
				expected: 'number',
			});
		});

		it('keeps stdin coercion errors authoritative for args instead of falling through', async () => {
			const schema = makeSchema({
				args: [
					{
						name: 'count',
						schema: createArgSchema('number', {
							stdinMode: true,
							envVar: 'COUNT',
							presence: 'defaulted',
							defaultValue: 1,
						}),
					},
				],
			});

			const error = await catchValidationError(schema, makeParsed(), {
				stdinData: 'bad-count',
				env: { COUNT: '2' },
			});

			expect(error.code).toBe('TYPE_MISMATCH');
			expect(error.message).toBe(
				"Invalid number value '<redacted>' from stdin for argument <count>",
			);
			expect(error.details).toEqual({
				arg: 'count',
				source: 'stdin',
				expected: 'number',
			});
			expect(error.suggest).toBe('Pipe a valid number to stdin for <count>');
		});

		it('aggregates independent flag and arg validation failures into one error', async () => {
			const schema = makeSchema({
				flags: {
					token: createSchema('string', { presence: 'required', envVar: 'API_TOKEN' }),
				},
				args: [
					{
						name: 'target',
						schema: createArgSchema('string', {
							presence: 'required',
							stdinMode: true,
							envVar: 'DEPLOY_TARGET',
						}),
					},
				],
			});

			const error = await catchValidationError(schema, makeParsed(), { env: {} });

			expect(error.message).toContain('Multiple validation errors');
			expect(error.toJSON()).toMatchObject({
				details: {
					count: 2,
					errors: [
						{
							code: 'REQUIRED_FLAG',
							suggest: 'Provide --token <value> or set API_TOKEN',
						},
						{
							code: 'REQUIRED_ARG',
							suggest:
								"Provide a value for <target>, pipe a value to stdin or pass '-', or set DEPLOY_TARGET",
						},
					],
				},
			});
		});
	});
});
