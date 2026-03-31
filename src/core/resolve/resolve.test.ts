import { describe, expect, it } from 'vitest';
import { isValidationError, ValidationError } from '#internals/core/errors/index.ts';
import type { ParseResult } from '#internals/core/parse/index.ts';
import { createArgSchema } from '#internals/core/schema/arg.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { createSchema } from '#internals/core/schema/flag.ts';
import { resolve } from './index.ts';

// ---------------------------------------------------------------------------
// Helpers — build minimal schemas and parse results
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
// Flag resolution
// ========================================================================

describe('resolve — flags', () => {
	// -- CLI value passthrough -----------------------------------------------

	it('passes through CLI-provided flag values', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number'),
				host: createSchema('string'),
			},
		});
		const parsed = makeParsed({ flags: { port: 8080, host: 'localhost' } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ port: 8080, host: 'localhost' });
	});

	it('passes through boolean flag set to true', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
			},
		});
		const parsed = makeParsed({ flags: { verbose: true } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ verbose: true });
	});

	it('passes through enum flag value', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', { enumValues: ['us', 'eu', 'ap'] }),
			},
		});
		const parsed = makeParsed({ flags: { region: 'eu' } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('passes through array flag values', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array'),
			},
		});
		const parsed = makeParsed({ flags: { tags: ['v1', 'v2'] } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ tags: ['v1', 'v2'] });
	});

	// -- Default values -----------------------------------------------------

	it('applies schema default when flag not provided', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ port: 3000 });
	});

	it('applies boolean default (false) when not provided', async () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ verbose: false });
	});

	it('applies string default when not provided', async () => {
		const schema = makeSchema({
			flags: {
				format: createSchema('string', { presence: 'defaulted', defaultValue: 'json' }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ format: 'json' });
	});

	it('applies enum default when not provided', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					presence: 'defaulted',
					defaultValue: 'us',
					enumValues: ['us', 'eu'],
				}),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('CLI value takes precedence over default', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
			},
		});
		const parsed = makeParsed({ flags: { port: 9090 } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ port: 9090 });
	});

	// -- Array flag defaults -------------------------------------------------

	it('array flag defaults to empty array when not provided', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array'),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ tags: [] });
	});

	it('array flag uses explicit default when not provided', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', { presence: 'defaulted', defaultValue: ['default'] }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ tags: ['default'] });
	});

	// -- Optional flags (no default, not required) --------------------------

	it('optional flag resolves to undefined when not provided', async () => {
		const schema = makeSchema({
			flags: {
				output: createSchema('string'), // default presence: 'optional'
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ output: undefined });
	});

	it('optional flag key exists in result even when undefined', async () => {
		const schema = makeSchema({
			flags: {
				output: createSchema('string'),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect('output' in result.flags).toBe(true);
	});

	// -- Required flags (validation) ----------------------------------------

	it('throws ValidationError for missing required flag', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required' }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		await expect(resolve(schema, parsed)).rejects.toThrow(ValidationError);
	});

	it('required flag error has REQUIRED_FLAG code', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required' }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('REQUIRED_FLAG');
				expect(err.details).toEqual({ flag: 'token', kind: 'string' });
				expect(err.suggest).toBe('Provide --token <value>');
			}
		}
	});

	it('required boolean flag suggest omits <value>', async () => {
		const schema = makeSchema({
			flags: {
				confirm: createSchema('boolean', { presence: 'required' }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				expect(err.suggest).toBe('Provide --confirm');
			}
		}
	});

	it('aggregates multiple missing required flags', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required' }),
				region: createSchema('enum', {
					presence: 'required',
					enumValues: ['us', 'eu'],
				}),
			},
		});
		const parsed = makeParsed({ flags: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				expect(err.message).toContain('Multiple validation errors');
				expect(err.message).toContain('--token');
				expect(err.message).toContain('--region');
				const details = err.details as { errors: unknown[]; count: number };
				expect(details.count).toBe(2);
				expect(details.errors).toHaveLength(2);
			}
		}
	});

	it('required flag passes when CLI provides value', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required' }),
			},
		});
		const parsed = makeParsed({ flags: { token: 'abc123' } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ token: 'abc123' });
	});

	// -- Mixed flag scenarios ------------------------------------------------

	it('resolves mix of provided, defaulted, optional, and required flags', async () => {
		const schema = makeSchema({
			flags: {
				host: createSchema('string', { presence: 'defaulted', defaultValue: 'localhost' }),
				port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }),
				verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
				output: createSchema('string'), // optional
			},
		});
		const parsed = makeParsed({ flags: { port: 8080, verbose: true } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({
			host: 'localhost',
			port: 8080,
			verbose: true,
			output: undefined,
		});
	});
});

// ========================================================================
// Custom flag resolution
// ========================================================================

describe('resolve — custom flags', () => {
	it('passes through CLI-provided custom flag value', async () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
				}),
			},
		});
		// Parser already called parseFn, so parsed value is the result
		const parsed = makeParsed({ flags: { hex: 255 } });

		const result = await resolve(schema, parsed);
		expect(result.flags.hex).toBe(255);
	});

	it('applies default for optional custom flag when not provided', async () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
					presence: 'defaulted',
					defaultValue: 0,
				}),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags.hex).toBe(0);
	});

	it('required custom flag throws when not provided', async () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
					presence: 'required',
				}),
			},
		});
		const parsed = makeParsed({ flags: {} });

		await expect(resolve(schema, parsed)).rejects.toThrow(ValidationError);
	});

	it('optional custom flag resolves to undefined when not provided', async () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
				}),
			},
		});
		const parsed = makeParsed({ flags: {} });

		const result = await resolve(schema, parsed);
		expect(result.flags.hex).toBeUndefined();
	});
});

// ========================================================================
// Arg resolution
// ========================================================================

describe('resolve — args', () => {
	// -- CLI value passthrough -----------------------------------------------

	it('passes through CLI-provided arg values', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		const parsed = makeParsed({ args: { target: 'production' } });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ target: 'production' });
	});

	it('passes through number arg value', async () => {
		const schema = makeSchema({
			args: [{ name: 'count', schema: createArgSchema('number') }],
		});
		const parsed = makeParsed({ args: { count: 42 } });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ count: 42 });
	});

	// -- Default values -----------------------------------------------------

	it('applies schema default when arg not provided', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'env',
					schema: createArgSchema('string', { presence: 'defaulted', defaultValue: 'dev' }),
				},
			],
		});
		const parsed = makeParsed({ args: {} });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ env: 'dev' });
	});

	it('CLI value takes precedence over default', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'env',
					schema: createArgSchema('string', { presence: 'defaulted', defaultValue: 'dev' }),
				},
			],
		});
		const parsed = makeParsed({ args: { env: 'staging' } });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ env: 'staging' });
	});

	// -- Optional args ------------------------------------------------------

	it('optional arg resolves to undefined when not provided', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'output',
					schema: createArgSchema('string', { presence: 'optional' }),
				},
			],
		});
		const parsed = makeParsed({ args: {} });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ output: undefined });
	});

	// -- Required args (validation) -----------------------------------------

	it('throws ValidationError for missing required arg', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		const parsed = makeParsed({ args: {} });

		await expect(resolve(schema, parsed)).rejects.toThrow(ValidationError);
	});

	it('required arg error has REQUIRED_ARG code', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		const parsed = makeParsed({ args: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('REQUIRED_ARG');
				expect(err.details).toEqual({ arg: 'target' });
				expect(err.suggest).toBe('Provide a value for <target>');
			}
		}
	});

	it('mentions stdin for missing required stdin-backed args', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string', { stdinMode: true }) }],
		});
		const parsed = makeParsed({ args: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('REQUIRED_ARG');
				expect(err.suggest).toBe(
					"Provide a value for <target> or pipe a value to stdin or pass '-'",
				);
			}
		}
	});

	it('aggregates multiple missing required args', async () => {
		const schema = makeSchema({
			args: [
				{ name: 'source', schema: createArgSchema('string') },
				{ name: 'dest', schema: createArgSchema('string') },
			],
		});
		const parsed = makeParsed({ args: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				expect(err.message).toContain('Multiple validation errors');
				expect(err.message).toContain('<source>');
				expect(err.message).toContain('<dest>');
			}
		}
	});

	// -- Variadic args ------------------------------------------------------

	it('variadic arg with values passes through', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'files',
					schema: createArgSchema('string', { variadic: true }),
				},
			],
		});
		const parsed = makeParsed({ args: { files: ['a.ts', 'b.ts'] } });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ files: ['a.ts', 'b.ts'] });
	});

	it('optional variadic arg defaults to empty array when not provided', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'files',
					schema: createArgSchema('string', { variadic: true, presence: 'optional' }),
				},
			],
		});
		const parsed = makeParsed({ args: {} });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ files: [] });
	});

	it('required variadic arg with empty array throws', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'files',
					schema: createArgSchema('string', { variadic: true, presence: 'required' }),
				},
			],
		});
		const parsed = makeParsed({ args: { files: [] } });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				expect(err.code).toBe('REQUIRED_ARG');
				expect(err.details).toEqual({ arg: 'files', variadic: true });
				expect(err.suggest).toBe('Provide at least one value for <files>');
			}
		}
	});

	it('required variadic arg not present throws', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'files',
					schema: createArgSchema('string', { variadic: true, presence: 'required' }),
				},
			],
		});
		const parsed = makeParsed({ args: {} });

		await expect(resolve(schema, parsed)).rejects.toThrow(ValidationError);
	});

	it('optional variadic arg with empty array resolves to empty array', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'files',
					schema: createArgSchema('string', { variadic: true, presence: 'optional' }),
				},
			],
		});
		const parsed = makeParsed({ args: { files: [] } });

		const result = await resolve(schema, parsed);
		expect(result.args).toEqual({ files: [] });
	});
});

// ========================================================================
// Combined flag + arg resolution
// ========================================================================

describe('resolve — combined', () => {
	it('resolves both flags and args together', async () => {
		const schema = makeSchema({
			flags: {
				force: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
				region: createSchema('enum', {
					presence: 'defaulted',
					defaultValue: 'us',
					enumValues: ['us', 'eu'],
				}),
			},
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		const parsed = makeParsed({
			flags: { force: true },
			args: { target: 'production' },
		});

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ force: true, region: 'us' });
		expect(result.args).toEqual({ target: 'production' });
	});

	it('throws for missing required flag but not missing optional arg', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required' }),
			},
			args: [
				{
					name: 'output',
					schema: createArgSchema('string', { presence: 'optional' }),
				},
			],
		});
		const parsed = makeParsed({ flags: {}, args: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				expect(err.code).toBe('REQUIRED_FLAG');
			}
		}
	});

	it('empty schema with empty parsed produces empty result', async () => {
		const schema = makeSchema();
		const parsed = makeParsed();

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({});
		expect(result.args).toEqual({});
	});

	it('result objects are readonly (frozen shape)', async () => {
		const schema = makeSchema({
			flags: { port: createSchema('number', { presence: 'defaulted', defaultValue: 3000 }) },
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		const parsed = makeParsed({
			flags: {},
			args: { target: 'prod' },
		});

		const result = await resolve(schema, parsed);
		// Verify the shape is correct — the Readonly<> type annotation
		// prevents mutation at the type level
		expect(result.flags.port).toBe(3000);
		expect(result.args.target).toBe('prod');
	});
});

// ========================================================================
// Error details
// ========================================================================

describe('resolve — error details', () => {
	it('single missing flag throws directly (not aggregated)', async () => {
		const schema = makeSchema({
			flags: { token: createSchema('string', { presence: 'required' }) },
		});
		const parsed = makeParsed({ flags: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				// Single error — message is direct, not "Multiple validation errors"
				expect(err.message).toBe('Missing required flag --token');
				expect(err.exitCode).toBe(2);
			}
		}
	});

	it('validation error has exit code 2', async () => {
		const schema = makeSchema({
			args: [{ name: 'file', schema: createArgSchema('string') }],
		});
		const parsed = makeParsed({ args: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				expect(err.exitCode).toBe(2);
			}
		}
	});

	it('aggregated error includes all individual errors in details', async () => {
		const schema = makeSchema({
			flags: {
				a: createSchema('string', { presence: 'required' }),
				b: createSchema('number', { presence: 'required' }),
				c: createSchema('string', { presence: 'required' }),
			},
		});
		const parsed = makeParsed({ flags: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				const details = err.details as { errors: unknown[]; count: number };
				expect(details.count).toBe(3);
				expect(details.errors).toHaveLength(3);
			}
		}
	});

	it('mixed flag + arg required errors are thrown from their respective phases', async () => {
		// Flag errors throw first (flag resolution runs before arg resolution)
		const schema = makeSchema({
			flags: { token: createSchema('string', { presence: 'required' }) },
			args: [{ name: 'file', schema: createArgSchema('string') }],
		});
		const parsed = makeParsed({ flags: {}, args: {} });

		try {
			await resolve(schema, parsed);
			expect.unreachable('should have thrown');
		} catch (err) {
			if (isValidationError(err)) {
				// Flag errors throw first — arg errors aren't reached
				expect(err.code).toBe('REQUIRED_FLAG');
			}
		}
	});
});

// ========================================================================
// Deprecation warnings
// ========================================================================

describe('resolve — deprecation warnings', () => {
	// --- Flags ---------------------------------------------------------------

	it('collects structured deprecation when deprecated flag is provided via CLI', async () => {
		const schema = makeSchema({
			flags: { old: createSchema('string', { deprecated: true }) },
		});
		const parsed = makeParsed({ flags: { old: 'value' } });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(1);
		expect(result.deprecations[0]).toEqual({ kind: 'flag', name: 'old', message: true });
	});

	it('includes deprecation message in structured warning', async () => {
		const schema = makeSchema({
			flags: { old: createSchema('string', { deprecated: 'use --new instead' }) },
		});
		const parsed = makeParsed({ flags: { old: 'value' } });
		const result = await resolve(schema, parsed);
		expect(result.deprecations[0]).toEqual({
			kind: 'flag',
			name: 'old',
			message: 'use --new instead',
		});
	});

	it('no deprecation when deprecated flag is not provided', async () => {
		const schema = makeSchema({
			flags: { old: createSchema('string', { deprecated: true }) },
		});
		const parsed = makeParsed({ flags: {} });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(0);
	});

	it('no deprecation for non-deprecated flag', async () => {
		const schema = makeSchema({
			flags: { active: createSchema('string') },
		});
		const parsed = makeParsed({ flags: { active: 'value' } });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(0);
	});

	it('collects deprecation when deprecated flag is resolved from env', async () => {
		const schema = makeSchema({
			flags: { old: createSchema('string', { deprecated: true, envVar: 'OLD_VAR' }) },
		});
		const parsed = makeParsed({ flags: {} });
		const result = await resolve(schema, parsed, { env: { OLD_VAR: 'value' } });
		expect(result.deprecations).toHaveLength(1);
		expect(result.deprecations[0]).toEqual({ kind: 'flag', name: 'old', message: true });
	});

	it('collects deprecation when deprecated flag is resolved from config', async () => {
		const schema = makeSchema({
			flags: { old: createSchema('string', { deprecated: true, configPath: 'old' }) },
		});
		const parsed = makeParsed({ flags: {} });
		const result = await resolve(schema, parsed, { config: { old: 'value' } });
		expect(result.deprecations).toHaveLength(1);
		expect(result.deprecations[0]).toEqual({ kind: 'flag', name: 'old', message: true });
	});

	it('no deprecation when deprecated flag falls through to default', async () => {
		const schema = makeSchema({
			flags: {
				old: createSchema('string', { deprecated: true, presence: 'defaulted', defaultValue: 'x' }),
			},
		});
		const parsed = makeParsed({ flags: {} });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(0);
	});

	// --- Args ----------------------------------------------------------------

	it('collects structured deprecation when deprecated arg is provided', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string', { deprecated: true }) }],
		});
		const parsed = makeParsed({ args: { target: 'prod' } });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(1);
		expect(result.deprecations[0]).toEqual({ kind: 'arg', name: 'target', message: true });
	});

	it('includes deprecation message in arg structured warning', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', { deprecated: 'use --target flag' }),
				},
			],
		});
		const parsed = makeParsed({ args: { target: 'prod' } });
		const result = await resolve(schema, parsed);
		expect(result.deprecations[0]).toEqual({
			kind: 'arg',
			name: 'target',
			message: 'use --target flag',
		});
	});

	it('no deprecation when deprecated arg is not provided', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', { deprecated: true, presence: 'optional' }),
				},
			],
		});
		const parsed = makeParsed({ args: {} });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(0);
	});

	// --- Multiple deprecations -----------------------------------------------

	it('collects deprecations for multiple deprecated flags', async () => {
		const schema = makeSchema({
			flags: {
				old1: createSchema('string', { deprecated: true }),
				old2: createSchema('number', { deprecated: 'removed in v2' }),
			},
		});
		const parsed = makeParsed({ flags: { old1: 'a', old2: 42 } });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(2);
		expect(result.deprecations[0]).toEqual({ kind: 'flag', name: 'old1', message: true });
		expect(result.deprecations[1]).toEqual({
			kind: 'flag',
			name: 'old2',
			message: 'removed in v2',
		});
	});

	it('collects deprecations for both deprecated flag and arg', async () => {
		const schema = makeSchema({
			flags: { old: createSchema('string', { deprecated: true }) },
			args: [{ name: 'target', schema: createArgSchema('string', { deprecated: true }) }],
		});
		const parsed = makeParsed({ flags: { old: 'x' }, args: { target: 'prod' } });
		const result = await resolve(schema, parsed);
		expect(result.deprecations).toHaveLength(2);
	});

	// --- Deprecations don't block resolution ---------------------------------

	it('deprecated flag still resolves its value', async () => {
		const schema = makeSchema({
			flags: { old: createSchema('string', { deprecated: true }) },
		});
		const parsed = makeParsed({ flags: { old: 'value' } });
		const result = await resolve(schema, parsed);
		expect(result.flags['old']).toBe('value');
	});

	it('deprecated arg still resolves its value', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string', { deprecated: true }) }],
		});
		const parsed = makeParsed({ args: { target: 'prod' } });
		const result = await resolve(schema, parsed);
		expect(result.args['target']).toBe('prod');
	});
});
