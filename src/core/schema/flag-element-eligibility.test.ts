/**
 * Type-level tests for `flag.array()` element eligibility.
 *
 * Flag-level modifiers (`.alias()`, `.env()`, `.default()`, …) produce
 * settings an element schema never reads; the phantom `elementEligible`
 * marker makes passing such builders to `flag.array()` a compile error
 * instead of silently dropping them.
 *
 * @module dreamcli/core/schema/flag-element-eligibility.test
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { parse } from '#internals/core/parse/index.ts';
import { command } from './command.ts';
import { flag, type InferFlag } from './flag.ts';

describe('flag.array() element eligibility', () => {
	it('accepts pristine element builders of every element-meaningful kind', () => {
		flag.array(flag.string());
		flag.array(flag.number());
		flag.array(flag.boolean());
		flag.array(flag.enum(['us', 'eu', 'ap']));
		flag.array(flag.custom((raw) => String(raw)));
		flag.array(flag.url());
		flag.array(flag.date());
		flag.array(flag.duration());
		flag.array(flag.bytes());
		flag.array(flag.path());
	});

	it('accepts element builders with value constraints (still element-meaningful)', () => {
		flag.array(flag.number({ int: true, min: 0 }));
		flag.array(flag.number().int().min(0).max(10));
		flag.array(flag.string({ nonEmpty: true }));
		flag.array(
			flag
				.string()
				.nonEmpty()
				.minLength(2)
				.maxLength(8)
				.pattern(/^[a-z]+$/),
		);
	});

	it('rejects builders carrying flag-level settings elements would ignore', () => {
		// @ts-expect-error — element aliases are never read
		flag.array(flag.string().alias('s'));
		// @ts-expect-error — element env bindings are never read
		flag.array(flag.string().env('TAGS'));
		// @ts-expect-error — element config paths are never read
		flag.array(flag.string().config('deploy.tags'));
		// @ts-expect-error — element defaults are never read (default the array)
		flag.array(flag.string().default('x'));
		// @ts-expect-error — element requiredness is never read (require the array)
		flag.array(flag.string().required());
		// @ts-expect-error — element descriptions are never read (describe the array)
		flag.array(flag.string().describe('a tag'));
		// @ts-expect-error — element prompts are never read
		flag.array(flag.string().prompt({ kind: 'input', message: '?' }));
		// @ts-expect-error — element deprecation is never read
		flag.array(flag.string().deprecated('use --new'));
		// @ts-expect-error — element propagation is never read
		flag.array(flag.string().propagate());
		// @ts-expect-error — element negation is never read
		flag.array(flag.boolean().negatable());
		// @ts-expect-error — element duplicate policy is never read
		flag.array(flag.string().duplicates('error'));
	});

	it('rejects kinds that are not element-meaningful', () => {
		// @ts-expect-error — nested arrays are unsupported
		flag.array(flag.array(flag.string()));
		// @ts-expect-error — count accumulates occurrences, not values
		flag.array(flag.count());
		// @ts-expect-error — keyValue accumulates into a record, not an array
		flag.array(flag.keyValue());
	});

	it('flag-level modifiers still chain freely on the array itself', () => {
		const tags = flag
			.array(flag.enum(['api', 'web', 'git']))
			.separator(',')
			.unique()
			.default(['api'])
			.env('TAGS')
			.alias('t')
			.describe('Services to check');
		expectTypeOf<InferFlag<typeof tags>>().toEqualTypeOf<('api' | 'web' | 'git')[]>();
	});

	it('element constraints keep working end-to-end', () => {
		const schema = command('run')
			.flag('ports', flag.array(flag.number({ int: true, min: 1 })).separator(','))
			.action(() => {}).schema;
		expect(parse(schema, ['--ports', '80,443']).flags['ports']).toEqual([80, 443]);
		expect(() => parse(schema, ['--ports', '80,0'])).toThrow(/Invalid number value '0'/);
	});
});
