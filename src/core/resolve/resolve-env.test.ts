import { describe, expect, it } from 'vitest';
import { isValidationError, ValidationError } from '../errors/index.ts';
import type { ParseResult } from '../parse/index.ts';
import type { CommandSchema } from '../schema/command.ts';
import { createSchema } from '../schema/flag.ts';
import type { ResolveOptions } from './index.ts';
import { resolve } from './index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ========================================================================
// Env resolution — basic value coercion
// ========================================================================

describe('resolve — env string flags', () => {
	it('resolves string flag from env when CLI absent', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', { envVar: 'DEPLOY_REGION' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { DEPLOY_REGION: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('CLI value takes precedence over env', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', { envVar: 'DEPLOY_REGION' }),
			},
		});
		const parsed = makeParsed({ flags: { region: 'us' } });
		const options: ResolveOptions = { env: { DEPLOY_REGION: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('env takes precedence over default', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'DEPLOY_REGION',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { DEPLOY_REGION: 'ap' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'ap' });
	});

	it('falls through to default when env var not set', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'DEPLOY_REGION',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: {} };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('ignores env when flag has no envVar declared', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', { presence: 'defaulted', defaultValue: 'us' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { DEPLOY_REGION: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});
});

// ========================================================================
// Env resolution — number coercion
// ========================================================================

describe('resolve — env number flags', () => {
	it('coerces env string to number', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: '8080' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ port: 8080 });
	});

	it('coerces env float string to number', async () => {
		const schema = makeSchema({
			flags: {
				threshold: createSchema('number', { envVar: 'THRESHOLD' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { THRESHOLD: '0.75' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ threshold: 0.75 });
	});

	it('throws ValidationError for non-numeric env value', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: 'not-a-number' } };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});

	it('env number error has TYPE_MISMATCH code and details', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: 'abc' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('TYPE_MISMATCH');
				expect(err.details).toEqual({
					flag: 'port',
					envVar: 'PORT',
					value: 'abc',
					expected: 'number',
				});
				expect(err.suggest).toBe('Set PORT to a valid number');
			}
		}
	});
});

// ========================================================================
// Env resolution — boolean coercion
// ========================================================================

describe('resolve — env boolean flags', () => {
	const booleanCases: ReadonlyArray<readonly [string, boolean]> = [
		['true', true],
		['True', true],
		['TRUE', true],
		['1', true],
		['yes', true],
		['YES', true],
		['false', false],
		['False', false],
		['FALSE', false],
		['0', false],
		['no', false],
		['NO', false],
		['', false],
	];

	for (const [input, expected] of booleanCases) {
		it(`coerces env '${input}' to ${String(expected)}`, async () => {
			const schema = makeSchema({
				flags: {
					verbose: createSchema('boolean', {
						envVar: 'VERBOSE',
						presence: 'defaulted',
						defaultValue: false,
					}),
				},
			});
			const parsed = makeParsed();
			const options: ResolveOptions = { env: { VERBOSE: input } };

			const result = await resolve(schema, parsed, options);
			expect(result.flags).toEqual({ verbose: expected });
		});
	}

	it('throws ValidationError for invalid boolean env value', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					envVar: 'VERBOSE',
					presence: 'defaulted',
					defaultValue: false,
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { VERBOSE: 'maybe' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('TYPE_MISMATCH');
				expect(err.suggest).toBe('Set VERBOSE to true/false, 1/0, or yes/no');
			}
		}
	});
});

// ========================================================================
// Env resolution — enum coercion
// ========================================================================

describe('resolve — env enum flags', () => {
	it('resolves valid enum value from env', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', { envVar: 'REGION', enumValues: ['us', 'eu', 'ap'] }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { REGION: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('throws ValidationError for invalid enum env value', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', { envVar: 'REGION', enumValues: ['us', 'eu', 'ap'] }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { REGION: 'jp' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('INVALID_ENUM');
				expect(err.details).toEqual({
					flag: 'region',
					envVar: 'REGION',
					value: 'jp',
					allowed: ['us', 'eu', 'ap'],
				});
				expect(err.suggest).toBe('Set REGION to one of: us, eu, ap');
			}
		}
	});
});

// ========================================================================
// Env resolution — array coercion
// ========================================================================

describe('resolve — env array flags', () => {
	it('resolves comma-separated env value to string array', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { envVar: 'TAGS' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { TAGS: 'v1,v2,v3' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ tags: ['v1', 'v2', 'v3'] });
	});

	it('resolves empty env string to empty array', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { envVar: 'TAGS' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { TAGS: '' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ tags: [] });
	});

	it('resolves single-element env array', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { envVar: 'TAGS' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { TAGS: 'only-one' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ tags: ['only-one'] });
	});

	it('coerces array elements via element schema (number)', async () => {
		const schema = makeSchema({
			flags: {
				ports: createSchema('array', {
					envVar: 'PORTS',
					elementSchema: createSchema('number'),
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORTS: '8080,9090,3000' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ ports: [8080, 9090, 3000] });
	});

	it('throws for invalid array element value', async () => {
		const schema = makeSchema({
			flags: {
				ports: createSchema('array', {
					envVar: 'PORTS',
					elementSchema: createSchema('number'),
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORTS: '8080,bad,3000' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('TYPE_MISMATCH');
			}
		}
	});
});

// ========================================================================
// Env resolution — required flag satisfaction
// ========================================================================

describe('resolve — env satisfies required flags', () => {
	it('env value satisfies required flag', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required', envVar: 'TOKEN' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { TOKEN: 'secret123' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ token: 'secret123' });
	});

	it('still throws when required flag has envVar but env is not set', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required', envVar: 'TOKEN' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: {} };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Env resolution — no options provided (backward compat)
// ========================================================================

describe('resolve — no env options (backward compatibility)', () => {
	it('works without options (v0.1 behavior)', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
			},
		});
		const parsed = makeParsed();

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ port: 3000 });
	});

	it('works with empty options', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
			},
		});
		const parsed = makeParsed();

		const result = await resolve(schema, parsed, {});
		expect(result.flags).toEqual({ port: 3000 });
	});

	it('works with no env key in options', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
			},
		});
		const parsed = makeParsed();

		// No `env` key at all — exercises the `options?.env ?? {}` path
		const options: ResolveOptions = {};
		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ port: 3000 });
	});
});

// ========================================================================
// Env resolution — precedence chain: CLI > env > default
// ========================================================================

describe('resolve — full precedence chain', () => {
	it('CLI > env > default: CLI wins', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed({ flags: { region: 'ap' } });
		const options: ResolveOptions = { env: { REGION: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'ap' });
	});

	it('CLI > env > default: env wins when CLI absent', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { REGION: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('CLI > env > default: default wins when both CLI and env absent', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: {} };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});
});

// ========================================================================
// Env resolution — error aggregation with env
// ========================================================================

describe('resolve — env error aggregation', () => {
	it('aggregates env coercion error with missing required error', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT' }),
				token: createSchema('string', { presence: 'required' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: 'bad' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.message).toContain('Multiple validation errors');
				const details = err.details as { errors: unknown[]; count: number };
				expect(details.count).toBe(2);
			}
		}
	});
});

// ========================================================================
// Env resolution — mixed scenarios
// ========================================================================

describe('resolve — env custom flags', () => {
	it('resolves custom flag from env via parseFn', async () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					envVar: 'HEX_VALUE',
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { HEX_VALUE: 'ff' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags.hex).toBe(255);
	});

	it('env custom flag parse failure produces validation error', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('custom', {
					envVar: 'PORT',
					parseFn: (raw: unknown) => {
						const n = Number(raw);
						if (Number.isNaN(n)) throw new Error('Not a number');
						return n;
					},
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: 'abc' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('TYPE_MISMATCH');
				expect(err.message).toContain('Failed to parse env PORT');
			}
		}
	});

	it('custom flag without parseFn passes raw env string through', async () => {
		const schema = makeSchema({
			flags: {
				value: createSchema('custom', { envVar: 'VALUE' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { VALUE: 'hello' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags.value).toBe('hello');
	});
});

describe('resolve — mixed env scenarios', () => {
	it('resolves complex multi-flag command with mixed sources', async () => {
		const schema = makeSchema({
			flags: {
				host: createSchema('string', {
					envVar: 'HOST',
					presence: 'defaulted',
					defaultValue: 'localhost',
				}),
				port: createSchema('number', { envVar: 'PORT' }),
				verbose: createSchema('boolean', {
					envVar: 'VERBOSE',
					presence: 'defaulted',
					defaultValue: false,
				}),
				region: createSchema('enum', {
					envVar: 'REGION',
					enumValues: ['us', 'eu', 'ap'],
				}),
				tags: createSchema('array', { envVar: 'TAGS' }),
				output: createSchema('string'), // no env, optional
			},
		});
		const parsed = makeParsed({ flags: { host: '0.0.0.0' } }); // CLI overrides host
		const options: ResolveOptions = {
			env: {
				PORT: '9090',
				VERBOSE: 'true',
				REGION: 'ap',
				TAGS: 'a,b',
			},
		};

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({
			host: '0.0.0.0', // CLI
			port: 9090, // env (coerced)
			verbose: true, // env (coerced)
			region: 'ap', // env
			tags: ['a', 'b'], // env (split)
			output: undefined, // optional, no source
		});
	});
});
