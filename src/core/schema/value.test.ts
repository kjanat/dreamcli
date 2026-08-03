/**
 * The shared value layer: one codec per value kind, constraints riding the
 * schema, and the two projections that keep `flag` and `arg` on the same
 * carrier.
 */

import { describe, expect, it } from 'vitest';
import { arg, createArgSchema } from './arg.ts';
import { createFlagSchema, flag } from './flag.ts';
import type { StandardSchemaV1 } from './standard.ts';
import type { ValueFailure, ValueInput, ValueSchema } from './value.ts';
import {
	argValueSchema,
	booleanValue,
	bytesValue,
	customValue,
	dateValue,
	decodeValue,
	durationValue,
	enumValue,
	flagValueSchema,
	numberValue,
	passthroughValue,
	pathValue,
	standardValue,
	stringParsedValue,
	stringValue,
	urlValue,
	validateDecodedValue,
	valueDefinitionFields,
	valueEnumValues,
} from './value.ts';

const standardNumber: StandardSchemaV1<unknown, number> = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: (value) =>
			typeof value === 'number' ? { value } : { issues: [{ message: 'not a number' }] },
	},
};

/** Decode `raw` and return the value, failing the assertion when it was rejected. */
function decoded(value: ValueSchema, raw: unknown, input: ValueInput): unknown {
	const result = decodeValue(value, raw, input);
	expect(result.ok).toBe(true);
	return result.ok ? result.value : undefined;
}

/** Decode `raw` and return the failure, failing the assertion when it was accepted. */
function rejected(value: ValueSchema, raw: unknown, input: ValueInput): ValueFailure {
	const result = decodeValue(value, raw, input);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected a rejected value');
	return result.failure;
}

// === codec set

describe('codec set', () => {
	it('is exactly the five value kinds both surfaces share', () => {
		const names = [
			stringValue(),
			numberValue(),
			booleanValue(),
			enumValue(['a']),
			customValue((raw: unknown) => raw),
			stringParsedValue((raw: string) => raw),
			passthroughValue(),
			standardValue(standardNumber),
			urlValue(),
			pathValue(),
			dateValue(),
			durationValue(),
			bytesValue(),
		].map((value) => value.codec.name);

		expect([...new Set(names)].sort()).toEqual(['boolean', 'custom', 'enum', 'number', 'string']);
	});
});

// === codecs

describe('string codec', () => {
	// --- accepted

	it('passes a string through from every input', () => {
		const value = stringValue();
		expect(decoded(value, 'x', 'token')).toBe('x');
		expect(decoded(value, 'x', 'env')).toBe('x');
		expect(decoded(value, 'x', 'config')).toBe('x');
		expect(decoded(value, 'x', 'prompt')).toBe('x');
	});

	it('stringifies a config scalar', () => {
		expect(decoded(stringValue(), 8080, 'config')).toBe('8080');
		expect(decoded(stringValue(), true, 'config')).toBe('true');
	});

	it('stringifies any prompt answer', () => {
		expect(decoded(stringValue(), 12, 'prompt')).toBe('12');
		expect(decoded(stringValue(), null, 'prompt')).toBe('null');
	});

	// --- rejected

	it('rejects a non-string from argv and env', () => {
		expect(rejected(stringValue(), 12, 'token')).toEqual({ kind: 'type', expected: 'string' });
		expect(rejected(stringValue(), 12, 'env')).toEqual({ kind: 'type', expected: 'string' });
	});

	it('rejects a config object', () => {
		expect(rejected(stringValue(), { a: 1 }, 'config')).toEqual({
			kind: 'type',
			expected: 'string',
		});
	});

	// --- constraints

	it('routes every string constraint through the constraints slot', () => {
		expect(rejected(stringValue({ nonEmpty: true }), '', 'token')).toEqual({
			kind: 'string-constraint',
			value: '',
			violation: { kind: 'nonEmpty' },
		});
		expect(rejected(stringValue({ minLength: 5 }), 'abc', 'token')).toEqual({
			kind: 'string-constraint',
			value: 'abc',
			violation: { kind: 'minLength', bound: 5 },
		});
		expect(rejected(stringValue({ maxLength: 2 }), 'abc', 'token')).toEqual({
			kind: 'string-constraint',
			value: 'abc',
			violation: { kind: 'maxLength', bound: 2 },
		});
		expect(rejected(stringValue({ pattern: /^ghp_/ }), 'abc', 'token')).toEqual({
			kind: 'string-constraint',
			value: 'abc',
			violation: { kind: 'pattern', pattern: '/^ghp_/' },
		});
	});

	it('reports the converted string, not the raw config value', () => {
		const failure = rejected(stringValue({ minLength: 5 }), 42, 'config');
		expect(failure).toEqual({
			kind: 'string-constraint',
			value: '42',
			violation: { kind: 'minLength', bound: 5 },
		});
	});
});

describe('number codec', () => {
	// --- accepted

	it('reads a numeric string and a number alike', () => {
		expect(decoded(numberValue(), '42', 'token')).toBe(42);
		expect(decoded(numberValue(), '42', 'env')).toBe(42);
		expect(decoded(numberValue(), 42, 'config')).toBe(42);
	});

	// --- rejected

	it('rejects a non-numeric string', () => {
		expect(rejected(numberValue(), 'abc', 'token')).toEqual({ kind: 'type', expected: 'number' });
	});

	it('rejects NaN before any bound can accept it', () => {
		expect(rejected(numberValue({ min: 0 }), Number.NaN, 'config')).toEqual({
			kind: 'type',
			expected: 'number',
		});
	});

	it('rejects a boolean and an object', () => {
		expect(rejected(numberValue(), true, 'config')).toEqual({ kind: 'type', expected: 'number' });
		expect(rejected(numberValue(), {}, 'config')).toEqual({ kind: 'type', expected: 'number' });
	});

	// --- constraints

	it('rejects Infinity with no constraints declared', () => {
		expect(rejected(numberValue(), 'Infinity', 'token')).toEqual({
			kind: 'number-constraint',
			value: Number.POSITIVE_INFINITY,
			violation: { kind: 'finite' },
		});
	});

	it('routes bounds and integrality through the constraints slot', () => {
		expect(rejected(numberValue({ min: 10 }), '5', 'token')).toEqual({
			kind: 'number-constraint',
			value: 5,
			violation: { kind: 'min', bound: 10 },
		});
		expect(rejected(numberValue({ max: 10 }), '11', 'token')).toEqual({
			kind: 'number-constraint',
			value: 11,
			violation: { kind: 'max', bound: 10 },
		});
		expect(rejected(numberValue({ int: true }), '3.7', 'token')).toEqual({
			kind: 'number-constraint',
			value: 3.7,
			violation: { kind: 'int' },
		});
	});

	it('accepts Infinity once finiteness is opted out', () => {
		expect(decoded(numberValue({ finite: false }), 'Infinity', 'token')).toBe(
			Number.POSITIVE_INFINITY,
		);
	});
});

describe('boolean codec', () => {
	// --- argv tokens

	it('accepts only the spelled-out forms from argv', () => {
		const value = booleanValue();
		expect(decoded(value, 'true', 'token')).toBe(true);
		expect(decoded(value, '1', 'token')).toBe(true);
		expect(decoded(value, 'false', 'token')).toBe(false);
		expect(decoded(value, '0', 'token')).toBe(false);
		expect(rejected(value, 'yes', 'token')).toEqual({ kind: 'type', expected: 'boolean' });
		expect(rejected(value, '', 'token')).toEqual({ kind: 'type', expected: 'boolean' });
	});

	// --- resolver sources

	it('accepts the wider set from env and config', () => {
		const value = booleanValue();
		expect(decoded(value, 'yes', 'env')).toBe(true);
		expect(decoded(value, 'NO', 'env')).toBe(false);
		expect(decoded(value, '', 'env')).toBe(false);
		expect(decoded(value, true, 'config')).toBe(true);
		expect(rejected(value, 'maybe', 'config')).toEqual({ kind: 'type', expected: 'boolean' });
	});

	it('accepts y and n only from a prompt', () => {
		const value = booleanValue();
		expect(decoded(value, 'y', 'prompt')).toBe(true);
		expect(decoded(value, 'n', 'prompt')).toBe(false);
		expect(rejected(value, 'y', 'env')).toEqual({ kind: 'type', expected: 'boolean' });
	});
});

describe('enum codec', () => {
	it('accepts a declared literal', () => {
		expect(decoded(enumValue(['us', 'eu']), 'eu', 'token')).toBe('eu');
	});

	it('carries the allowed literals on rejection', () => {
		expect(rejected(enumValue(['us', 'eu']), 'ap', 'token')).toEqual({
			kind: 'enum',
			enumValues: ['us', 'eu'],
		});
	});

	it('distinguishes an undeclared value set from a disallowed value', () => {
		expect(rejected(enumValue(undefined), 'us', 'token')).toEqual({
			kind: 'enum',
			enumValues: undefined,
		});
	});

	it('reports its literals through the value accessor', () => {
		expect(valueEnumValues(enumValue(['us', 'eu']))).toEqual(['us', 'eu']);
		expect(valueEnumValues(stringValue())).toBeUndefined();
		expect(valueEnumValues(undefined)).toBeUndefined();
	});
});

describe('custom codec', () => {
	it('hands a flag-style parse function the raw value untouched', () => {
		const seen: unknown[] = [];
		const value = customValue((raw: unknown) => {
			seen.push(raw);
			return raw;
		});
		decodeValue(value, 42, 'config');
		expect(seen).toEqual([42]);
	});

	it('stringifies a non-string before an arg-style parse function sees it', () => {
		const seen: unknown[] = [];
		const value = stringParsedValue((raw: string) => {
			seen.push(raw);
			return raw;
		});
		decodeValue(value, 42, 'config');
		expect(seen).toEqual(['42']);
	});

	it('captures a thrown error instead of propagating it', () => {
		const boom = new Error('bad value');
		const failure = rejected(
			customValue(() => {
				throw boom;
			}),
			'x',
			'token',
		);
		expect(failure).toEqual({ kind: 'thrown', error: boom });
	});

	it('passes the raw value through when no parse function is attached', () => {
		expect(decoded(passthroughValue(), { a: 1 }, 'config')).toEqual({ a: 1 });
		expect(decoded(standardValue(standardNumber), '7', 'token')).toBe('7');
	});
});

// === sugar values

describe('sugar value constructors', () => {
	it('parse the shapes their factories advertise', () => {
		expect(decoded(urlValue(), 'https://example.com/', 'token')).toEqual(
			new URL('https://example.com/'),
		);
		expect(decoded(dateValue(), '2026-07-10', 'token')).toEqual(new Date(Date.UTC(2026, 6, 10)));
		expect(decoded(durationValue(), '1h30m', 'token')).toBe(5_400_000);
		expect(decoded(bytesValue(), '512kb', 'token')).toBe(524_288);
		expect(decoded(pathValue(), './out', 'token')).toBe('./out');
	});

	it('carry the help placeholder their factories set', () => {
		expect(urlValue().valueHint).toBe('url');
		expect(dateValue().valueHint).toBe('date');
		expect(durationValue().valueHint).toBe('duration');
		expect(bytesValue().valueHint).toBe('size');
		expect(pathValue().valueHint).toBe('path');
		expect(stringValue().valueHint).toBeUndefined();
	});

	it('carry filesystem checks only when the options ask for them', () => {
		expect(pathValue().pathChecks).toBeUndefined();
		expect(pathValue({ mustExist: false }).pathChecks).toBeUndefined();
		expect(pathValue({ type: 'directory', create: true }).pathChecks).toEqual({
			mustExist: true,
			type: 'directory',
			create: true,
		});
	});

	it('reject through the options their factories pass down', () => {
		expect(rejected(urlValue({ protocols: ['https'] }), 'http://example.com/', 'token')).toEqual({
			kind: 'thrown',
			error: expect.any(Error),
		});
	});
});

// === definition round trip

describe('valueDefinitionFields', () => {
	it('emits only the fields a value declares', () => {
		expect(valueDefinitionFields(stringValue())).toEqual({});
		expect(valueDefinitionFields(numberValue())).toEqual({});
		expect(valueDefinitionFields(booleanValue())).toEqual({});
		expect(valueDefinitionFields(stringValue({ nonEmpty: true }))).toEqual({
			stringConstraints: { nonEmpty: true },
		});
		expect(valueDefinitionFields(numberValue({ min: 0 }))).toEqual({
			numberConstraints: { min: 0 },
		});
	});

	it('emits the parse function verbatim', () => {
		const parseFn = (raw: string): string => raw.toUpperCase();
		expect(valueDefinitionFields(stringParsedValue(parseFn)).parseFn).toBe(parseFn);
	});

	it('emits the validator, the checks, and the hint', () => {
		expect(valueDefinitionFields(standardValue(standardNumber))).toEqual({
			standard: standardNumber,
		});
		expect(valueDefinitionFields(pathValue({ type: 'file' }))).toEqual({
			pathChecks: { mustExist: true, type: 'file', create: false },
			valueHint: 'path',
		});
	});
});

// === already-typed values

describe('validateDecodedValue', () => {
	it('applies the same constraints decoding would have applied', () => {
		expect(validateDecodedValue(stringValue({ minLength: 5 }), 'abc')).toEqual({
			kind: 'string-constraint',
			value: 'abc',
			violation: { kind: 'minLength', bound: 5 },
		});
		expect(validateDecodedValue(numberValue({ max: 10 }), 11)).toEqual({
			kind: 'number-constraint',
			value: 11,
			violation: { kind: 'max', bound: 10 },
		});
	});

	it('accepts a value the constraints allow', () => {
		expect(validateDecodedValue(stringValue({ minLength: 2 }), 'abc')).toBeUndefined();
		expect(validateDecodedValue(numberValue({ max: 10 }), 9)).toBeUndefined();
	});

	it('has nothing to say about a codec that declares no constraints', () => {
		expect(validateDecodedValue(booleanValue(), true)).toBeUndefined();
		expect(validateDecodedValue(enumValue(['a']), 'z')).toBeUndefined();
		expect(validateDecodedValue(urlValue(), new URL('https://example.com/'))).toBeUndefined();
	});
});

// === projections

describe('flagValueSchema', () => {
	it('covers every scalar flag kind', () => {
		expect(flagValueSchema(createFlagSchema('string'))?.codec.name).toBe('string');
		expect(flagValueSchema(createFlagSchema('number'))?.codec.name).toBe('number');
		expect(flagValueSchema(createFlagSchema('boolean'))?.codec.name).toBe('boolean');
		expect(flagValueSchema(createFlagSchema('enum', { enumValues: ['a'] }))?.codec.name).toBe(
			'enum',
		);
		expect(flagValueSchema(createFlagSchema('custom'))?.codec.name).toBe('custom');
	});

	it('leaves the collection kinds to the cardinality axis', () => {
		expect(flagValueSchema(createFlagSchema('array'))).toBeUndefined();
		expect(flagValueSchema(createFlagSchema('count'))).toBeUndefined();
		expect(flagValueSchema(createFlagSchema('keyValue'))).toBeUndefined();
	});

	it('reads the flat fields back onto the value slots', () => {
		const value = flagValueSchema(flag.path({ type: 'directory' }).schema);
		expect(value?.pathChecks).toEqual({ mustExist: true, type: 'directory', create: false });
		expect(value?.valueHint).toBe('path');
		expect(flagValueSchema(flag.custom(standardNumber).schema)?.standard).toBe(standardNumber);
		expect(flagValueSchema(flag.string({ minLength: 3 }).schema)?.constraints).toEqual({
			kind: 'string',
			stringConstraints: { minLength: 3 },
		});
	});

	it('decodes through the projection exactly as the factory declared', () => {
		const value = flagValueSchema(flag.duration().schema);
		expect(value === undefined ? undefined : decoded(value, '30s', 'token')).toBe(30_000);
	});
});

describe('argValueSchema', () => {
	it('covers every arg kind', () => {
		expect(argValueSchema(createArgSchema('string')).codec.name).toBe('string');
		expect(argValueSchema(createArgSchema('number')).codec.name).toBe('number');
		expect(argValueSchema(createArgSchema('enum', { enumValues: ['a'] })).codec.name).toBe('enum');
		expect(argValueSchema(createArgSchema('custom')).codec.name).toBe('custom');
	});

	it('reads the flat fields back onto the value slots', () => {
		const value = argValueSchema(arg.path({ mustExist: true }).schema);
		expect(value.pathChecks).toEqual({ mustExist: true, type: undefined, create: false });
		expect(value.valueHint).toBe('path');
		expect(argValueSchema(arg.custom(standardNumber).schema).standard).toBe(standardNumber);
	});

	it('decodes through the projection exactly as the factory declared', () => {
		expect(decoded(argValueSchema(arg.bytes().schema), '1.5gb', 'token')).toBe(1_610_612_736);
	});
});

// === the stdin input

describe("the 'stdin' input", () => {
	const values: readonly (readonly [string, ValueSchema])[] = [
		['string', stringValue()],
		['number', numberValue()],
		['boolean', booleanValue()],
		['enum', enumValue(['a', 'b'])],
	];

	it('accepts exactly what env accepts, for every scalar codec', () => {
		const raws: readonly unknown[] = ['a', 'true', 'yes', 'y', '1', '0', '', 'b', 12, true, null];

		for (const [, value] of values) {
			for (const raw of raws) {
				const viaStdin = decodeValue(value, raw, 'stdin');
				const viaEnv = decodeValue(value, raw, 'env');
				expect(viaStdin).toEqual(viaEnv);
			}
		}
	});

	it('hands the string codec the buffer byte for byte', () => {
		expect(decoded(stringValue(), 'hello\n', 'stdin')).toBe('hello\n');
		expect(decoded(stringValue(), 'a\r\nb\r\n', 'stdin')).toBe('a\r\nb\r\n');
		expect(decoded(pathValue(), './out\n', 'stdin')).toBe('./out\n');
	});

	it('drops one trailing terminator before every other codec', () => {
		expect(decoded(numberValue(), '42\n', 'stdin')).toBe(42);
		expect(decoded(numberValue(), '42\r\n', 'stdin')).toBe(42);
		expect(decoded(numberValue(), '42\r', 'stdin')).toBe(42);
		expect(decoded(booleanValue(), 'true\n', 'stdin')).toBe(true);
		expect(decoded(enumValue(['us', 'eu']), 'eu\n', 'stdin')).toBe('eu');
		expect(decoded(durationValue(), '1h30m\n', 'stdin')).toBe(5_400_000);
		expect(decoded(bytesValue(), '512mb\n', 'stdin')).toBe(536_870_912);
	});

	it('drops only the last terminator', () => {
		expect(rejected(enumValue(['eu']), 'eu\n\n', 'stdin').kind).toBe('enum');
	});

	it('rejects the prompt-only boolean spellings', () => {
		expect(rejected(booleanValue(), 'y', 'stdin').kind).toBe('type');
		expect(rejected(booleanValue(), 'n\n', 'stdin').kind).toBe('type');
	});

	it('leaves a non-string raw untouched', () => {
		expect(decoded(numberValue(), 42, 'stdin')).toBe(42);
		expect(decoded(booleanValue(), true, 'stdin')).toBe(true);
	});
});
