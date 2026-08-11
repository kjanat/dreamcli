/**
 * The projection a caller-built {@link ParseResult} enters resolution through.
 *
 * `testkit`, `executeCommand()`, and `readFlags()` all accept a parse result
 * nobody parsed, so the aggregation path has to read a value the parser never
 * produced: an array of occurrences, or an aggregate already folded by hand.
 *
 * @module dreamcli/core/resolve/resolve-hand-built.test
 */

import { describe, expect, it } from 'vitest';
import type { ParseResult } from '#internals/core/parse/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { ResolveOptions } from './index.ts';
import { resolve } from './index.ts';

/** Resolve one flag from a parse result no parser produced. */
async function resolveGivenFlag(
	builder: FlagBuilder<FlagConfig>,
	value: unknown,
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.flag('value', builder)
		.action(() => {}).schema;
	const parsed: ParseResult = { flags: { value }, args: {} };
	const result = await resolve(schema, parsed, options);
	return result.flags.value;
}

/** Resolve one positional from a parse result no parser produced. */
async function resolveGivenArg(
	builder: ArgBuilder<ArgConfig>,
	value: unknown,
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.arg('value', builder)
		.action(() => {}).schema;
	const parsed: ParseResult = { flags: {}, args: { value } };
	const result = await resolve(schema, parsed, options);
	return result.args.value;
}

// === caller-built occurrence lists

describe('a caller-built list of occurrences', () => {
	it('aggregates a many flag element by element', async () => {
		await expect(resolveGivenFlag(flag.array(flag.string()), ['a', 'b'])).resolves.toEqual([
			'a',
			'b',
		]);
	});

	it('deduplicates a unique many flag', async () => {
		await expect(
			resolveGivenFlag(flag.array(flag.string()).unique(), ['a', 'b', 'a']),
		).resolves.toEqual(['a', 'b']);
	});

	it('folds an entries flag given ordered pairs', async () => {
		await expect(
			resolveGivenFlag(flag.keyValue(), [
				['A', '1'],
				['B', '2'],
			]),
		).resolves.toEqual({ A: '1', B: '2' });
	});

	it('applies the duplicate-key policy to those pairs', async () => {
		await expect(
			resolveGivenFlag(flag.keyValue().duplicateKeys('first'), [
				['A', '1'],
				['A', '2'],
			]),
		).resolves.toEqual({ A: '1' });
		await expect(
			resolveGivenFlag(flag.keyValue(), [
				['A', '1'],
				['A', '2'],
			]),
		).resolves.toEqual({ A: '2' });
	});

	it('rejects an element of an entries flag that is not a pair', async () => {
		await expect(
			resolveGivenFlag(flag.keyValue(), [['A', '1'], 'junk', ['B', '2']]),
		).rejects.toMatchObject({
			code: 'TYPE_MISMATCH',
			message: 'Invalid object value for flag --value',
			details: { flag: 'value', source: 'cli', expected: 'object' },
			suggest: 'Provide KEY=VALUE pairs for --value',
		});
	});

	it('rejects a non-pair argument occurrence as CLI input', async () => {
		await expect(resolveGivenArg(arg.keyValue(), [['A', '1'], 'junk'])).rejects.toMatchObject({
			code: 'TYPE_MISMATCH',
			message: 'Invalid object value for argument <value>',
			details: { arg: 'value', source: 'cli', expected: 'object' },
			suggest: 'Provide KEY=VALUE pairs for <value>',
		});
	});

	it('keeps a pair-shaped element of a many flag whole', async () => {
		await expect(resolveGivenFlag(flag.array(flag.string()), [['A', '1']])).resolves.toEqual([
			['A', '1'],
		]);
	});

	it('splices the stdin buffer into a dash it carries', async () => {
		await expect(
			resolveGivenFlag(flag.array(flag.string()).stdin(), ['before', '-', 'after'], {
				stdinData: 'a\nb\n',
			}),
		).resolves.toEqual(['before', 'a', 'b', 'after']);
	});

	it('keeps a dash literal when the flag never reads stdin', async () => {
		await expect(
			resolveGivenFlag(flag.array(flag.string()), ['before', '-', 'after'], {
				stdinData: 'a\nb\n',
			}),
		).resolves.toEqual(['before', '-', 'after']);
	});

	it('aggregates a variadic arg the same way', async () => {
		await expect(resolveGivenArg(arg.string().variadic(), ['a', 'b'])).resolves.toEqual(['a', 'b']);
	});

	it('folds a variadic keyValue arg given ordered pairs', async () => {
		await expect(
			resolveGivenArg(arg.keyValue().variadic(), [
				['A', '1'],
				['A', '2'],
			]),
		).resolves.toEqual({ A: '2' });
	});
});

// === caller-built aggregates

describe('a caller-built aggregate', () => {
	it('reaches the resolved value untouched for a many flag', async () => {
		await expect(resolveGivenFlag(flag.array(flag.string()), 'a,b')).resolves.toBe('a,b');
	});

	it('reaches the resolved value untouched for an entries flag', async () => {
		const given = { A: '1' };
		await expect(resolveGivenFlag(flag.keyValue(), given)).resolves.toEqual(given);
	});

	it('skips the stdin splice even when the value is the sentinel string', async () => {
		await expect(
			resolveGivenFlag(flag.array(flag.string()).stdin(), '-', { stdinData: 'a\nb\n' }),
		).resolves.toEqual(['a', 'b']);
	});

	it('reaches the resolved value untouched for a variadic arg', async () => {
		await expect(resolveGivenArg(arg.string().variadic(), 'a,b')).resolves.toBe('a,b');
	});

	it('reaches the resolved value untouched for a variadic keyValue arg', async () => {
		const given = { A: '1' };
		await expect(resolveGivenArg(arg.keyValue().variadic(), given)).resolves.toEqual(given);
	});
});
