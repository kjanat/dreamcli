import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CLIError } from '#internals/core/errors/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { command } from './command.ts';
import { flag } from './flag.ts';

// === flag.array() — .separator() / .unique()

// --- Builder schema fields

describe('flag.array().separator() — builder schema', () => {
	it('defaults separator to undefined and unique to false', () => {
		const f = flag.array(flag.string());
		expect(f.schema.separator).toBeUndefined();
		expect(f.schema.unique).toBe(false);
	});

	it('stores the separator string on the schema', () => {
		const f = flag.array(flag.string()).separator(',');
		expect(f.schema.separator).toBe(',');
	});

	it('stores a multi-character separator', () => {
		const f = flag.array(flag.string()).separator('::');
		expect(f.schema.separator).toBe('::');
	});

	it('throws INVALID_SCHEMA for an empty separator', () => {
		expect(() => flag.array(flag.string()).separator('')).toThrow(
			expect.objectContaining<Partial<CLIError>>({ code: 'INVALID_SCHEMA' }),
		);
	});

	it('returns a new builder (immutable)', () => {
		const base = flag.array(flag.string());
		const withSep = base.separator(',');
		expect(base).not.toBe(withSep);
		expect(base.schema.separator).toBeUndefined();
		expect(withSep.schema.separator).toBe(',');
	});
});

describe('flag.array().unique() — builder schema', () => {
	it('sets unique to true when called with no argument', () => {
		const f = flag.array(flag.string()).unique();
		expect(f.schema.unique).toBe(true);
	});

	it('.unique(false) sets unique back to false', () => {
		const f = flag.array(flag.string()).unique().unique(false);
		expect(f.schema.unique).toBe(false);
	});

	it('returns a new builder (immutable)', () => {
		const base = flag.array(flag.string());
		const withUnique = base.unique();
		expect(base.schema.unique).toBe(false);
		expect(withUnique.schema.unique).toBe(true);
	});

	it('chains with .separator() preserving both fields', () => {
		const f = flag.array(flag.string()).separator(',').unique();
		expect(f.schema.separator).toBe(',');
		expect(f.schema.unique).toBe(true);
	});
});

// --- CLI splitting

describe('.separator() — CLI splitting', () => {
	it('splits each occurrence and accumulates across occurrences', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).separator(','))
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, ['--tag', 'a,b', '--tag', 'c']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a', 'b', 'c']);
	});

	it('names the offending element in enum errors — not the whole token', async () => {
		const cmd = command('deploy')
			.flag('region', flag.array(flag.enum(['us', 'eu', 'ap'])).separator(','))
			.action(() => {});

		const result = await runCommand(cmd, ['--region', 'us,mars']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toContain("'mars'");
		expect(result.error?.message).not.toContain("'us,mars'");
	});

	it('supports a multi-character separator', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).separator('::'))
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, ['--tag', 'a::b', '--tag', 'c']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a', 'b', 'c']);
	});

	it('drops empty segments', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).separator(','))
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, ['--tag', 'a,,b']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a', 'b']);
	});

	it('keeps the raw token as one element when no separator is configured', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()))
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, ['--tag', 'a,b']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a,b']);
	});
});

// --- Dedup — .unique()

describe('.unique() — dedup preserving first-seen order', () => {
	it('dedups across separator segments and occurrences', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).separator(',').unique())
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, ['--tag', 'b,a', '--tag', 'a,c', '--tag', 'b']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['b', 'a', 'c']);
	});

	it('dedups repeated occurrences without a separator', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).unique())
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, ['--tag', 'a', '--tag', 'a', '--tag', 'b']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a', 'b']);
	});

	it('dedups env-sourced values', async () => {
		let received: unknown;
		const cmd = command('deploy')
			.flag(
				'region',
				flag
					.array(flag.enum(['us', 'eu', 'ap']))
					.env('REGIONS')
					.unique(),
			)
			.action(({ flags }) => {
				received = flags.region;
			});

		const result = await runCommand(cmd, [], { env: { REGIONS: 'us,eu,us' } });
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['us', 'eu']);
	});

	it('dedups a real array from config', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).config('tags').unique())
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, [], { config: { tags: ['a', 'b', 'a', 'c', 'b'] } });
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a', 'b', 'c']);
	});
});

// --- Env resolution — separator interaction

describe('env values — separator handling', () => {
	it('splits env strings on the configured env delimiter', async () => {
		let received: unknown;
		const cmd = command('deploy')
			.flag(
				'region',
				flag
					.array(flag.enum(['us', 'eu', 'ap']))
					.split({ cli: '|', env: '|' })
					.env('REGIONS'),
			)
			.action(({ flags }) => {
				received = flags.region;
			});

		const result = await runCommand(cmd, [], { env: { REGIONS: 'us|eu|us' } });
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['us', 'eu', 'us']);
	});

	it('leaves env splitting on commas when only the CLI separator is set', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).separator('|').env('TAGS'))
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, [], { env: { TAGS: 'a,b' } });
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a', 'b']);
	});

	it('splits env strings on the default comma when no separator is configured', async () => {
		let received: unknown;
		const cmd = command('tags')
			.flag('tag', flag.array(flag.string()).env('TAGS'))
			.action(({ flags }) => {
				received = flags.tag;
			});

		const result = await runCommand(cmd, [], { env: { TAGS: 'a,b,c' } });
		expect(result.exitCode).toBe(0);
		expect(received).toEqual(['a', 'b', 'c']);
	});
});

// --- Type-level — array-only modifiers

describe('type inference — .separator()/.unique() are array-kind only', () => {
	it('flag.string() does not satisfy the this-parameter of .separator()', () => {
		const s = flag.string();
		expectTypeOf(s).not.toExtend<ThisParameterType<typeof s.separator>>();
	});

	it('flag.string() does not satisfy the this-parameter of .unique()', () => {
		const s = flag.string();
		expectTypeOf(s).not.toExtend<ThisParameterType<typeof s.unique>>();
	});

	it('flag.array() satisfies the this-parameter of both modifiers', () => {
		const a = flag.array(flag.string());
		expectTypeOf(a).toExtend<ThisParameterType<typeof a.separator>>();
		expectTypeOf(a).toExtend<ThisParameterType<typeof a.unique>>();
	});
});
