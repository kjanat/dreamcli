/**
 * The positional tail: how a variadic arg collects its tokens, how a `-` among
 * them splices the stdin buffer, and how an aggregation failure names the source
 * that carried the offending element.
 *
 * @module dreamcli/core/resolve/resolve-arg-tail.test
 */

import { describe, expect, it } from 'vitest';
import { isValidationError } from '#internals/core/errors/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg, createArgSchema } from '#internals/core/schema/arg.ts';
import { command, createCommandSchema } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { ResolveOptions } from './index.ts';
import { resolve } from './index.ts';

// --- helpers

/** Resolve one positional against the given argv and sources. */
async function resolveArg(
	builder: ArgBuilder<ArgConfig>,
	argv: readonly string[],
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.arg('files', builder)
		.action(() => {}).schema;
	const result = await resolve(schema, parse(schema, argv), options);
	return result.args.files;
}

/** Resolve one flag against the given argv and sources. */
async function resolveFlag(
	builder: FlagBuilder<FlagConfig>,
	argv: readonly string[],
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.flag('value', builder)
		.action(() => {}).schema;
	const result = await resolve(schema, parse(schema, argv), options);
	return result.flags.value;
}

/** Run a resolution expected to fail, returning the message it reported. */
async function resolutionError(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (error) {
		if (isValidationError(error)) return error.message;
		throw error;
	}
	throw new Error('expected resolution to fail');
}

// === a `-` among the tail tokens

describe('a variadic arg reads stdin from its tail', () => {
	it('splices the buffer at the position the dash holds', async () => {
		expect(
			await resolveArg(arg.string().variadic().stdin(), ['before', '-', 'after'], {
				stdinData: 'a\nb\n',
			}),
		).toEqual(['before', 'a', 'b', 'after']);
	});

	it('splices at the front and the back', async () => {
		const files = arg.string().variadic().stdin({ when: 'dash' });
		expect(await resolveArg(files, ['-', 'last'], { stdinData: 'a\n' })).toEqual(['a', 'last']);
		expect(await resolveArg(files, ['first', '-'], { stdinData: 'a\n' })).toEqual(['first', 'a']);
	});

	it('splices the buffer once per dash', async () => {
		expect(
			await resolveArg(arg.string().variadic().stdin(), ['-', '-'], { stdinData: 'a\nb\n' }),
		).toEqual(['a', 'b', 'a', 'b']);
	});

	it('decodes each spliced element through the element value axis', async () => {
		expect(
			await resolveArg(arg.number().variadic().stdin(), ['1', '-'], { stdinData: '2\n3\n' }),
		).toEqual([1, 2, 3]);
	});

	it('reads the whole buffer when the tail is empty and the binding covers missing', async () => {
		expect(await resolveArg(arg.string().variadic().stdin(), [], { stdinData: 'a\nb\n' })).toEqual([
			'a',
			'b',
		]);
	});

	it('decodes the same elements the explicit dash would', async () => {
		const files = arg.string().variadic().stdin();
		expect(await resolveArg(files, ['-'], { stdinData: 'a\nb\n' })).toEqual(
			await resolveArg(files, [], { stdinData: 'a\nb\n' }),
		);
	});

	it('keeps CLI tokens when the binding only covers missing', async () => {
		expect(
			await resolveArg(arg.string().variadic().stdin({ when: 'missing' }), ['a', '-'], {
				stdinData: 'piped\n',
			}),
		).toEqual(['a', '-']);
	});

	it('reads the stdin split policy of the arg', async () => {
		expect(
			await resolveArg(arg.string().variadic().stdin().split({ stdin: ',' }), ['-'], {
				stdinData: 'a,b',
			}),
		).toEqual(['a', 'b']);
	});

	it('aggregates a variadic keyValue tail across CLI and stdin', async () => {
		expect(
			await resolveArg(arg.keyValue().variadic().stdin(), ['A=1', '-'], { stdinData: 'B=2\n' }),
		).toEqual({ A: '1', B: '2' });
	});
});

// === both construction paths agree

describe('the definition path accepts the same tail bindings', () => {
	it('builds a variadic stdin arg', () => {
		const schema = createCommandSchema({
			name: 'run',
			args: [
				{ name: 'files', schema: { kind: 'string', variadic: true, stdin: { when: 'dash' } } },
			],
		});
		expect(schema.args[0]?.schema.stdin).toEqual({
			when: 'dash',
			consume: 'exclusive',
			trim: false,
		});
	});

	it('resolves a definition-built tail the way the builder-built one resolves', async () => {
		const definition = createCommandSchema({
			name: 'deploy',
			hasAction: true,
			args: [{ name: 'files', schema: { kind: 'string', variadic: true, stdin: {} } }],
		});
		const result = await resolve(definition, parse(definition, ['a', '-']), {
			stdinData: 'b\nc\n',
		});
		expect(result.args.files).toEqual(['a', 'b', 'c']);
	});

	it('rebuilds a deep-equal schema from a variadic stdin arg', () => {
		const built = createArgSchema('string', { variadic: true, stdin: { trim: true } });
		expect(createArgSchema(built)).toEqual(built);
	});
});

// === an explicit dash with nothing piped

describe("a '-' the user typed with nothing piped", () => {
	it('fails for a positional tail rather than dropping the token', async () => {
		const message = await resolutionError(() =>
			resolveArg(arg.string().variadic().stdin(), ['a', '-', 'b']),
		);
		expect(message).toBe("No piped stdin for the '-' occurrence of argument <files>");
	});

	it('falls through to a later source when the tail is nothing but dashes', async () => {
		expect(
			await resolveArg(arg.string().variadic().stdin().env('FILES'), ['-'], {
				env: { FILES: 'from-env' },
			}),
		).toEqual(['from-env']);
	});

	it('suggests piping or dropping the token', async () => {
		try {
			await resolveArg(arg.keyValue().variadic().stdin(), ['A=1', '-']);
		} catch (error) {
			expect(isValidationError(error) && error.suggest).toBe(
				"Pipe a value to stdin, or drop the '-' from <files>",
			);
			expect(isValidationError(error) && error.code).toBe('MISSING_STDIN');
			return;
		}
		throw new Error('expected resolution to fail');
	});
});

// === which source a duplicate key names

describe('a duplicate key names the source that carried it', () => {
	it('names no source for keys the user typed on a flag', async () => {
		expect(
			await resolutionError(() =>
				resolveFlag(flag.keyValue().duplicateKeys('error'), ['--value', 'A=1', '--value', 'A=2']),
			),
		).toBe("Duplicate key 'A' for flag --value");
	});

	it('names no source for keys the user typed in a positional tail', async () => {
		expect(
			await resolutionError(() =>
				resolveArg(arg.keyValue().variadic().duplicateKeys('error'), ['A=1', 'A=2']),
			),
		).toBe("Duplicate key 'A' for argument <files>");
	});

	it('names stdin for a key the buffer spliced in', async () => {
		expect(
			await resolutionError(() =>
				resolveFlag(
					flag.keyValue().stdin().duplicateKeys('error'),
					['--value', 'A=1', '--value', '-'],
					{
						stdinData: 'A=2\n',
					},
				),
			),
		).toBe("Duplicate key '<redacted>' from stdin for flag --value");
	});

	it('names stdin for a spliced key in a positional tail', async () => {
		expect(
			await resolutionError(() =>
				resolveArg(arg.keyValue().variadic().stdin().duplicateKeys('error'), ['A=1', '-'], {
					stdinData: 'A=2\n',
				}),
			),
		).toBe("Duplicate key '<redacted>' from stdin for argument <files>");
	});

	it('names the typed token when it is the one that repeats', async () => {
		expect(
			await resolutionError(() =>
				resolveFlag(
					flag.keyValue().stdin().duplicateKeys('error'),
					['--value', '-', '--value', 'A=2'],
					{
						stdinData: 'A=1\n',
					},
				),
			),
		).toBe("Duplicate key 'A' for flag --value");
	});

	it('keeps naming env for a value the environment carried', async () => {
		expect(
			await resolutionError(() =>
				resolveFlag(flag.keyValue().duplicateKeys('error').env('VARS'), [], {
					env: { VARS: 'A=1,A=2' },
				}),
			),
		).toBe("Duplicate key '<redacted>' from env VARS for flag --value");
	});
});
