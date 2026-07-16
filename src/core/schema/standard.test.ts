import { describe, expect, expectTypeOf, it } from 'vitest';
import type { StandardSchemaV1 as PublicStandardSchemaV1 } from '../../index.ts';
import { isStandardSchemaV1, type StandardSchemaV1 } from './standard.ts';

describe('Standard Schema v1 types and detection', () => {
	it('accepts the official optional validation options', () => {
		const schema: StandardSchemaV1<unknown, string> = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value, options) => ({
					value: `${String(value)}:${String(options?.libraryOptions?.suffix ?? '')}`,
				}),
			},
		};

		expect(schema['~standard'].validate('value', { libraryOptions: { suffix: 'ok' } })).toEqual({
			value: 'value:ok',
		});
		expectTypeOf<PublicStandardSchemaV1>().toEqualTypeOf<StandardSchemaV1>();
	});

	it('recognizes object and callable validators', () => {
		const properties: StandardSchemaV1['~standard'] = {
			version: 1,
			vendor: 'test',
			validate: (value) => ({ value }),
		};
		const objectSchema: StandardSchemaV1 = { '~standard': properties };
		const callableSchema = Object.assign(() => undefined, { '~standard': properties });

		expect(isStandardSchemaV1(objectSchema)).toBe(true);
		expect(isStandardSchemaV1(callableSchema)).toBe(true);
	});

	it('rejects parse functions and malformed schema-like values', () => {
		expect(isStandardSchemaV1((value: unknown) => value)).toBe(false);
		expect(
			isStandardSchemaV1({ '~standard': { version: 2, validate: () => ({ value: 1 }) } }),
		).toBe(false);
		expect(isStandardSchemaV1(null)).toBe(false);
	});
});
