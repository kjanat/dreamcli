/**
 * Unit tests for the cardinality axis: split policies, aggregation rules, the
 * two schema projections, and construction-time default validation.
 *
 * @module dreamcli/core/schema/cardinality.test
 */

import { describe, expect, it } from 'vitest';
import { isCLIError } from '#internals/core/errors/index.ts';
import { arg, createArgSchema } from './arg.ts';
import {
	argCardinality,
	dedupe,
	flagCardinality,
	foldEntries,
	splitBindingOf,
	splitEntriesText,
	splitLines,
	splitManyText,
} from './cardinality.ts';
import { createFlagSchema, flag } from './flag.ts';
import type { StandardSchemaV1 } from './standard.ts';
import { argValueSchema, flagValueSchema } from './value.ts';

/** Run a factory expected to reject, returning the error it threw. */
function schemaError(build: () => unknown): { code: string; message: string } {
	try {
		build();
	} catch (error) {
		if (isCLIError(error)) return { code: error.code, message: error.message };
		throw error;
	}
	throw new Error('expected the schema to be rejected');
}

// === splitting

describe('splitLines()', () => {
	it('removes only the empty element a final terminator produces', () => {
		expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
		expect(splitLines('a\nb')).toEqual(['a', 'b']);
	});

	it('preserves a genuine blank line', () => {
		expect(splitLines('a\nb\n\n')).toEqual(['a', 'b', '']);
	});

	it('handles every terminator spelling', () => {
		expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
	});

	it('reads an empty buffer as no elements', () => {
		expect(splitLines('')).toEqual([]);
	});
});

describe('splitManyText()', () => {
	it('keeps the whole text as one element', () => {
		expect(splitManyText({ format: 'whole' }, 'a,b')).toEqual({ ok: true, parts: ['a,b'] });
	});

	it('drops empty segments of delimited text', () => {
		expect(splitManyText({ format: 'delimiter', delimiter: ',' }, 'a,,b,')).toEqual({
			ok: true,
			parts: ['a', 'b'],
		});
	});

	it('reads a JSON array', () => {
		expect(splitManyText({ format: 'json' }, '["a", 2]')).toEqual({ ok: true, parts: ['a', 2] });
	});

	it('reports a JSON value that is not an array', () => {
		expect(splitManyText({ format: 'json' }, '{"a":1}')).toEqual({
			ok: false,
			failure: { kind: 'json-shape', expected: 'array' },
		});
	});

	it('reports unparseable JSON', () => {
		const result = splitManyText({ format: 'json' }, '{');
		expect(result.ok).toBe(false);
		expect(result.ok ? undefined : result.failure.kind).toBe('json');
	});
});

describe('splitEntriesText()', () => {
	it('splits delimited pairs at the first =', () => {
		expect(splitEntriesText({ format: 'delimiter', delimiter: ',' }, 'A=1,B=b=c')).toEqual({
			ok: true,
			parts: [
				['A', '1'],
				['B', 'b=c'],
			],
		});
	});

	it('splits piped lines into pairs', () => {
		expect(splitEntriesText({ format: 'lines' }, 'A=1\nB=2\n')).toEqual({
			ok: true,
			parts: [
				['A', '1'],
				['B', '2'],
			],
		});
	});

	it('reads a JSON object', () => {
		expect(splitEntriesText({ format: 'json' }, '{"A":"1"}')).toEqual({
			ok: true,
			parts: [['A', '1']],
		});
	});

	it('reports a segment with no =', () => {
		expect(splitEntriesText({ format: 'delimiter', delimiter: ',' }, 'A=1,nope')).toEqual({
			ok: false,
			failure: { kind: 'pair', raw: 'nope' },
		});
	});

	it('reads an empty whole value as no pairs', () => {
		expect(splitEntriesText({ format: 'whole' }, '')).toEqual({ ok: true, parts: [] });
	});
});

// === aggregation

describe('foldEntries()', () => {
	const pairs = [
		['A', '1'],
		['B', '2'],
		['A', '3'],
	] as const;

	it('lets the later occurrence win by default', () => {
		expect(foldEntries(pairs, 'last')).toEqual({ ok: true, value: { A: '3', B: '2' } });
	});

	it('lets the earlier occurrence win under first', () => {
		expect(foldEntries(pairs, 'first')).toEqual({ ok: true, value: { A: '1', B: '2' } });
	});

	it('reports the repeated key and where it repeated under error', () => {
		expect(foldEntries(pairs, 'error')).toEqual({ ok: false, duplicateKey: 'A', at: 2 });
	});

	it('stores a __proto__ key as an own entry', () => {
		const folded = foldEntries([['__proto__', 'x']], 'last');
		expect(folded.ok && Object.hasOwn(folded.value, '__proto__')).toBe(true);
	});
});

describe('dedupe()', () => {
	it('preserves first-seen order', () => {
		expect(dedupe(['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
	});
});

// === projections

describe('flagCardinality()', () => {
	it('reads every scalar kind as one', () => {
		expect(flagCardinality(createFlagSchema('string')).kind).toBe('one');
		expect(flagCardinality(createFlagSchema('boolean')).kind).toBe('one');
		expect(flagCardinality(createFlagSchema('custom')).kind).toBe('one');
	});

	it('reads count on its own axis', () => {
		expect(flagCardinality(createFlagSchema('count')).kind).toBe('count');
	});

	it('carries the CLI split policy and uniqueness', () => {
		const schema = flag
			.array(flag.string())
			.separator('|')
			.split({ env: { format: 'json' } })
			.unique().schema;
		const cardinality = flagCardinality(schema);

		expect(cardinality).toMatchObject({
			kind: 'many',
			unique: true,
			cliSplit: { format: 'delimiter', delimiter: '|' },
		});
	});

	it('leaves a CLI token whole when no separator is set', () => {
		expect(flagCardinality(flag.array(flag.string()).schema)).toMatchObject({
			cliSplit: { format: 'whole' },
		});
	});

	it('resolves the non-CLI defaults through the split binding', () => {
		expect(splitBindingOf(undefined, undefined)).toEqual({
			cli: { format: 'whole' },
			env: { format: 'delimiter', delimiter: ',' },
			stdin: { format: 'lines' },
		});
	});

	it('carries the duplicate-key policy of an entries flag', () => {
		expect(flagCardinality(flag.keyValue().duplicateKeys('error').schema)).toMatchObject({
			kind: 'entries',
			duplicateKeys: 'error',
		});
	});
});

describe('argCardinality()', () => {
	it('reads a plain arg as one and a variadic arg as many', () => {
		expect(argCardinality(arg.string().schema).kind).toBe('one');
		expect(argCardinality(arg.string().variadic().schema).kind).toBe('many');
	});

	it('reads a keyValue arg as entries, variadic or not', () => {
		expect(argCardinality(arg.keyValue().schema).kind).toBe('entries');
		expect(argCardinality(arg.keyValue().variadic().schema).kind).toBe('entries');
	});
});

// === split option validation

describe('.split() option validation', () => {
	it('rejects a format the CLI source does not accept', () => {
		const error = schemaError(() => flag.array(flag.string()).split({ cli: { format: 'json' } }));
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Split format 'json' is not available for cli");
	});

	it('rejects lines on the env source', () => {
		const error = schemaError(() => flag.array(flag.string()).split({ env: { format: 'lines' } }));
		expect(error.message).toBe("Split format 'lines' is not available for env");
	});

	it('rejects an empty delimiter', () => {
		const error = schemaError(() => flag.array(flag.string()).split({ env: '' }));
		expect(error.message).toBe('Split delimiter for env must not be empty');
	});

	it('accepts every stdin format', () => {
		for (const stdin of ['whole', 'lines', 'json'] as const) {
			expect(
				flag.array(flag.string()).split({ stdin: { format: stdin } }).schema.split?.stdin,
			).toEqual({ format: stdin });
		}
	});
});

// === validated defaults, construction time

describe('validated defaults, flags', () => {
	it('rejects a default that violates a string constraint', () => {
		const error = schemaError(() => flag.string({ minLength: 3 }).default('ab'));
		expect(error.code).toBe('INVALID_DEFAULT');
		expect(error.message).toBe(
			'Default value for a string flag is invalid: must be at least 3 characters',
		);
	});

	it('rejects a default that violates a number constraint', () => {
		const error = schemaError(() => flag.number({ int: true }).default(1.5));
		expect(error.code).toBe('INVALID_DEFAULT');
	});

	it('rejects a non-finite default unless finiteness was waived', () => {
		expect(schemaError(() => flag.number().default(Number.POSITIVE_INFINITY)).code).toBe(
			'INVALID_DEFAULT',
		);
		expect(
			flag.number({ finite: false }).default(Number.POSITIVE_INFINITY).schema.defaultValue,
		).toBe(Number.POSITIVE_INFINITY);
	});

	it('rejects a scalar default on a collection', () => {
		const error = schemaError(() => createFlagSchema('array', { defaultValue: 'a' }));
		expect(error.message).toBe('Default value for an array flag is invalid: expected an array');
	});

	it('validates every element of an array default', () => {
		const error = schemaError(() => flag.array(flag.string({ nonEmpty: true })).default(['a', '']));
		expect(error.code).toBe('INVALID_DEFAULT');
		expect(error.message).toContain('at 1');
	});

	it('validates every value of an entries default', () => {
		const error = schemaError(() =>
			createFlagSchema('keyValue', {
				elementSchema: { kind: 'string', stringConstraints: { minLength: 2 } },
				defaultValue: { A: 'x' },
			}),
		);
		expect(error.message).toContain('at A');
	});

	it('rejects a count default that is not a non-negative integer', () => {
		expect(schemaError(() => createFlagSchema('count', { defaultValue: -1 })).message).toBe(
			'Default value for a count flag is invalid: expected a non-negative integer',
		);
	});

	it('leaves a count validator to resolution, since the factory declares the default', () => {
		const verbose = flag.count().standard({
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) =>
					value === 2 ? { value } : { issues: [{ message: 'must be two' }] },
			},
		});
		expect(verbose.schema.defaultValue).toBe(0);
		expect(verbose.default(1).schema.defaultValue).toBe(1);
	});

	it('runs a synchronous element validator over a default', () => {
		const element = flag.string().standard({
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) =>
					value === 'ok' ? { value } : { issues: [{ message: 'must be ok' }] },
			},
		});
		expect(schemaError(() => element.default('nope')).message).toBe(
			'Default value for a string flag is invalid: must be ok',
		);
		expect(element.default('ok').schema.defaultValue).toBe('ok');
	});

	it('runs a synchronous aggregate validator over a collection default', () => {
		const tags = flag.array(flag.string()).standard({
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) =>
					Array.isArray(value) && value.length > 0
						? { value }
						: { issues: [{ message: 'needs at least one tag' }] },
			},
		});
		expect(schemaError(() => tags.default([])).message).toBe(
			'Default value for an array flag is invalid: needs at least one tag',
		);
	});

	it('leaves an asynchronous validator to resolution time', () => {
		const slow = flag.string().standard({
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: async () => ({ issues: [{ message: 'always fails' }] }),
			},
		});
		expect(slow.default('anything').schema.defaultValue).toBe('anything');
	});

	it('rejects a default invalidated by a later constraint', () => {
		expect(schemaError(() => flag.string().default('ab').minLength(3)).code).toBe(
			'INVALID_DEFAULT',
		);
		expect(schemaError(() => arg.number().default(1.5).int()).code).toBe('INVALID_DEFAULT');
	});

	it('rejects a default invalidated by a later variadic call', () => {
		const error = schemaError(() => arg.string().default('a').variadic());
		expect(error.message).toBe('Default value for a string argument is invalid: expected an array');
	});
});

describe('validated defaults, args', () => {
	it('rejects a default that violates a string constraint', () => {
		const error = schemaError(() => arg.string({ pattern: /^v/ }).default('nope'));
		expect(error.code).toBe('INVALID_DEFAULT');
		expect(error.message).toContain('argument');
	});

	it('rejects a non-record default on a keyValue arg', () => {
		expect(schemaError(() => createArgSchema('keyValue', { defaultValue: 'A=1' })).message).toBe(
			'Default value for a keyValue argument is invalid: expected an object',
		);
	});

	it('accepts a typed record default on a keyValue arg', () => {
		expect(createArgSchema('keyValue', { defaultValue: { A: '1' } }).defaultValue).toEqual({
			A: '1',
		});
	});
});

// === split settings accumulate per source

describe('.split() across successive calls', () => {
	it('keeps a source an earlier call set', () => {
		expect(
			flag
				.array(flag.string())
				.split({ env: ';' })
				.split({ stdin: { format: 'json' } }).schema.split,
		).toEqual({ env: { format: 'delimiter', delimiter: ';' }, stdin: { format: 'json' } });
	});

	it('keeps a source an earlier call set on the arg surface', () => {
		expect(
			arg
				.string()
				.variadic()
				.split({ stdin: 'whole' })
				.split({ env: { format: 'json' } }).schema.split,
		).toEqual({ env: { format: 'json' }, stdin: { format: 'whole' } });
	});

	it('replaces a source a later call names again', () => {
		expect(flag.array(flag.string()).split({ env: ';' }).split({ env: '|' }).schema.split).toEqual({
			env: { format: 'delimiter', delimiter: '|' },
			stdin: undefined,
		});
	});
});

// === a validator declared after a default still governs it

describe('.standard() after .default()', () => {
	const rejectAll: StandardSchemaV1 = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: () => ({ issues: [{ message: 'rejected' }] }),
		},
	};

	it('rejects a scalar default the element validator refuses', () => {
		expect(schemaError(() => flag.string().default('x').standard(rejectAll)).code).toBe(
			'INVALID_DEFAULT',
		);
		expect(schemaError(() => arg.string().default('x').standard(rejectAll)).code).toBe(
			'INVALID_DEFAULT',
		);
	});

	it('rejects a collection default the aggregate validator refuses', () => {
		expect(
			schemaError(() => flag.array(flag.string()).default(['a']).standard(rejectAll)).code,
		).toBe('INVALID_DEFAULT');
		expect(schemaError(() => arg.string().variadic().default(['a']).standard(rejectAll)).code).toBe(
			'INVALID_DEFAULT',
		);
	});
});

// === a validator on a definition-built collection is the element's

describe('definition-built collection validators', () => {
	const rejectAll: StandardSchemaV1 = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: () => ({ issues: [{ message: 'rejected' }] }),
		},
	};

	it('reads a collection standard as the element validator', () => {
		expect(flagValueSchema(createFlagSchema('array', { standard: rejectAll })).standard).toBe(
			rejectAll,
		);
		expect(argValueSchema(createArgSchema('keyValue', { standard: rejectAll })).standard).toBe(
			rejectAll,
		);
	});

	it('leaves an element validator in place over the collection one', () => {
		const element = createFlagSchema('string', { standard: rejectAll });
		expect(flagValueSchema(createFlagSchema('array', { elementSchema: element })).standard).toBe(
			rejectAll,
		);
	});

	it('rejects an aggregate validator on a kind that never aggregates', () => {
		expect(
			schemaError(() => createFlagSchema('string', { aggregateStandard: rejectAll })).code,
		).toBe('INVALID_SCHEMA');
		expect(
			schemaError(() => createArgSchema('string', { aggregateStandard: rejectAll })).code,
		).toBe('INVALID_SCHEMA');
	});

	it('accepts an aggregate validator on every kind that aggregates', () => {
		expect(createFlagSchema('array', { aggregateStandard: rejectAll }).aggregateStandard).toBe(
			rejectAll,
		);
		expect(
			createArgSchema('string', { variadic: true, aggregateStandard: rejectAll }).aggregateStandard,
		).toBe(rejectAll);
		expect(createArgSchema('keyValue', { aggregateStandard: rejectAll }).aggregateStandard).toBe(
			rejectAll,
		);
	});
});

// === a variadic arg default is the completed array

describe('variadic arg defaults', () => {
	it('accepts the array the arg resolves to', () => {
		expect(arg.string().variadic().default(['a', 'b']).schema.defaultValue).toEqual(['a', 'b']);
	});

	it('validates every element of that array', () => {
		expect(
			schemaError(() => arg.string({ nonEmpty: true }).variadic().default(['a', ''])).code,
		).toBe('INVALID_DEFAULT');
	});

	it('accepts the record a keyValue arg resolves to', () => {
		expect(arg.keyValue().variadic().default({ A: '1' }).schema.defaultValue).toEqual({ A: '1' });
	});
});
