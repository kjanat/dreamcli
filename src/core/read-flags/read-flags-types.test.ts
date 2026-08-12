/**
 * readFlags() compile-time inference: one resolved property per definition key,
 * carrying the value type and presence its builder declares.
 */

import { describe, expectTypeOf, it } from 'vitest';
import { flag } from '#internals/core/schema/flag.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import { readFlags } from './index.ts';

/** Minimal hand-rolled Standard Schema validator, no external dependency. */
const numberSchema: StandardSchemaV1<unknown, number> = {
	'~standard': { version: 1, vendor: 'test', validate: (value) => ({ value: Number(value) }) },
};

const empty = { argv: [], env: {} } as const;

// === Value types per builder kind

describe('readFlags() value types', () => {
	it('infers one property per definition key', async () => {
		const values = await readFlags({ name: flag.string(), port: flag.number() }, empty);

		expectTypeOf(values).toEqualTypeOf<{
			readonly name: string | undefined;
			readonly port: number | undefined;
		}>();
		expectTypeOf<keyof typeof values>().toEqualTypeOf<'name' | 'port'>();
	});

	it('infers string, number, and boolean kinds', async () => {
		const values = await readFlags(
			{ name: flag.string(), port: flag.number(), watch: flag.boolean() },
			empty,
		);

		expectTypeOf(values.name).toEqualTypeOf<string | undefined>();
		expectTypeOf(values.port).toEqualTypeOf<number | undefined>();
		expectTypeOf(values.watch).toEqualTypeOf<boolean>();
	});

	it('infers enum literals', async () => {
		const values = await readFlags({ target: flag.enum(['node', 'browser']) }, empty);

		expectTypeOf(values.target).toEqualTypeOf<'node' | 'browser' | undefined>();
	});

	it('infers array elements', async () => {
		const values = await readFlags(
			{ tag: flag.array(flag.string()), sizes: flag.array(flag.number()) },
			empty,
		);

		expectTypeOf(values.tag).toEqualTypeOf<string[]>();
		expectTypeOf(values.sizes).toEqualTypeOf<number[]>();
	});

	it('infers count and key-value kinds', async () => {
		const values = await readFlags({ verbose: flag.count(), env: flag.keyValue() }, empty);

		expectTypeOf(values.verbose).toEqualTypeOf<number>();
		expectTypeOf(values.env).toEqualTypeOf<Record<string, string>>();
	});

	it('infers custom parse functions and Standard Schema outputs', async () => {
		const values = await readFlags(
			{
				hex: flag.custom((raw) => Number.parseInt(String(raw), 16)),
				pair: flag.custom((raw) => ({ host: String(raw), port: 0 })),
				checked: flag.custom(numberSchema),
			},
			empty,
		);

		expectTypeOf(values.hex).toEqualTypeOf<number | undefined>();
		expectTypeOf(values.pair).toEqualTypeOf<{ host: string; port: number } | undefined>();
		expectTypeOf(values.checked).toEqualTypeOf<number | undefined>();
	});

	it('infers the sugar factories', async () => {
		const values = await readFlags(
			{
				site: flag.url(),
				out: flag.path(),
				since: flag.date(),
				timeout: flag.duration(),
				limit: flag.bytes(),
			},
			empty,
		);

		expectTypeOf(values.site).toEqualTypeOf<URL | undefined>();
		expectTypeOf(values.out).toEqualTypeOf<string | undefined>();
		expectTypeOf(values.since).toEqualTypeOf<Date | undefined>();
		expectTypeOf(values.timeout).toEqualTypeOf<number | undefined>();
		expectTypeOf(values.limit).toEqualTypeOf<number | undefined>();
	});

	it('preserves non-identifier keys', async () => {
		const values = await readFlags({ 'dry-run': flag.boolean() }, empty);

		expectTypeOf(values['dry-run']).toEqualTypeOf<boolean>();
	});
});

// === Presence

describe('readFlags() presence', () => {
	it('keeps optional flags nullable', async () => {
		const values = await readFlags(
			{ name: flag.string(), target: flag.enum(['a', 'b']), hex: flag.custom(Number) },
			empty,
		);

		expectTypeOf(values.name).toEqualTypeOf<string | undefined>();
		expectTypeOf(values.target).toEqualTypeOf<'a' | 'b' | undefined>();
		expectTypeOf(values.hex).toEqualTypeOf<number | undefined>();
	});

	it('drops undefined for defaulted flags', async () => {
		const values = await readFlags(
			{
				name: flag.string().default('booga'),
				port: flag.number().default(8080),
				target: flag.enum(['a', 'b']).default('a'),
				tag: flag.array(flag.string()).default([]),
			},
			empty,
		);

		expectTypeOf(values.name).toEqualTypeOf<string>();
		expectTypeOf(values.port).toEqualTypeOf<number>();
		expectTypeOf(values.target).toEqualTypeOf<'a' | 'b'>();
		expectTypeOf(values.tag).toEqualTypeOf<string[]>();
	});

	it('drops undefined for required flags', async () => {
		const values = await readFlags(
			{
				name: flag.string().required(),
				target: flag.enum(['a', 'b']).required(),
				hex: flag.custom((raw) => String(raw)).required(),
			},
			{ argv: ['--name', 'booga', '--target', 'a', '--hex', 'ff'], env: {} },
		);

		expectTypeOf(values.name).toEqualTypeOf<string>();
		expectTypeOf(values.target).toEqualTypeOf<'a' | 'b'>();
		expectTypeOf(values.hex).toEqualTypeOf<string>();
	});

	it('keeps array and key-value fallbacks non-nullable', async () => {
		const values = await readFlags({ tag: flag.array(flag.string()), env: flag.keyValue() }, empty);

		expectTypeOf(values.tag).toEqualTypeOf<string[]>();
		expectTypeOf(values.env).toEqualTypeOf<Record<string, string>>();
	});

	it('preserves inference through chained modifiers', async () => {
		const values = await readFlags(
			{
				watch: flag.boolean().alias('w').env('WATCH').describe('Rebuild on change'),
				region: flag.enum(['us', 'eu']).env('REGION').config('deploy.region').deprecated(),
				minify: flag.boolean().default(true).negatable(),
			},
			empty,
		);

		expectTypeOf(values.watch).toEqualTypeOf<boolean>();
		expectTypeOf(values.region).toEqualTypeOf<'us' | 'eu' | undefined>();
		expectTypeOf(values.minify).toEqualTypeOf<boolean>();
	});
});

// === Call shape

describe('readFlags() call shape', () => {
	it('returns a promise of the resolved record', async () => {
		const pending = readFlags({ watch: flag.boolean() }, empty);

		expectTypeOf(pending).toEqualTypeOf<Promise<{ readonly watch: boolean }>>();
		await pending;
	});

	it('accepts a definition record with no options', () => {
		expectTypeOf(readFlags).toBeCallableWith({ watch: flag.boolean() });
	});
});
