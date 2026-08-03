/**
 * Modifiers that only some inputs carry: the arg collection settings, and the
 * stdin binding a `count` flag cannot have. Each is refused by the compiler and
 * by both construction paths at run time.
 *
 * @module dreamcli/core/schema/input-modifier-guards.test
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { ARG_KINDS, arg, createArgSchema } from './arg.ts';
import { createFlagSchema, FLAG_KINDS, flag } from './flag.ts';

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

// === an unknown kind discriminator

describe('createFlagSchema() rejects a kind outside FLAG_KINDS', () => {
	it('names the allowed kinds on the two-argument path', () => {
		// @ts-expect-error 'nope' is not a FlagKind
		const error = schemaError(() => createFlagSchema('nope'));
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Unknown flag kind 'nope'");
		expect(error.details).toEqual({ kind: 'nope', allowed: [...FLAG_KINDS] });
		expect(error.suggest).toBe(`Use one of: ${FLAG_KINDS.join(', ')}`);
	});

	it('rejects the same kind on the definition path', () => {
		// @ts-expect-error 'nope' is not a FlagKind
		const error = schemaError(() => createFlagSchema({ kind: 'nope' }));
		expect(error.message).toBe("Unknown flag kind 'nope'");
	});

	it('rejects an unknown kind nested in an element schema', () => {
		const error = schemaError(() =>
			// @ts-expect-error 'nope' is not a FlagKind
			createFlagSchema({ kind: 'array', elementSchema: { kind: 'nope' } }),
		);
		expect(error.message).toBe("Unknown flag kind 'nope'");
	});

	it('accepts every declared kind', () => {
		for (const kind of FLAG_KINDS) {
			expect(createFlagSchema(kind).kind).toBe(kind);
		}
	});
});

describe('createArgSchema() rejects a kind outside ARG_KINDS', () => {
	it('refuses a flag-only kind the arg surface has no arm for', () => {
		// @ts-expect-error 'count' is not an ArgKind
		const error = schemaError(() => createArgSchema('count'));
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Unknown arg kind 'count'");
		expect(error.details).toEqual({ kind: 'count', allowed: [...ARG_KINDS] });
		expect(error.suggest).toBe(`Use one of: ${ARG_KINDS.join(', ')}`);
	});

	it('refuses the array kind, which the arg surface spells as variadic', () => {
		// @ts-expect-error 'array' is not an ArgKind
		expect(schemaError(() => createArgSchema('array')).message).toBe("Unknown arg kind 'array'");
	});

	it('rejects the same kind on the definition path', () => {
		// @ts-expect-error 'count' is not an ArgKind
		expect(schemaError(() => createArgSchema({ kind: 'count' })).message).toBe(
			"Unknown arg kind 'count'",
		);
	});

	it('rejects an unknown kind nested in an element schema', () => {
		const error = schemaError(() =>
			// @ts-expect-error 'nope' is not an ArgKind
			createArgSchema({ kind: 'keyValue', elementSchema: { kind: 'nope' } }),
		);
		expect(error.message).toBe("Unknown arg kind 'nope'");
	});

	it('accepts every declared kind', () => {
		for (const kind of ARG_KINDS) {
			expect(createArgSchema(kind).kind).toBe(kind);
		}
	});
});

// === a collection factory called without its element

describe('flag.array() requires an element builder', () => {
	it('reports a structured schema error when the element is missing', () => {
		// @ts-expect-error the element is required
		const error = schemaError(() => flag.array());
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe('flag.array() requires an element builder');
		expect(error.details).toEqual({ factory: 'array', field: 'element', received: 'undefined' });
		expect(error.suggest).toBe('Pass an element builder, as in flag.array(flag.string())');
	});

	it('reports the same error for a value that is not a builder', () => {
		// @ts-expect-error a plain object is not a FlagBuilder
		expect(schemaError(() => flag.array({})).details).toEqual({
			factory: 'array',
			field: 'element',
			received: 'object',
		});
	});

	it('builds normally with a real element builder', () => {
		expect(flag.array(flag.number()).schema.elementSchema?.kind).toBe('number');
	});
});

describe('the keyValue factories keep their element optional', () => {
	it('builds without an element on both surfaces', () => {
		expect(flag.keyValue().schema.elementSchema).toBeUndefined();
		expect(arg.keyValue().schema.elementSchema).toBeUndefined();
	});

	it('rejects a supplied element that is not a builder', () => {
		// @ts-expect-error null is not a FlagBuilder
		expect(schemaError(() => flag.keyValue(null)).message).toBe(
			'flag.keyValue() requires an element builder',
		);
		// @ts-expect-error a number is not an ArgBuilder
		expect(schemaError(() => arg.keyValue(0)).message).toBe(
			'arg.keyValue() requires an element builder',
		);
	});
});

// === what a builder produces is always a definition the framework reads back

describe('a modifier called on a kind that does not carry its field', () => {
	it('is rejected on the flag builder, with the error the definition path gives', () => {
		// @ts-expect-error .separator() is not available on a string flag
		expect(schemaError(() => flag.string().separator(',')).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .split() is not available on a number flag
		expect(schemaError(() => flag.number().split({ env: ';' })).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .unique() is not available on a keyValue flag
		expect(schemaError(() => flag.keyValue().unique()).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .duplicateKeys() is not available on an array flag
		expect(schemaError(() => flag.array(flag.string()).duplicateKeys('first')).code).toBe(
			'INVALID_SCHEMA',
		);
		// @ts-expect-error .negatable() is not available on a count flag
		expect(schemaError(() => flag.count().negatable()).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .nonEmpty() is not available on an enum flag
		expect(schemaError(() => flag.enum(['a', 'b']).nonEmpty()).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .min() is not available on a keyValue flag
		expect(schemaError(() => flag.keyValue().min(1)).code).toBe('INVALID_SCHEMA');
	});

	it('is rejected on the arg builder, with the error the definition path gives', () => {
		// @ts-expect-error .separator() is not available on a single-value arg
		expect(schemaError(() => arg.boolean().separator(',')).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .unique() is not available on a keyValue arg
		expect(schemaError(() => arg.keyValue().unique()).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .duplicateKeys() is not available on a variadic string arg
		expect(schemaError(() => arg.string().variadic().duplicateKeys('first')).code).toBe(
			'INVALID_SCHEMA',
		);
		// @ts-expect-error .pattern() is not available on a number arg
		expect(schemaError(() => arg.number().pattern(/x/)).code).toBe('INVALID_SCHEMA');
		// @ts-expect-error .finite() is not available on an enum arg
		expect(schemaError(() => arg.enum(['a', 'b']).finite()).code).toBe('INVALID_SCHEMA');
	});
});

describe('every legal modifier leaves a schema its own factory reads back', () => {
	it('holds for the flag builder', () => {
		const built = [
			flag.string().nonEmpty().minLength(2).pattern(/^a/),
			flag.number().int().min(1).max(9).finite(),
			flag.boolean().negatable(),
			flag.enum(['a', 'b']),
			flag.count(),
			flag.custom((raw: unknown) => String(raw)),
			flag.array(flag.string()).separator(',').split({ env: ';', stdin: 'json' }).unique(),
			flag.keyValue().separator(',').split({ env: ';' }).duplicateKeys('first'),
			flag.path({ mustExist: true }),
		];
		for (const builder of built) {
			expect(() => createFlagSchema(builder.schema.kind, builder.schema)).not.toThrow();
		}
	});

	it('holds for the arg builder', () => {
		const built = [
			arg.string().nonEmpty().minLength(2).pattern(/^a/),
			arg.number().int().min(1).max(9).finite(),
			arg.boolean(),
			arg.enum(['a', 'b']),
			arg.custom((raw: string) => raw),
			arg.string().variadic().separator(',').split({ env: ';', stdin: 'json' }).unique(),
			arg.keyValue().separator(',').split({ env: ';' }).duplicateKeys('first'),
			arg.path({ mustExist: true }),
		];
		for (const builder of built) {
			expect(() => createArgSchema(builder.schema.kind, builder.schema)).not.toThrow();
		}
	});
});
