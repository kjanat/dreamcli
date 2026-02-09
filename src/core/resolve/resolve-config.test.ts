import { describe, expect, it } from 'vitest';
import { isValidationError, ValidationError } from '../errors/index.js';
import type { ParseResult } from '../parse/index.js';
import type { CommandSchema } from '../schema/command.js';
import { createSchema } from '../schema/flag.js';
import type { ResolveOptions } from './index.js';
import { resolve } from './index.js';

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
// Config resolution — basic string flags
// ========================================================================

describe('resolve — config string flags', () => {
	it('resolves string flag from config when CLI and env absent', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', { configPath: 'deploy.region' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { deploy: { region: 'eu' } } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('resolves string flag from top-level config path', async () => {
		const schema = makeSchema({
			flags: {
				name: createSchema('string', { configPath: 'name' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { name: 'test-app' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ name: 'test-app' });
	});

	it('resolves deeply nested config path', async () => {
		const schema = makeSchema({
			flags: {
				host: createSchema('string', { configPath: 'server.database.host' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = {
			config: { server: { database: { host: 'db.example.com' } } },
		};

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ host: 'db.example.com' });
	});

	it('coerces number to string from config', async () => {
		const schema = makeSchema({
			flags: {
				label: createSchema('string', { configPath: 'label' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { label: 42 } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ label: '42' });
	});

	it('coerces boolean to string from config', async () => {
		const schema = makeSchema({
			flags: {
				label: createSchema('string', { configPath: 'label' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { label: true } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ label: 'true' });
	});

	it('throws for non-coercible string config value', async () => {
		const schema = makeSchema({
			flags: {
				label: createSchema('string', { configPath: 'label' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { label: [1, 2, 3] } };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Config resolution — number flags
// ========================================================================

describe('resolve — config number flags', () => {
	it('resolves number directly from config', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { configPath: 'server.port' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { server: { port: 8080 } } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ port: 8080 });
	});

	it('coerces numeric string from config', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { configPath: 'port' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { port: '9090' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ port: 9090 });
	});

	it('resolves float number from config', async () => {
		const schema = makeSchema({
			flags: {
				threshold: createSchema('number', { configPath: 'threshold' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { threshold: 0.75 } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ threshold: 0.75 });
	});

	it('throws for non-numeric config value', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { configPath: 'port' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { port: 'not-a-number' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('TYPE_MISMATCH');
				expect(err.details).toEqual({
					flag: 'port',
					configPath: 'port',
					value: 'not-a-number',
					expected: 'number',
				});
				expect(err.suggest).toBe('Set port to a valid number in your config');
			}
		}
	});

	it('throws for boolean config value when number expected', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { configPath: 'port' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { port: true } };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Config resolution — boolean flags
// ========================================================================

describe('resolve — config boolean flags', () => {
	it('resolves boolean true directly from config', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					configPath: 'verbose',
					presence: 'defaulted',
					defaultValue: false,
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { verbose: true } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ verbose: true });
	});

	it('resolves boolean false directly from config', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					configPath: 'verbose',
					presence: 'defaulted',
					defaultValue: true,
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { verbose: false } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ verbose: false });
	});

	it('coerces string "true" from config to boolean', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					configPath: 'verbose',
					presence: 'defaulted',
					defaultValue: false,
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { verbose: 'yes' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ verbose: true });
	});

	it('throws for invalid boolean config value', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					configPath: 'verbose',
					presence: 'defaulted',
					defaultValue: false,
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { verbose: 'maybe' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('TYPE_MISMATCH');
				expect(err.suggest).toBe('Set verbose to true or false in your config');
			}
		}
	});

	it('throws for number config value when boolean expected', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					configPath: 'verbose',
					presence: 'defaulted',
					defaultValue: false,
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { verbose: 42 } };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Config resolution — enum flags
// ========================================================================

describe('resolve — config enum flags', () => {
	it('resolves valid enum value from config', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					configPath: 'deploy.region',
					enumValues: ['us', 'eu', 'ap'],
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { deploy: { region: 'eu' } } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('throws for invalid enum config value', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					configPath: 'deploy.region',
					enumValues: ['us', 'eu', 'ap'],
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { deploy: { region: 'jp' } } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('INVALID_ENUM');
				expect(err.details).toEqual({
					flag: 'region',
					configPath: 'deploy.region',
					value: 'jp',
					allowed: ['us', 'eu', 'ap'],
				});
				expect(err.suggest).toBe('Set deploy.region to one of: us, eu, ap');
			}
		}
	});

	it('throws for non-string enum config value', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					configPath: 'region',
					enumValues: ['us', 'eu', 'ap'],
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { region: 123 } };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Config resolution — array flags
// ========================================================================

describe('resolve — config array flags', () => {
	it('resolves array directly from config', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { configPath: 'tags' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { tags: ['v1', 'v2', 'v3'] } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ tags: ['v1', 'v2', 'v3'] });
	});

	it('resolves empty array from config', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { configPath: 'tags' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { tags: [] } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ tags: [] });
	});

	it('resolves comma-separated string as array from config', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { configPath: 'tags' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { tags: 'a,b,c' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ tags: ['a', 'b', 'c'] });
	});

	it('resolves empty string as empty array from config', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { configPath: 'tags' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { tags: '' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ tags: [] });
	});

	it('coerces array elements via element schema (number)', async () => {
		const schema = makeSchema({
			flags: {
				ports: createSchema('array', {
					configPath: 'ports',
					elementSchema: createSchema('number'),
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { ports: [8080, 9090, 3000] } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ ports: [8080, 9090, 3000] });
	});

	it('throws for invalid array element in config', async () => {
		const schema = makeSchema({
			flags: {
				ports: createSchema('array', {
					configPath: 'ports',
					elementSchema: createSchema('number'),
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { ports: [8080, 'bad', 3000] } };

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

	it('throws for non-array non-string config value', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { configPath: 'tags' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { tags: 42 } };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Config resolution — config path missing / absent
// ========================================================================

describe('resolve — config path navigation', () => {
	it('falls through when config path does not exist', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: {} };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('falls through when intermediate path segment is missing', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { deploy: {} } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('falls through when intermediate is a non-object', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { deploy: 'not-an-object' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('falls through when intermediate is null', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { deploy: null } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('ignores config when flag has no configPath declared', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', { presence: 'defaulted', defaultValue: 'us' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { region: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});
});

// ========================================================================
// Config resolution — required flag satisfaction
// ========================================================================

describe('resolve — config satisfies required flags', () => {
	it('config value satisfies required flag', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required', configPath: 'auth.token' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { auth: { token: 'secret123' } } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ token: 'secret123' });
	});

	it('still throws when required flag has configPath but config value absent', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required', configPath: 'auth.token' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: {} };

		await expect(resolve(schema, parsed, options)).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Config resolution — precedence chain: CLI > env > config > default
// ========================================================================

describe('resolve — full precedence chain with config', () => {
	it('CLI > env > config > default: CLI wins', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed({ flags: { region: 'cli-value' } });
		const options: ResolveOptions = {
			env: { REGION: 'env-value' },
			config: { deploy: { region: 'config-value' } },
		};

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'cli-value' });
	});

	it('CLI > env > config > default: env wins when CLI absent', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = {
			env: { REGION: 'env-value' },
			config: { deploy: { region: 'config-value' } },
		};

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'env-value' });
	});

	it('CLI > env > config > default: config wins when CLI and env absent', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = {
			env: {},
			config: { deploy: { region: 'config-value' } },
		};

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'config-value' });
	});

	it('CLI > env > config > default: default wins when all absent', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					envVar: 'REGION',
					configPath: 'deploy.region',
					presence: 'defaulted',
					defaultValue: 'us',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: {}, config: {} };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'us' });
	});
});

// ========================================================================
// Config resolution — backward compatibility
// ========================================================================

describe('resolve — no config options (backward compatibility)', () => {
	it('works without config in options', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
			},
		});
		const parsed = makeParsed();

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ port: 3000 });
	});

	it('works with empty config', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: {} };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ port: 3000 });
	});

	it('env resolution still works alongside config', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT', configPath: 'port' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: '8080' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ port: 8080 });
	});
});

// ========================================================================
// Config resolution — error aggregation
// ========================================================================

describe('resolve — config error aggregation', () => {
	it('aggregates config coercion error with missing required error', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { configPath: 'port' }),
				token: createSchema('string', { presence: 'required' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { config: { port: 'bad' } };

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

	it('aggregates env and config errors together', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT' }),
				region: createSchema('enum', {
					configPath: 'region',
					enumValues: ['us', 'eu'],
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = {
			env: { PORT: 'bad' },
			config: { region: 'invalid' },
		};

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
// Config resolution — mixed scenarios
// ========================================================================

describe('resolve — mixed config scenarios', () => {
	it('resolves complex multi-flag command with mixed sources including config', async () => {
		const schema = makeSchema({
			flags: {
				host: createSchema('string', {
					envVar: 'HOST',
					configPath: 'server.host',
					presence: 'defaulted',
					defaultValue: 'localhost',
				}),
				port: createSchema('number', { configPath: 'server.port' }),
				verbose: createSchema('boolean', {
					configPath: 'verbose',
					presence: 'defaulted',
					defaultValue: false,
				}),
				region: createSchema('enum', {
					envVar: 'REGION',
					configPath: 'deploy.region',
					enumValues: ['us', 'eu', 'ap'],
				}),
				tags: createSchema('array', { configPath: 'tags' }),
				output: createSchema('string'), // no env, no config, optional
			},
		});
		const parsed = makeParsed({ flags: { host: '0.0.0.0' } }); // CLI overrides host
		const options: ResolveOptions = {
			env: { REGION: 'ap' },
			config: {
				server: { host: 'config-host', port: 9090 },
				verbose: true,
				deploy: { region: 'eu' },
				tags: ['a', 'b'],
			},
		};

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({
			host: '0.0.0.0', // CLI
			port: 9090, // config (number directly)
			verbose: true, // config (boolean directly)
			region: 'ap', // env (beats config)
			tags: ['a', 'b'], // config (array directly)
			output: undefined, // optional, no source
		});
	});

	it('config with both env and config declared — env takes precedence', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', {
					envVar: 'PORT',
					configPath: 'port',
				}),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = {
			env: { PORT: '3000' },
			config: { port: 9090 },
		};

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ port: 3000 }); // env wins
	});
});
