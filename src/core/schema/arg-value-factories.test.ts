/**
 * `arg.url()`, `arg.path()`, `arg.date()`, `arg.duration()`, `arg.bytes()` and
 * string constraints on args.
 *
 * Covers the builder schema, `InferArg` across presence/variadic/stdin, and
 * enforcement from argv, env, and stdin. Message parity against the flag
 * factory lives in `factory-parity.test.ts`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { parse } from '#internals/core/parse/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { ArgBuilder, ArgConfig, InferArg } from './arg.ts';
import { arg, createArgSchema } from './arg.ts';
import { command } from './command.ts';

/** Build a single-arg command and parse `argv` against it. */
function parseCommandArg(builder: ArgBuilder<ArgConfig>, argv: readonly string[]) {
	const schema = command('run')
		.arg('x', builder)
		.action(() => {}).schema;
	return { schema, parsed: parse(schema, argv) };
}

// === builder schema

describe('arg sugar factories — builder schema', () => {
	it('arg.url() is a custom-kind arg with a parse function and hint', () => {
		const a = arg.url();
		expect(a.schema.kind).toBe('custom');
		expect(a.schema.valueHint).toBe('url');
		expect(a.schema.parseFn).toBeTypeOf('function');
		expect(a.schema.presence).toBe('required');
	});

	it('arg.date() / arg.duration() / arg.bytes() carry their own hints', () => {
		expect(arg.date().schema.valueHint).toBe('date');
		expect(arg.duration().schema.valueHint).toBe('duration');
		expect(arg.bytes().schema.valueHint).toBe('size');
	});

	it('arg.path() is a string-kind arg with the path hint', () => {
		const a = arg.path();
		expect(a.schema.kind).toBe('string');
		expect(a.schema.valueHint).toBe('path');
		expect(a.schema.pathChecks).toBeUndefined();
	});

	it('arg.path() normalizes options into pathChecks', () => {
		expect(arg.path({ mustExist: true }).schema.pathChecks).toEqual({
			mustExist: true,
			type: undefined,
			create: false,
		});
		expect(arg.path({ type: 'file' }).schema.pathChecks).toEqual({
			mustExist: true,
			type: 'file',
			create: false,
		});
		expect(arg.path({ mustExist: false, type: 'directory' }).schema.pathChecks).toEqual({
			mustExist: false,
			type: 'directory',
			create: false,
		});
		expect(arg.path({ type: 'directory', create: true }).schema.pathChecks).toEqual({
			mustExist: true,
			type: 'directory',
			create: true,
		});
	});

	it('arg.path() leaves pathChecks undefined when nothing is asked for', () => {
		expect(arg.path({}).schema.pathChecks).toBeUndefined();
		expect(arg.path({ mustExist: false }).schema.pathChecks).toBeUndefined();
	});

	it('rejects create without type: directory at the type level', () => {
		// @ts-expect-error — create is only available with type: 'directory'
		arg.path({ create: true });
		// @ts-expect-error — create is only available with type: 'directory'
		arg.path({ type: 'file', create: true });
	});

	it('.nonEmpty() chains onto a path arg and preserves pathChecks', () => {
		const a = arg.path({ type: 'file' }).nonEmpty();
		expect(a.schema.pathChecks).toEqual({ mustExist: true, type: 'file', create: false });
		expect(a.schema.stringConstraints).toEqual({ nonEmpty: true });
	});
});

// === type inference

describe('arg sugar factories — type inference', () => {
	it('infers the base value type for each kind', () => {
		expectTypeOf<InferArg<ReturnType<typeof arg.url>>>().toEqualTypeOf<URL>();
		expectTypeOf<InferArg<ReturnType<typeof arg.path>>>().toEqualTypeOf<string>();
		expectTypeOf<InferArg<ReturnType<typeof arg.date>>>().toEqualTypeOf<Date>();
		expectTypeOf<InferArg<ReturnType<typeof arg.duration>>>().toEqualTypeOf<number>();
		expectTypeOf<InferArg<ReturnType<typeof arg.bytes>>>().toEqualTypeOf<number>();
	});

	it('widens to undefined when optional', () => {
		const url = arg.url().optional();
		const path = arg.path().optional();
		const date = arg.date().optional();
		const duration = arg.duration().optional();
		const bytes = arg.bytes().optional();
		expectTypeOf<InferArg<typeof url>>().toEqualTypeOf<URL | undefined>();
		expectTypeOf<InferArg<typeof path>>().toEqualTypeOf<string | undefined>();
		expectTypeOf<InferArg<typeof date>>().toEqualTypeOf<Date | undefined>();
		expectTypeOf<InferArg<typeof duration>>().toEqualTypeOf<number | undefined>();
		expectTypeOf<InferArg<typeof bytes>>().toEqualTypeOf<number | undefined>();
	});

	it('stays non-nullable when required or defaulted', () => {
		const required = arg.url().required();
		const defaulted = arg.duration().default(30_000);
		expectTypeOf<InferArg<typeof required>>().toEqualTypeOf<URL>();
		expectTypeOf<InferArg<typeof defaulted>>().toEqualTypeOf<number>();
	});

	it('produces an array when variadic, in either chain order', () => {
		const urls = arg.url().variadic();
		const optionalPaths = arg.path().variadic().optional();
		const bytesFirst = arg.bytes().optional().variadic();
		expectTypeOf<InferArg<typeof urls>>().toEqualTypeOf<URL[]>();
		expectTypeOf<InferArg<typeof optionalPaths>>().toEqualTypeOf<string[]>();
		expectTypeOf<InferArg<typeof bytesFirst>>().toEqualTypeOf<number[]>();
	});

	it('leaves the value type untouched by .stdin() and .env()', () => {
		const piped = arg.url().stdin();
		const fromEnv = arg.date().env('SINCE').optional();
		expectTypeOf<InferArg<typeof piped>>().toEqualTypeOf<URL>();
		expectTypeOf<InferArg<typeof fromEnv>>().toEqualTypeOf<Date | undefined>();
	});

	it('keeps string constraints from changing the value type', () => {
		const constrained = arg.string({ nonEmpty: true }).minLength(2).pattern(/^a/);
		expectTypeOf<InferArg<typeof constrained>>().toEqualTypeOf<string>();
	});

	it('gates string constraint methods to string-kind args', () => {
		// @ts-expect-error — .nonEmpty() is not available on number args
		expect(() => arg.number().nonEmpty()).toThrow(/requires kind 'string'/);
		// @ts-expect-error — .minLength() is not available on enum args
		expect(() => arg.enum(['a', 'b']).minLength(1)).toThrow(/requires kind 'string'/);
		// @ts-expect-error — .maxLength() is not available on custom args
		expect(() => arg.url().maxLength(2)).toThrow(/requires kind 'string'/);
		// @ts-expect-error — .pattern() is not available on date args
		expect(() => arg.date().pattern(/^a/)).toThrow(/requires kind 'string'/);
	});

	it('gates numeric constraint methods away from the new string kinds', () => {
		// @ts-expect-error — .min() is not available on path args
		expect(() => arg.path().min(1)).toThrow(/requires kind 'number'/);
	});
});

// === schema boundary

describe('createArgSchema — new fields', () => {
	it('rejects stringConstraints on a non-string kind', () => {
		// @ts-expect-error stringConstraints requires kind 'string'
		expect(() => createArgSchema('number', { stringConstraints: { nonEmpty: true } })).toThrow(
			/requires kind 'string'/,
		);
	});

	it('rejects pathChecks on a non-string kind', () => {
		expect(() =>
			createArgSchema('custom', {
				// @ts-expect-error pathChecks requires kind 'string'
				pathChecks: { mustExist: true, type: undefined, create: false },
			}),
		).toThrow(/requires kind 'string'/);
	});

	it('accepts valueHint on every kind', () => {
		expect(createArgSchema('custom', { valueHint: 'url' }).valueHint).toBe('url');
		expect(createArgSchema('number', { valueHint: 'port' }).valueHint).toBe('port');
	});

	it('rebuilds a deep-equal schema from a constrained string arg', () => {
		const built = createArgSchema('string', {
			stringConstraints: { nonEmpty: true, minLength: 2, pattern: /^a/ },
			pathChecks: { mustExist: true, type: 'file', create: false },
			valueHint: 'path',
		});
		expect(createArgSchema(built)).toEqual(built);
	});

	it('rebuilds a deep-equal schema from every sugar factory', () => {
		for (const builder of [arg.url(), arg.path({ type: 'file' }), arg.date(), arg.bytes()]) {
			expect(createArgSchema(builder.schema)).toEqual(builder.schema);
		}
	});

	it('validates options at declaration time', () => {
		expect(() => arg.string({ minLength: -1 })).toThrow(RangeError);
		expect(() => arg.string({ minLength: 5, maxLength: 2 })).toThrow(RangeError);
		expect(() => arg.string().minLength(5).maxLength(2)).toThrow(RangeError);
	});

	it('accepts a sugar kind that is both variadic and stdin-backed, in either chain order', () => {
		expect(
			command('c').arg('x', arg.url().variadic().stdin()).schema.args[0]?.schema,
		).toMatchObject({ variadic: true, stdin: { when: 'dash-or-missing' } });
		expect(
			command('c').arg('x', arg.path().stdin().variadic()).schema.args[0]?.schema,
		).toMatchObject({ variadic: true, stdin: { when: 'dash-or-missing' } });
	});
});

// === enforcement — argv

describe('arg constraints from argv', () => {
	it('accepts a satisfying value', async () => {
		let received: unknown;
		const cmd = command('deploy')
			.arg('token', arg.string({ nonEmpty: true, minLength: 5, pattern: /^ghp_/ }))
			.action(({ args }) => {
				received = args.token;
			});

		const result = await runCommand(cmd, ['ghp_valid']);
		expect(result.exitCode).toBe(0);
		expect(received).toBe('ghp_valid');
	});

	it('rejects a violation with INVALID_VALUE and the arg subject', async () => {
		const cmd = command('deploy')
			.arg('token', arg.string().pattern(/^ghp_/))
			.action(() => {});

		const result = await runCommand(cmd, ['abc']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toBe(
			"Invalid value 'abc' for argument <token>: must match /^ghp_/",
		);
	});

	it('checks every value of a variadic constrained arg', async () => {
		const cmd = command('tag')
			.arg('names', arg.string().minLength(2).variadic())
			.action(() => {});

		const result = await runCommand(cmd, ['ok', 'x']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toBe(
			"Invalid value 'x' for argument <names>: must be at least 2 characters",
		);
	});

	it('parses a variadic url arg into a URL array', async () => {
		let received: unknown;
		const cmd = command('fetch')
			.arg('targets', arg.url().variadic())
			.action(({ args }) => {
				received = args.targets;
			});

		const result = await runCommand(cmd, ['https://a.test/', 'https://b.test/']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual([new URL('https://a.test/'), new URL('https://b.test/')]);
	});

	it('rejects one bad entry in a variadic url arg', async () => {
		const cmd = command('fetch')
			.arg('targets', arg.url().variadic())
			.action(() => {});

		const result = await runCommand(cmd, ['https://a.test/', 'nope']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toBe(
			"Failed to parse argument <targets> value 'nope': Invalid URL",
		);
	});
});

// === enforcement — env

describe('arg constraints from env', () => {
	it('accepts a satisfying env value', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().minLength(3).env('TOKEN'), []);
		const result = await resolve(schema, parsed, { env: { TOKEN: 'abcd' } });
		expect(result.args).toEqual({ x: 'abcd' });
	});

	it('rejects an env violation as CONSTRAINT_VIOLATED with the value visible', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().minLength(5).env('TOKEN'), []);

		await expect(resolve(schema, parsed, { env: { TOKEN: 'abc' } })).rejects.toMatchObject({
			code: 'CONSTRAINT_VIOLATED',
			message: "Invalid value 'abc' from env TOKEN for argument <x>: must be at least 5 characters",
			details: {
				arg: 'x',
				envVar: 'TOKEN',
				value: 'abc',
				expected: 'string',
				constraint: 'minLength',
				bound: 5,
			},
			suggest: 'Set TOKEN to a valid string',
		});
	});

	it('keeps the complete reason after a colon-bearing value', async () => {
		const { schema, parsed } = parseCommandArg(
			arg
				.string()
				.pattern(/^https?:\/\//)
				.env('URL'),
			[],
		);

		await expect(resolve(schema, parsed, { env: { URL: 'ftp://x' } })).rejects.toMatchObject({
			code: 'CONSTRAINT_VIOLATED',
			message: "Invalid value 'ftp://x' from env URL for argument <x>: must match /^https?:\\/\\//",
		});
	});

	it('parses an env value through a sugar factory', async () => {
		const { schema, parsed } = parseCommandArg(arg.duration().env('TIMEOUT'), []);
		const result = await resolve(schema, parsed, { env: { TIMEOUT: '1h30m' } });
		expect(result.args).toEqual({ x: 5_400_000 });
	});
});

// === enforcement — stdin

describe('arg constraints from stdin', () => {
	it('validates a piped url value', async () => {
		const { schema, parsed } = parseCommandArg(arg.url().stdin(), []);
		const result = await resolve(schema, parsed, { stdinData: 'https://piped.test/api' });
		expect(result.args).toEqual({ x: new URL('https://piped.test/api') });
	});

	it('rejects a malformed piped url', async () => {
		const { schema, parsed } = parseCommandArg(arg.url().stdin(), []);

		// A parse-function failure outside argv is TYPE_MISMATCH on both surfaces.
		await expect(resolve(schema, parsed, { stdinData: 'nope' })).rejects.toMatchObject({
			code: 'TYPE_MISMATCH',
			message: "Failed to parse stdin for argument <x> value 'nope': Invalid URL",
		});
	});

	it('enforces string constraints on a piped value', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().nonEmpty().stdin(), []);

		await expect(resolve(schema, parsed, { stdinData: '' })).rejects.toMatchObject({
			code: 'CONSTRAINT_VIOLATED',
			message: "Invalid value '' from stdin for argument <x>: must not be empty",
			suggest: 'Pipe a valid string to stdin for <x>',
		});
	});

	it('parses a piped duration', async () => {
		const { schema, parsed } = parseCommandArg(arg.duration().stdin(), []);
		const result = await resolve(schema, parsed, { stdinData: '250ms' });
		expect(result.args).toEqual({ x: 250 });
	});
});
