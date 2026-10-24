/**
 * Indexed env bindings at schema construction: template validation,
 * normalization, kind compatibility, and the `.env()` builder overload.
 *
 * @module dreamcli/core/schema/env-binding.test
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { arg, createArgSchema } from './arg.ts';
import type { IndexedEnvBinding } from './env-binding.ts';
import {
	effectiveEnvName,
	effectiveIndexedEnvBinding,
	expandEnvTemplate,
	formatIndexedEnvBinding,
	MAX_INDEXED_ENV_COUNT,
	normalizeIndexedEnvBinding,
} from './env-binding.ts';
import { createFlagSchema, flag } from './flag.ts';
import type { StandardSchemaV1 } from './standard.ts';

/** Minimal hand-rolled Standard Schema validator that accepts anything. */
const anything: StandardSchemaV1<unknown, unknown> = {
	'~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
};

/** Run a schema construction and return the `CLIError` it throws. */
function schemaError(build: () => unknown): CLIError {
	try {
		build();
	} catch (error) {
		if (error instanceof CLIError) return error;
		throw error;
	}
	throw new Error('expected the schema to be rejected');
}

// === normalization

describe('normalizeIndexedEnvBinding()', () => {
	it('keeps a value family as written', () => {
		expect(normalizeIndexedEnvBinding({ count: 'ITEM_COUNT', value: 'ITEM_{index}' })).toEqual({
			count: 'ITEM_COUNT',
			value: 'ITEM_{index}',
		});
	});

	it('copies record fields in declaration order and freezes the copy', () => {
		const fields = { key: 'KEY_{index}', value: 'VALUE_{index}', scope: 'SCOPE_{index}' };
		const normalized = normalizeIndexedEnvBinding({ count: 'COUNT', fields });

		expect(normalized.fields).toEqual(fields);
		expect(Object.keys(normalized.fields ?? {})).toEqual(['key', 'value', 'scope']);
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(Object.isFrozen(normalized.fields)).toBe(true);
		expect(normalized.fields).not.toBe(fields);
	});

	it('accepts a template with the placeholder anywhere, more than once', () => {
		expect(() =>
			normalizeIndexedEnvBinding({ count: 'N', value: '{index}_ITEM_{index}' }),
		).not.toThrow();
	});

	it.each<[string, IndexedEnvBinding, string]>([
		['an empty count', { count: '', value: 'V_{index}' }, "'count' must be a non-empty string"],
		[
			'a placeholder in the count',
			{ count: 'N_{index}', value: 'V_{index}' },
			"'count' must not contain the {index} placeholder",
		],
		[
			'an `=` in the count',
			{ count: 'N=1', value: 'V_{index}' },
			"'count' must not contain '=' or NUL",
		],
		[
			'a value template without the placeholder',
			{ count: 'N', value: 'VALUE' },
			"'value' must contain the {index} placeholder",
		],
		[
			'a misspelled placeholder',
			{ count: 'N', value: 'V_{idx}' },
			"'value' must not contain braces other than the {index} placeholder",
		],
		[
			'a stray brace next to the placeholder',
			{ count: 'N', value: 'V_{index}}' },
			"'value' must not contain braces other than the {index} placeholder",
		],
		[
			'a field template without the placeholder',
			{ count: 'N', fields: { key: 'KEY' } },
			"'fields.key' must contain the {index} placeholder",
		],
		[
			'two fields sharing one template',
			{ count: 'N', fields: { a: 'X_{index}', b: 'X_{index}' } },
			"'fields.b' reuses the template of field 'a'",
		],
		['no fields', { count: 'N', fields: {} }, "'fields' must declare at least one field"],
	])('rejects %s', (_label, binding, message) => {
		const error = schemaError(() => normalizeIndexedEnvBinding(binding));
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe(`Indexed env binding ${message}`);
	});

	it('rejects a binding with both value and fields, or neither', () => {
		const both = { count: 'N', value: 'V_{index}', fields: { a: 'A_{index}' } };
		const neither = { count: 'N' };

		for (const binding of [both, neither]) {
			const error = schemaError(() =>
				normalizeIndexedEnvBinding(binding as unknown as IndexedEnvBinding),
			);
			expect(error.code).toBe('INVALID_SCHEMA');
			expect(error.message).toBe("Indexed env binding needs exactly one of 'value' and 'fields'");
		}
	});

	it('rejects a non-object binding from untyped callers', () => {
		const error = schemaError(() =>
			normalizeIndexedEnvBinding('ITEM_{index}' as unknown as IndexedEnvBinding),
		);
		expect(error.message).toBe('Indexed env binding must be an object');
	});
});

describe('indexed env templates', () => {
	it('expand every placeholder to the base-10 index', () => {
		expect(expandEnvTemplate('ITEM_{index}', 0)).toBe('ITEM_0');
		expect(expandEnvTemplate('A{index}B{index}', 12)).toBe('A12B12');
	});

	it('render for help as templates joined with +, then the count', () => {
		expect(formatIndexedEnvBinding({ count: 'N', value: 'V_{index}' })).toBe('V_{index}, count: N');
		expect(
			formatIndexedEnvBinding({ count: 'N', fields: { key: 'K_{index}', value: 'V_{index}' } }),
		).toBe('K_{index} + V_{index}, count: N');
	});

	it('name the same variables whether the namespace applies before or after expansion', () => {
		const binding: IndexedEnvBinding = {
			count: 'CONFIG_COUNT',
			fields: { key: 'CONFIG_KEY_{index}', value: 'CONFIG_VALUE_{index}' },
		};
		const prefixed = effectiveIndexedEnvBinding(binding, 'FOO_', false);

		expect(prefixed).toEqual({
			count: 'FOO_CONFIG_COUNT',
			fields: { key: 'FOO_CONFIG_KEY_{index}', value: 'FOO_CONFIG_VALUE_{index}' },
		});
		for (const field of ['key', 'value'] as const) {
			for (const index of [0, 1, 12]) {
				expect(expandEnvTemplate(prefixed.fields?.[field] ?? '', index)).toBe(
					effectiveEnvName(expandEnvTemplate(binding.fields?.[field] ?? '', index), 'FOO_', false),
				);
			}
		}
	});

	it('leave names untouched without a namespace or under absolute', () => {
		const binding: IndexedEnvBinding = { count: 'N', value: 'V_{index}' };
		expect(effectiveIndexedEnvBinding(binding, undefined, false)).toBe(binding);
		expect(effectiveIndexedEnvBinding(binding, 'FOO_', true)).toBe(binding);
		expect(effectiveEnvName('HOME', 'FOO_', true)).toBe('HOME');
		expect(effectiveEnvName('TOKEN', undefined, false)).toBe('TOKEN');
	});

	it('cap a count at a documented limit', () => {
		expect(MAX_INDEXED_ENV_COUNT).toBe(10_000);
	});
});

// === flags

describe('flag .env() with an indexed binding', () => {
	it('stores the family on envIndexed and leaves envVar unset', () => {
		const schema = flag.array(flag.string()).env({ count: 'N', value: 'V_{index}' }).schema;

		expect(schema.envIndexed).toEqual({ count: 'N', value: 'V_{index}' });
		expect(schema.envVar).toBeUndefined();
	});

	it('replaces an earlier env source, in either order', () => {
		const indexedLast = flag
			.array(flag.string())
			.env('TAGS')
			.env({ count: 'N', value: 'V_{index}' }).schema;
		const nameLast = flag
			.array(flag.string())
			.env({ count: 'N', value: 'V_{index}' })
			.env('TAGS').schema;

		expect([indexedLast.envVar, indexedLast.envIndexed]).toEqual([
			undefined,
			{ count: 'N', value: 'V_{index}' },
		]);
		expect([nameLast.envVar, nameLast.envIndexed]).toEqual(['TAGS', undefined]);
	});

	it('keeps the stored binding independent of the object the caller passed', () => {
		const fields: Record<string, string> = { key: 'K_{index}' };
		const schema = flag.custom(anything).env({ count: 'N', fields }).schema;
		fields.key = 'CHANGED_{index}';

		expect(schema.envIndexed?.fields).toEqual({ key: 'K_{index}' });
	});

	it('accepts arrays, custom flags, and a record family on a custom element', () => {
		expect(() => flag.array(flag.number()).env({ count: 'N', value: 'V_{index}' })).not.toThrow();
		expect(() => flag.custom(anything).env({ count: 'N', value: 'V_{index}' })).not.toThrow();
		expect(() =>
			flag.array(flag.custom(anything)).env({ count: 'N', fields: { a: 'A_{index}' } }),
		).not.toThrow();
		// A definition-built array with no element passes records through.
		expect(() =>
			createFlagSchema('array', { envIndexed: { count: 'N', fields: { a: 'A_{index}' } } }),
		).not.toThrow();
	});

	it.each([
		['string', () => flag.string()],
		['number', () => flag.number()],
		['boolean', () => flag.boolean()],
		['enum', () => flag.enum(['a', 'b'])],
		['keyValue', () => flag.keyValue()],
		['count', () => flag.count()],
	] as const)('rejects a %s flag, which holds no list', (kind, build) => {
		const error = schemaError(() => build().env({ count: 'N', value: 'V_{index}' }));

		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe(
			`Flag schema field 'envIndexed' requires kind 'array' or 'custom', received kind '${kind}'`,
		);
	});

	it('rejects a record family on a non-custom element', () => {
		const error = schemaError(() =>
			flag.array(flag.string()).env({ count: 'N', fields: { a: 'A_{index}' } }),
		);

		expect(error.message).toBe(
			"Indexed env records need a custom element, received element kind 'string'",
		);
	});

	it('rejects a malformed template at build time', () => {
		const error = schemaError(() => flag.array(flag.string()).env({ count: 'N', value: 'V' }));
		expect(error.message).toBe("Indexed env binding 'value' must contain the {index} placeholder");
	});

	it('validates a definition the same way, envVar conflict included', () => {
		expect(
			createFlagSchema('array', { envIndexed: { count: 'N', value: 'V_{index}' } }).envIndexed,
		).toEqual({ count: 'N', value: 'V_{index}' });

		const conflict = schemaError(() =>
			createFlagSchema('array', {
				envVar: 'TAGS',
				envIndexed: { count: 'N', value: 'V_{index}' },
			}),
		);
		expect(conflict.message).toBe(
			"Flag schema fields 'envVar' and 'envIndexed' are mutually exclusive",
		);

		const wrongKind = schemaError(() =>
			createFlagSchema('string', { envIndexed: { count: 'N', value: 'V_{index}' } }),
		);
		expect(wrongKind.code).toBe('INVALID_SCHEMA');
	});
});

// === args

describe('arg .env() with an indexed binding', () => {
	it('accepts a value family on a variadic arg, declared after .variadic()', () => {
		const schema = arg.number().variadic().env({ count: 'N', value: 'V_{index}' }).schema;
		expect(schema.envIndexed).toEqual({ count: 'N', value: 'V_{index}' });
		expect(schema.envVar).toBeUndefined();
	});

	it('accepts either family on a Standard Schema custom arg', () => {
		expect(() => arg.custom(anything).env({ count: 'N', value: 'V_{index}' })).not.toThrow();
		expect(() =>
			arg.custom(anything).env({ count: 'N', fields: { a: 'A_{index}' } }),
		).not.toThrow();
		expect(() =>
			arg
				.custom(anything)
				.variadic()
				.env({ count: 'N', fields: { a: 'A_{index}' } }),
		).not.toThrow();
	});

	it('rejects a non-variadic scalar arg, pointing at .variadic()', () => {
		const error = schemaError(() => arg.string().env({ count: 'N', value: 'V_{index}' }));

		expect(error.message).toBe(
			"Arg schema field 'envIndexed' requires a variadic arg or a custom arg without a parse function, received kind 'string'",
		);
		expect(error.suggest).toContain('Call .variadic() before .env()');
	});

	it('rejects a custom arg whose parse function takes a string', () => {
		const error = schemaError(() =>
			arg.custom((raw: string) => raw).env({ count: 'N', fields: { a: 'A_{index}' } }),
		);
		expect(error.code).toBe('INVALID_SCHEMA');
	});

	it('rejects a record family on a variadic arg that is not a Standard Schema custom', () => {
		const error = schemaError(() =>
			arg
				.string()
				.variadic()
				.env({ count: 'N', fields: { a: 'A_{index}' } }),
		);
		expect(error.message).toBe(
			"Indexed env records need a custom arg without a parse function, received kind 'string'",
		);
	});

	it('rejects a keyValue arg', () => {
		const error = schemaError(() =>
			arg.keyValue().variadic().env({ count: 'N', value: 'V_{index}' }),
		);
		expect(error.code).toBe('INVALID_SCHEMA');
	});

	it('validates a definition the same way, envVar conflict included', () => {
		const conflict = schemaError(() =>
			createArgSchema('string', {
				variadic: true,
				envVar: 'FILES',
				envIndexed: { count: 'N', value: 'V_{index}' },
			}),
		);
		expect(conflict.message).toBe(
			"Arg schema fields 'envVar' and 'envIndexed' are mutually exclusive",
		);
	});
});
