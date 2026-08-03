/**
 * Modifiers that only some inputs carry: the arg collection settings, and the
 * stdin binding a `count` flag cannot have. Each is refused by the compiler and
 * by both construction paths at run time.
 *
 * @module dreamcli/core/schema/input-modifier-guards.test
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { arg, createArgSchema } from './arg.ts';
import { createFlagSchema, flag } from './flag.ts';

// --- helpers

/** Run a build expected to fail, returning the error it threw. */
function schemaError(build: () => unknown): CLIError {
	try {
		build();
	} catch (error) {
		if (error instanceof CLIError) return error;
		throw error;
	}
	throw new Error('expected the schema to be rejected');
}

// === arg collection modifiers

describe('.separator() and .split() on an arg', () => {
	it('are available on a variadic arg', () => {
		expect(arg.string().variadic().separator(',').schema.separator).toBe(',');
		expect(arg.string().variadic().split({ env: 'json' }).schema.split).toEqual({
			env: { format: 'json' },
			stdin: undefined,
		});
	});

	it('are available on arg.keyValue()', () => {
		expect(arg.keyValue().separator(',').schema.separator).toBe(',');
		expect(arg.keyValue().split({ stdin: 'json' }).schema.split).toEqual({
			env: undefined,
			stdin: { format: 'json' },
		});
	});

	it('are refused on an arg that carries a single value', () => {
		// @ts-expect-error .separator() is not available on a single-value arg
		expect(schemaError(() => arg.string().separator(',')).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .split() is not available on a single-value arg
		expect(schemaError(() => arg.number().split({ env: ',' })).code).toBe('INVALID_SCHEMA');
	});

	it('name the field and the kind that received it', () => {
		// @ts-expect-error .separator() is not available on a single-value arg
		const error = schemaError(() => arg.string().separator(','));
		expect(error.message).toBe(
			"Arg schema field 'separator' requires a collection, received a non-variadic 'string' arg",
		);
		expect(error.details).toEqual({ kind: 'string', field: 'separator' });
	});

	it('are refused on the definition path too', () => {
		expect(schemaError(() => createArgSchema('string', { separator: ',' })).code).toBe(
			'INVALID_SCHEMA',
		);
		expect(
			schemaError(() =>
				createArgSchema('string', { split: { env: { format: 'json' }, stdin: undefined } }),
			).code,
		).toBe('INVALID_SCHEMA');
	});

	it('are accepted on the definition path for a collection', () => {
		expect(createArgSchema('string', { variadic: true, separator: ',' }).separator).toBe(',');
		expect(createArgSchema('keyValue', { separator: ',' }).separator).toBe(',');
	});
});

describe('.unique() on an arg', () => {
	it('is available on a variadic list arg', () => {
		expect(arg.string().variadic().unique().schema.unique).toBe(true);
	});

	it('is refused on an arg that carries a single value', () => {
		// @ts-expect-error .unique() is not available on a single-value arg
		const error = schemaError(() => arg.string().unique());
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Arg schema field 'unique' requires a variadic arg of a list kind");
	});

	it('is refused on a variadic keyValue arg, which folds keys instead', () => {
		expect(schemaError(() => arg.keyValue().variadic().unique()).code).toBe('INVALID_SCHEMA');
	});

	it('is refused on the definition path too', () => {
		expect(schemaError(() => createArgSchema('string', { unique: true })).code).toBe(
			'INVALID_SCHEMA',
		);
		expect(
			schemaError(() => createArgSchema('keyValue', { variadic: true, unique: true })).code,
		).toBe('INVALID_SCHEMA');
	});

	it('accepts unique: false anywhere, which is the stored default', () => {
		expect(createArgSchema('string', { unique: false }).unique).toBe(false);
	});
});

describe('.duplicateKeys() on an arg', () => {
	it('is available on arg.keyValue()', () => {
		expect(arg.keyValue().duplicateKeys('error').schema.duplicateKeys).toBe('error');
	});

	it('is refused on every other kind', () => {
		// @ts-expect-error .duplicateKeys() is not available on a string arg
		const error = schemaError(() => arg.string().duplicateKeys('error'));
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.details).toMatchObject({ field: 'duplicateKeys', requiredKind: 'keyValue' });
	});

	it('is refused on the definition path too', () => {
		expect(
			// @ts-expect-error duplicateKeys requires kind 'keyValue'
			schemaError(() => createArgSchema({ kind: 'string', duplicateKeys: 'error' })).code,
		).toBe('INVALID_SCHEMA');
	});
});

// === count flags and stdin

describe('.stdin() on a count flag', () => {
	it('is refused by the builder at run time', () => {
		// @ts-expect-error .stdin() is not available on a count flag
		const error = schemaError(() => flag.count().stdin());
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Flag schema field 'stdin' is not available on kind 'count'");
	});

	it('is refused by the definition path with the same error', () => {
		const error = schemaError(() => createFlagSchema('count', { stdin: {} }));
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Flag schema field 'stdin' is not available on kind 'count'");
	});

	it('stays available on every other kind', () => {
		expect(flag.string().stdin().schema.stdin?.when).toBe('dash-or-missing');
		expect(flag.array(flag.string()).stdin().schema.stdin?.when).toBe('dash-or-missing');
		expect(flag.keyValue().stdin().schema.stdin?.when).toBe('dash-or-missing');
	});
});
