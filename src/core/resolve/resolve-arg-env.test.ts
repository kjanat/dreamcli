import { describe, expect, it } from 'vitest';
import { isValidationError, type ValidationError } from '../errors/index.ts';
import type { ParseResult } from '../parse/index.ts';
import { createArgSchema } from '../schema/arg.ts';
import type { CommandArgEntry, CommandSchema } from '../schema/command.ts';
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

function makeArgEntry(
	name: string,
	overrides: Partial<ReturnType<typeof createArgSchema>> = {},
): CommandArgEntry {
	return { name, schema: createArgSchema('string', overrides) };
}

// ========================================================================
// Arg env resolution — string args
// ========================================================================

describe('resolve — arg env string', () => {
	it('resolves string arg from env when CLI absent', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string', { envVar: 'DEPLOY_TARGET' }) }],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { DEPLOY_TARGET: 'production' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ target: 'production' });
	});

	it('CLI value wins over env', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string', { envVar: 'DEPLOY_TARGET' }) }],
		});
		const parsed = makeParsed({ args: { target: 'staging' } });
		const options: ResolveOptions = { env: { DEPLOY_TARGET: 'production' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ target: 'staging' });
	});

	it('env wins over default', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', {
						envVar: 'DEPLOY_TARGET',
						presence: 'defaulted',
						defaultValue: 'local',
					}),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { DEPLOY_TARGET: 'production' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ target: 'production' });
	});

	it('falls through to default when env var not set', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', {
						envVar: 'DEPLOY_TARGET',
						presence: 'defaulted',
						defaultValue: 'local',
					}),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: {} };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ target: 'local' });
	});

	it('satisfies required arg via env', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', { envVar: 'DEPLOY_TARGET', presence: 'required' }),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { DEPLOY_TARGET: 'production' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ target: 'production' });
	});

	it('errors on required arg when env not set', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', { envVar: 'DEPLOY_TARGET', presence: 'required' }),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: {} };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(isValidationError(e)).toBe(true);
			const err = e as ValidationError;
			expect(err.code).toBe('REQUIRED_ARG');
			expect(err.suggest).toBe('Provide a value for <target> or set DEPLOY_TARGET');
		}
	});
});

// ========================================================================
// Arg env resolution — number args
// ========================================================================

describe('resolve — arg env number', () => {
	it('coerces env string to number', async () => {
		const schema = makeSchema({
			args: [{ name: 'port', schema: createArgSchema('number', { envVar: 'PORT' }) }],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: '8080' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ port: 8080 });
	});

	it('errors on non-numeric env value for number arg', async () => {
		const schema = makeSchema({
			args: [{ name: 'port', schema: createArgSchema('number', { envVar: 'PORT' }) }],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { PORT: 'abc' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(isValidationError(e)).toBe(true);
			const err = e as ValidationError;
			expect(err.code).toBe('TYPE_MISMATCH');
			expect(err.details).toEqual({
				arg: 'port',
				envVar: 'PORT',
				value: 'abc',
				expected: 'number',
			});
			expect(err.suggest).toBe('Set PORT to a valid number');
		}
	});

	it('CLI numeric value wins over env', async () => {
		const schema = makeSchema({
			args: [{ name: 'port', schema: createArgSchema('number', { envVar: 'PORT' }) }],
		});
		const parsed = makeParsed({ args: { port: 3000 } });
		const options: ResolveOptions = { env: { PORT: '8080' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ port: 3000 });
	});
});

// ========================================================================
// Arg env resolution — custom args
// ========================================================================

describe('resolve — arg env custom', () => {
	it('coerces env string via custom parseFn', async () => {
		const parseFn = (raw: string) => raw.toUpperCase();
		const schema = makeSchema({
			args: [
				{
					name: 'mode',
					schema: createArgSchema('custom', { envVar: 'MODE', parseFn }),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { MODE: 'debug' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ mode: 'DEBUG' });
	});

	it('errors when custom parseFn throws', async () => {
		const parseFn = (raw: string): number => {
			const n = Number.parseInt(raw, 16);
			if (Number.isNaN(n)) throw new Error('invalid hex');
			return n;
		};
		const schema = makeSchema({
			args: [
				{
					name: 'color',
					schema: createArgSchema('custom', { envVar: 'COLOR', parseFn }),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { COLOR: 'zzz' } };

		try {
			await resolve(schema, parsed, options);
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(isValidationError(e)).toBe(true);
			const err = e as ValidationError;
			expect(err.code).toBe('TYPE_MISMATCH');
			expect(err.details).toEqual({
				arg: 'color',
				envVar: 'COLOR',
				value: 'zzz',
				expected: 'custom',
			});
		}
	});
});

// ========================================================================
// Arg env resolution — deprecation
// ========================================================================

describe('resolve — arg env deprecation', () => {
	it('emits deprecation warning when env resolves deprecated arg', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', {
						envVar: 'DEPLOY_TARGET',
						deprecated: 'use --target flag instead',
					}),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { DEPLOY_TARGET: 'prod' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ target: 'prod' });
		expect(result.deprecations).toEqual([
			{ kind: 'arg', name: 'target', message: 'use --target flag instead' },
		]);
	});

	it('no deprecation when env var not set', async () => {
		const schema = makeSchema({
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', {
						envVar: 'DEPLOY_TARGET',
						presence: 'optional',
						deprecated: 'use --target flag instead',
					}),
				},
			],
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: {} };

		const result = await resolve(schema, parsed, options);
		expect(result.deprecations).toEqual([]);
	});
});

// ========================================================================
// Arg env resolution — precedence chain
// ========================================================================

describe('resolve — arg env precedence', () => {
	it('CLI > env > default: full chain', async () => {
		const argSchema = createArgSchema('string', {
			envVar: 'MY_ARG',
			presence: 'defaulted',
			defaultValue: 'from-default',
		});
		const schema = makeSchema({ args: [{ name: 'val', schema: argSchema }] });

		// CLI wins
		const r1 = await resolve(schema, makeParsed({ args: { val: 'from-cli' } }), {
			env: { MY_ARG: 'from-env' },
		});
		expect(r1.args).toEqual({ val: 'from-cli' });

		// Env wins when CLI absent
		const r2 = await resolve(schema, makeParsed(), { env: { MY_ARG: 'from-env' } });
		expect(r2.args).toEqual({ val: 'from-env' });

		// Default when both absent
		const r3 = await resolve(schema, makeParsed(), { env: {} });
		expect(r3.args).toEqual({ val: 'from-default' });
	});

	it('ignores env for args without envVar configured', async () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string', { presence: 'optional' }) }],
		});
		const parsed = makeParsed();
		// Even with env vars set, they're not consulted
		const options: ResolveOptions = { env: { target: 'prod', TARGET: 'prod' } };

		const result = await resolve(schema, parsed, options);
		expect(result.args).toEqual({ target: undefined });
	});
});
