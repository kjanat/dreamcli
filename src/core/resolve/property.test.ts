import { describe, expect, it } from 'vitest';
import { createArgSchema } from '#internals/core/schema/arg.ts';
import { createSchema } from '#internals/core/schema/flag.ts';
import {
	sharedPropertyModelContract,
	toSharedArgPropertySchema,
	toSharedFlagPropertySchema,
} from './property.ts';

// === resolver shared property model

describe('resolver shared property model', () => {
	// --- contract

	describe('contract', () => {
		it('keeps the shared seam coercion-only', () => {
			expect(sharedPropertyModelContract).toEqual({
				scope: 'coercion',
				sharedKinds: ['string', 'number', 'enum', 'custom'],
				keepsFlagAndArgPrecedenceSeparate: true,
				keepsFallbackRulesSeparate: true,
				keepsRequiredValueRulesSeparate: true,
			});
		});
	});

	// --- schema adapters

	describe('schema adapters', () => {
		it('keeps flag-only kinds outside the shared model', () => {
			expect(toSharedFlagPropertySchema(createSchema('boolean'))).toBeUndefined();
			expect(toSharedFlagPropertySchema(createSchema('array'))).toBeUndefined();
		});

		it('preserves shared enum metadata for flag coercion', () => {
			expect(
				toSharedFlagPropertySchema(
					createSchema('enum', {
						enumValues: ['dev', 'prod'],
					}),
				),
			).toEqual({
				kind: 'enum',
				enumValues: ['dev', 'prod'],
			});
		});

		it('wraps arg custom parsers for unknown-friendly shared coercion', () => {
			const shared = toSharedArgPropertySchema(
				createArgSchema('custom', {
					parseFn: (raw) => `[${raw}]`,
				}),
			);

			expect(shared.kind).toBe('custom');
			if (shared.kind === 'custom') {
				expect(shared.parseFn?.(42)).toBe('[42]');
			}
		});
	});
});
