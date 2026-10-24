/**
 * Tests for kebab↔camel flag-spelling parity.
 *
 * @module dreamcli/core/parse/parse-case-parity.test
 */

import { describe, expect, it } from 'vitest';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/index.ts';
import { camelToKebab, kebabToCamel, parse } from './index.ts';

function kebabCmd() {
	return command('run')
		.flag('dry-run', flag.boolean())
		.flag('max-retries', flag.number())
		.action(() => {});
}

function camelCmd() {
	return command('run')
		.flag('dryRun', flag.boolean())
		.flag('maxRetries', flag.number())
		.action(() => {});
}

describe('case conversion helpers', () => {
	it('kebabToCamel converts hyphenated names', () => {
		expect(kebabToCamel('do-this')).toBe('doThis');
		expect(kebabToCamel('max-retry-count')).toBe('maxRetryCount');
		expect(kebabToCamel('plain')).toBe('plain');
	});

	it('camelToKebab converts camelCase names', () => {
		expect(camelToKebab('doThis')).toBe('do-this');
		expect(camelToKebab('maxRetryCount')).toBe('max-retry-count');
		expect(camelToKebab('plain')).toBe('plain');
	});
});

describe('flag case parity', () => {
	it('accepts the camel spelling of a kebab flag by default', () => {
		const parsed = parse(kebabCmd().schema, ['--dryRun', '--maxRetries', '3']);
		expect(parsed.flags['dry-run']).toBe(true);
		expect(parsed.flags['max-retries']).toBe(3);
	});

	it('accepts the kebab spelling of a camel flag by default', () => {
		const parsed = parse(camelCmd().schema, ['--dry-run', '--max-retries=3']);
		expect(parsed.flags['dryRun']).toBe(true);
		expect(parsed.flags['maxRetries']).toBe(3);
	});

	it('stores values under the canonical name only', () => {
		const parsed = parse(kebabCmd().schema, ['--dryRun']);
		expect(Object.keys(parsed.flags)).toEqual(['dry-run']);
	});

	it('can be disabled via caseParity: false', () => {
		expect(() => parse(kebabCmd().schema, ['--dryRun'], { caseParity: false })).toThrow(
			/Unknown flag --dryRun/,
		);
		// Declared spelling still works.
		expect(parse(kebabCmd().schema, ['--dry-run'], { caseParity: false }).flags['dry-run']).toBe(
			true,
		);
	});

	it('auto-disables per pair when both spellings are declared', () => {
		const schema = command('run')
			.flag('do-this', flag.string())
			.flag('doThis', flag.string())
			.action(() => {}).schema;
		const parsed = parse(schema, ['--do-this', 'kebab', '--doThis', 'camel']);
		expect(parsed.flags['do-this']).toBe('kebab');
		expect(parsed.flags['doThis']).toBe('camel');
	});

	it('applies parity to long aliases', () => {
		const schema = command('run')
			.flag('force', flag.boolean().alias('hard-mode'))
			.action(() => {}).schema;
		expect(parse(schema, ['--hardMode']).flags['force']).toBe(true);
	});

	it('composes with negation', () => {
		const schema = command('run')
			.flag('dry-run', flag.boolean().negatable())
			.action(() => {}).schema;
		// Negated spelling 'no-dry-run' → parity counterpart 'noDryRun'.
		expect(parse(schema, ['--noDryRun']).flags['dry-run']).toBe(false);
		expect(parse(schema, ['--no-dry-run']).flags['dry-run']).toBe(false);
		expect(parse(schema, ['--no-dryRun']).flags['dry-run']).toBe(false);
	});

	it('negates a camel flag through its fully kebab spelling', () => {
		const schema = command('run')
			.flag('dryRun', flag.boolean().default(true).negatable())
			.action(() => {}).schema;
		expect(parse(schema, ['--no-dry-run']).flags['dryRun']).toBe(false);
		expect(parse(schema, ['--no-dryRun']).flags['dryRun']).toBe(false);
		expect(parse(schema, ['--noDryRun']).flags['dryRun']).toBe(false);
	});

	it('keeps a declared flag ahead of a synthesized negation counterpart', () => {
		const schema = command('run')
			.flag('dryRun', flag.boolean().negatable())
			.flag('no-dry-run', flag.string())
			.action(() => {}).schema;
		const parsed = parse(schema, ['--no-dry-run', 'x']);
		expect(parsed.flags['no-dry-run']).toBe('x');
		expect(parsed.flags['dryRun']).toBeUndefined();
	});

	it("keeps another flag's ordinary counterpart ahead of a negation counterpart", () => {
		for (const order of ['negatable first', 'negatable last'] as const) {
			const base = command('run');
			const withNegatable = (c: typeof base) => c.flag('dryRun', flag.boolean().negatable());
			const withOther = (c: typeof base) => c.flag('noDryRun', flag.string());
			const schema = (
				order === 'negatable first'
					? withOther(withNegatable(base))
					: withNegatable(withOther(base))
			).action(() => {}).schema;
			const parsed = parse(schema, ['--no-dry-run=abc']);
			expect(parsed.flags['noDryRun'], order).toBe('abc');
			expect(parsed.flags['dryRun'], order).toBeUndefined();
		}
	});

	it('adds no negation counterpart without case parity', () => {
		const schema = command('run')
			.flag('dryRun', flag.boolean().negatable())
			.action(() => {}).schema;
		expect(() => parse(schema, ['--no-dry-run'], { caseParity: false })).toThrow(/Unknown flag/);
	});

	it('composes with duplicates: both spellings are one logical flag', () => {
		const schema = command('run')
			.flag('max-retries', flag.number().duplicates('error'))
			.action(() => {}).schema;
		expect(() => parse(schema, ['--max-retries', '1', '--maxRetries', '2'])).toThrow(
			/--max-retries may only be specified once/,
		);
	});

	it('suggestions name the canonical spelling, not the parity counterpart', () => {
		try {
			parse(kebabCmd().schema, ['--dryRunn']);
			expect.unreachable('expected UNKNOWN_FLAG');
		} catch (error) {
			expect(error instanceof Error && error.message).toContain('--dry-run');
		}
	});

	it('does not invent spellings for single-word flags', () => {
		const schema = command('run')
			.flag('force', flag.boolean())
			.action(() => {}).schema;
		expect(() => parse(schema, ['--Force'])).toThrow(/Unknown flag/);
	});
});
