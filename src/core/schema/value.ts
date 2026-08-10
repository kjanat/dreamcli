/**
 * The value axis shared by the `flag` and `arg` factories.
 *
 * A {@link ValueSchema} carries what a raw token or source value decodes to and
 * what the decoded value must satisfy: a {@link ValueCodec}, string or number
 * constraints, a Standard Schema validator, filesystem checks, and the help
 * placeholder. Both factories build their definitions from one of these, and
 * the parse and resolve pipelines read the value axis through
 * {@link flagValueSchema} / {@link argValueSchema} rather than off the flat
 * schema fields.
 *
 * Decoding reports a {@link ValueFailure} describing the value problem alone.
 * Naming the flag or argument that carried the value belongs to the caller.
 *
 * @module dreamcli/core/schema/value
 * @internal
 */

import type { ArgSchema } from './arg.ts';
import type { FlagSchema } from './flag.ts';
import {
	type NumberConstraints,
	type NumberConstraintViolation,
	validateNumberConstraints,
} from './number-constraints.ts';
import type { StandardSchemaV1 } from './standard.ts';
import {
	type StringConstraints,
	type StringConstraintViolation,
	validateStringConstraints,
} from './string-constraints.ts';
import {
	buildPathChecks,
	type DateFlagOptions,
	type PathChecks,
	type PathFlagOptions,
	parseBytesValue,
	parseDateValue,
	parseDurationValue,
	parseUrlValue,
	type UrlFlagOptions,
} from './value-parsers.ts';

// --- Decoding contract

/**
 * Which surface handed a raw value to the value layer.
 *
 * `'token'` is a CLI argv token; the rest name the resolver stage that produced
 * the value. Codecs widen what they accept as the input gets further from argv.
 * `'stdin'` accepts exactly what `'env'` accepts: both deliver a raw string a
 * user typed outside argv, so neither gets the extra latitude a prompt answer
 * or a typed config value gets.
 */
type ValueInput = 'token' | 'stdin' | 'env' | 'config' | 'prompt';

/** The primitive a codec could not read a raw value as. */
type ValueTypeName = 'string' | 'number' | 'boolean';

/** Why decoding rejected a raw value. */
type ValueFailure =
	| { readonly kind: 'type'; readonly expected: ValueTypeName }
	| { readonly kind: 'enum'; readonly enumValues: readonly string[] | undefined }
	| {
			readonly kind: 'string-constraint';
			readonly value: string;
			readonly violation: StringConstraintViolation;
	  }
	| {
			readonly kind: 'number-constraint';
			readonly value: number;
			readonly violation: NumberConstraintViolation;
	  }
	| { readonly kind: 'thrown'; readonly error: unknown };

/** The outcome of decoding one raw value. */
type ValueResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly failure: ValueFailure };

/** Reads one raw value from one input surface into a typed value. */
type ValueDecoder<T> = (raw: unknown, input: ValueInput) => ValueResult<T>;

/** The narrowest shape every surface's parse function satisfies. */
type ValueParseFn = (raw: never) => unknown;

/** How a raw value becomes a typed one, plus the data the definition round-trip needs. */
type ValueCodec<T = unknown, P = ValueParseFn> =
	| { readonly name: 'string'; readonly decode: ValueDecoder<T> }
	| { readonly name: 'number'; readonly decode: ValueDecoder<T> }
	| { readonly name: 'boolean'; readonly decode: ValueDecoder<T> }
	| {
			readonly name: 'enum';
			readonly enumValues: readonly string[] | undefined;
			readonly decode: ValueDecoder<T>;
	  }
	| {
			readonly name: 'custom';
			readonly parseFn: P | undefined;
			readonly decode: ValueDecoder<T>;
	  };

/** Rules a decoded value must satisfy, discriminated by the codec that produced it. */
type ValueConstraints =
	| { readonly kind: 'string'; readonly stringConstraints: StringConstraints | undefined }
	| { readonly kind: 'number'; readonly numberConstraints: NumberConstraints | undefined };

/** Everything the value axis of a flag or an arg carries. */
interface ValueSchema<T = unknown, P = ValueParseFn> {
	/** How a raw value becomes a typed one. */
	readonly codec: ValueCodec<T, P>;
	/** Rules the decoded value must satisfy, or `undefined` when the codec has none. */
	readonly constraints: ValueConstraints | undefined;
	/** Standard Schema v1 validator applied to the resolved value. */
	readonly standard: StandardSchemaV1 | undefined;
	/** Filesystem checks applied to the resolved value. */
	readonly pathChecks: PathChecks | undefined;
	/** Help placeholder label (`'url'` renders as `<url>`). */
	readonly valueHint: string | undefined;
}

/** The flat definition fields a {@link ValueSchema} contributes to a flag or arg definition. */
interface ValueDefinitionFields<P = ValueParseFn> {
	/** String constraints, when the codec is `'string'` and any were declared. */
	readonly stringConstraints?: StringConstraints;
	/** Numeric constraints, when the codec is `'number'` and any were declared. */
	readonly numberConstraints?: NumberConstraints;
	/** Parse function, when the codec is `'custom'` and one was supplied. */
	readonly parseFn?: P;
	/** Standard Schema v1 validator, when one was supplied. */
	readonly standard?: StandardSchemaV1;
	/** Filesystem checks, when any were declared. */
	readonly pathChecks?: PathChecks;
	/** Help placeholder label, when the factory set one. */
	readonly valueHint?: string;
}

// --- Codecs

const STRING_TYPE_FAILURE: ValueResult<never> = {
	ok: false,
	failure: { kind: 'type', expected: 'string' },
};

const NUMBER_TYPE_FAILURE: ValueResult<never> = {
	ok: false,
	failure: { kind: 'type', expected: 'number' },
};

const BOOLEAN_TYPE_FAILURE: ValueResult<never> = {
	ok: false,
	failure: { kind: 'type', expected: 'boolean' },
};

/**
 * Reads a raw value as a string.
 *
 * A prompt answer and a config scalar are stringified, since a prompt engine
 * may hand back a non-string answer and a config file may hold `8080` where a
 * string is declared. Argv tokens and env values are already strings.
 */
const stringCodec: ValueCodec<string> = {
	name: 'string',
	decode(raw, input) {
		if (typeof raw === 'string') return { ok: true, value: raw };
		if (input === 'prompt') return { ok: true, value: String(raw) };
		if (input === 'config' && (typeof raw === 'number' || typeof raw === 'boolean')) {
			return { ok: true, value: String(raw) };
		}
		return STRING_TYPE_FAILURE;
	},
};

/** Reads a raw value as a number, rejecting `NaN` from every input. */
const numberCodec: ValueCodec<number> = {
	name: 'number',
	decode(raw) {
		if (typeof raw === 'number') {
			return Number.isNaN(raw) ? NUMBER_TYPE_FAILURE : { ok: true, value: raw };
		}
		if (typeof raw === 'string') {
			const value = Number(raw);
			if (!Number.isNaN(value)) return { ok: true, value };
		}
		return NUMBER_TYPE_FAILURE;
	},
};

/**
 * Reads a raw value as a boolean.
 *
 * An argv token spells the value out as `true`/`false` or `1`/`0`. Stdin, env,
 * config, and prompt inputs also accept `yes`/`no`, an already-boolean value,
 * and an empty string for `false`; a prompt answer additionally accepts
 * `y`/`n`.
 */
const booleanCodec: ValueCodec<boolean> = {
	name: 'boolean',
	decode(raw, input) {
		if (input === 'token') {
			if (raw === 'true' || raw === '1') return { ok: true, value: true };
			if (raw === 'false' || raw === '0') return { ok: true, value: false };
			return BOOLEAN_TYPE_FAILURE;
		}
		if (typeof raw === 'boolean') return { ok: true, value: raw };
		if (typeof raw === 'string') {
			const lower = raw.toLowerCase();
			if (
				lower === 'true' ||
				lower === '1' ||
				lower === 'yes' ||
				(input === 'prompt' && lower === 'y')
			) {
				return { ok: true, value: true };
			}
			if (
				lower === 'false' ||
				lower === '0' ||
				lower === 'no' ||
				lower === '' ||
				(input === 'prompt' && lower === 'n')
			) {
				return { ok: true, value: false };
			}
		}
		return BOOLEAN_TYPE_FAILURE;
	},
};

/** Reads a raw value as one of the declared literals. */
function enumCodec(enumValues: readonly string[] | undefined): ValueCodec<string> {
	return {
		name: 'enum',
		enumValues,
		decode(raw) {
			if (typeof raw === 'string' && enumValues?.includes(raw) === true) {
				return { ok: true, value: raw };
			}
			return { ok: false, failure: { kind: 'enum', enumValues } };
		},
	};
}

/** Passes a raw value through untouched, for a custom value with no parse function. */
const passthroughCodec: ValueCodec<unknown, never> = {
	name: 'custom',
	parseFn: undefined,
	decode(raw) {
		return { ok: true, value: raw };
	},
};

/** Reads a raw value through a parse function that accepts any raw source value. */
function parsedCodec<P extends (raw: unknown) => unknown>(parseFn: P): ValueCodec<unknown, P> {
	return {
		name: 'custom',
		parseFn,
		decode(raw) {
			try {
				return { ok: true, value: parseFn(raw) };
			} catch (error) {
				return { ok: false, failure: { kind: 'thrown', error } };
			}
		},
	};
}

/**
 * Reads a raw value through a parse function that only ever receives strings.
 *
 * A config file may hold a number where a string-parsed value is declared, so a
 * non-string raw is stringified before the parse function sees it.
 */
function stringParsedCodec<P extends (raw: string) => unknown>(parseFn: P): ValueCodec<unknown, P> {
	return {
		name: 'custom',
		parseFn,
		decode(raw) {
			try {
				return { ok: true, value: parseFn(typeof raw === 'string' ? raw : String(raw)) };
			} catch (error) {
				return { ok: false, failure: { kind: 'thrown', error } };
			}
		},
	};
}

// --- Decoding

/**
 * Decode a raw value and apply the constraints riding on the value schema.
 *
 * The single entry point both the parse boundary and the resolver coercion
 * boundary use, so the two cannot drift on what a value means.
 *
 * @param value - The value axis of the flag or arg receiving the raw value.
 * @param raw - The raw token, env string, config value, or prompt answer.
 * @param input - Which surface produced `raw`.
 * @returns The decoded value, or the {@link ValueFailure} that rejected it.
 */
function decodeValue(value: ValueSchema, raw: unknown, input: ValueInput): ValueResult<unknown> {
	const decoded = value.codec.decode(stdinDecodeInput(value, raw, input), input);
	if (!decoded.ok) return decoded;
	const failure = checkValueConstraints(value.constraints, decoded.value);
	return failure === undefined ? decoded : { ok: false, failure };
}

/**
 * Drop the line terminator a pipe appends, for every codec that reads the text
 * rather than keeping it.
 *
 * The stdin source hands over the buffer byte for byte, so `'hello\n'` stays
 * `'hello\n'` under the string codec. Every other codec interprets the text,
 * where a trailing terminator is framing rather than value: `'42\n'` is the
 * number 42, `'true\n'` the boolean `true`, `'30s\n'` a duration.
 *
 * @param value - The value schema about to read the value.
 * @param raw - The raw value the source produced.
 * @param input - Which surface produced `raw`.
 * @returns The value to decode.
 */
function stdinDecodeInput(value: ValueSchema, raw: unknown, input: ValueInput): unknown {
	if (
		input !== 'stdin' ||
		(value.codec.name === 'string' && value.valueHint !== 'path') ||
		typeof raw !== 'string'
	) {
		return raw;
	}
	if (raw.endsWith('\r\n')) return raw.slice(0, -2);
	if (raw.endsWith('\n') || raw.endsWith('\r')) return raw.slice(0, -1);
	return raw;
}

/**
 * Apply the constraints a value schema carries to a value that skipped decoding.
 *
 * A declared default is already the typed value, so it is validated rather than
 * read from a raw source. Standard Schema and filesystem checks ride on the
 * value schema separately and stay with their own passes.
 *
 * @param value - The value axis declaring the constraints.
 * @param decoded - The already-typed value to check.
 * @returns The {@link ValueFailure} that rejected it, or `undefined` when it passes.
 */
function validateDecodedValue(value: ValueSchema, decoded: unknown): ValueFailure | undefined {
	return checkValueConstraints(value.constraints, decoded);
}

/** Apply the constraints a value schema carries to an already-decoded value. */
function checkValueConstraints(
	constraints: ValueConstraints | undefined,
	value: unknown,
): ValueFailure | undefined {
	if (constraints === undefined) return undefined;
	if (constraints.kind === 'string') {
		if (typeof value !== 'string') return undefined;
		const violation = validateStringConstraints(value, constraints.stringConstraints);
		return violation === undefined ? undefined : { kind: 'string-constraint', value, violation };
	}
	if (typeof value !== 'number') return undefined;
	const violation = validateNumberConstraints(value, constraints.numberConstraints);
	return violation === undefined ? undefined : { kind: 'number-constraint', value, violation };
}

// --- Value constructors used by both factories

/** Assemble a value schema, defaulting every slot the caller does not set. */
function makeValue<T, P>(
	codec: ValueCodec<T, P>,
	slots?: {
		readonly constraints?: ValueConstraints;
		readonly standard?: StandardSchemaV1;
		readonly pathChecks?: PathChecks;
		readonly valueHint?: string;
	},
): ValueSchema<T, P> {
	return {
		codec,
		constraints: slots?.constraints,
		standard: slots?.standard,
		pathChecks: slots?.pathChecks,
		valueHint: slots?.valueHint,
	};
}

/** A string value, optionally constrained. */
function stringValue(stringConstraints?: StringConstraints): ValueSchema<string> {
	return makeValue(stringCodec, { constraints: { kind: 'string', stringConstraints } });
}

/** A number value, optionally constrained. Finiteness applies with or without constraints. */
function numberValue(numberConstraints?: NumberConstraints): ValueSchema<number> {
	return makeValue(numberCodec, { constraints: { kind: 'number', numberConstraints } });
}

/** A boolean value. */
function booleanValue(): ValueSchema<boolean> {
	return makeValue(booleanCodec);
}

/** A value restricted to the declared literals. */
function enumValue(enumValues: readonly string[] | undefined): ValueSchema<string> {
	return makeValue(enumCodec(enumValues));
}

/** A value produced by a flag-style parse function, which accepts any raw source value. */
function customValue<P extends (raw: unknown) => unknown>(parseFn: P): ValueSchema<unknown, P> {
	return makeValue(parsedCodec(parseFn));
}

/** A value produced by an arg-style parse function, which only ever receives strings. */
function stringParsedValue<P extends (raw: string) => unknown>(
	parseFn: P,
): ValueSchema<unknown, P> {
	return makeValue(stringParsedCodec(parseFn));
}

/** A value validated by a Standard Schema v1 validator instead of a parse function. */
function standardValue(standard: StandardSchemaV1): ValueSchema<unknown, never> {
	return makeValue(passthroughCodec, { standard });
}

/** A value passed through untouched. */
function passthroughValue(): ValueSchema<unknown, never> {
	return makeValue(passthroughCodec);
}

/** A `URL` value, optionally restricted to an allowlist of protocols. */
function urlValue(options?: UrlFlagOptions): ValueSchema<unknown, (raw: unknown) => URL> {
	return makeValue(
		parsedCodec((raw: unknown) => parseUrlValue(raw, options)),
		{
			valueHint: 'url',
		},
	);
}

/** A path string, with the filesystem checks the options ask for. */
function pathValue(options?: PathFlagOptions): ValueSchema<string> {
	const pathChecks = buildPathChecks(options);
	return makeValue(stringCodec, {
		constraints: { kind: 'string', stringConstraints: undefined },
		valueHint: 'path',
		...(pathChecks !== undefined ? { pathChecks } : {}),
	});
}

/** A `Date` value parsed from strict ISO-8601, optionally bounded. */
function dateValue(options?: DateFlagOptions): ValueSchema<unknown, (raw: unknown) => Date> {
	return makeValue(
		parsedCodec((raw: unknown) => parseDateValue(raw, options)),
		{
			valueHint: 'date',
		},
	);
}

/** A duration in milliseconds. */
function durationValue(): ValueSchema<unknown, (raw: unknown) => number> {
	return makeValue(parsedCodec(parseDurationValue), { valueHint: 'duration' });
}

/** A size in bytes. */
function bytesValue(): ValueSchema<unknown, (raw: unknown) => number> {
	return makeValue(parsedCodec(parseBytesValue), { valueHint: 'size' });
}

// --- Projections

/**
 * Flatten a value schema into the definition fields a factory passes to
 * `createFlagSchema()` / `createArgSchema()`.
 *
 * `enumValues` is not among them. Both enum definitions declare that field as
 * required, which an all-optional record cannot satisfy, so the enum factories
 * pass it directly.
 *
 * @param value - The value axis to flatten.
 * @returns Only the fields the value actually declares.
 */
function valueDefinitionFields<T, P>(value: ValueSchema<T, P>): ValueDefinitionFields<P> {
	const constraints = value.constraints;
	const codec = value.codec;
	return {
		...(constraints?.kind === 'string' && constraints.stringConstraints !== undefined
			? { stringConstraints: constraints.stringConstraints }
			: {}),
		...(constraints?.kind === 'number' && constraints.numberConstraints !== undefined
			? { numberConstraints: constraints.numberConstraints }
			: {}),
		...(codec.name === 'custom' && codec.parseFn !== undefined ? { parseFn: codec.parseFn } : {}),
		...(value.standard !== undefined ? { standard: value.standard } : {}),
		...(value.pathChecks !== undefined ? { pathChecks: value.pathChecks } : {}),
		...(value.valueHint !== undefined ? { valueHint: value.valueHint } : {}),
	};
}

/**
 * Project a flag schema onto its value axis.
 *
 * @param schema - The flag schema to read.
 * @returns The value axis, or `undefined` for the collection kinds (`array`,
 *   `count`, `keyValue`), whose values live on the cardinality axis.
 */
function flagValueSchema(schema: FlagSchema): ValueSchema | undefined {
	const base = flagBaseValue(schema);
	if (base === undefined) return undefined;
	return {
		...base,
		standard: schema.standard,
		pathChecks: schema.pathChecks,
		valueHint: schema.valueHint,
	};
}

/** Rebuild the value a flag kind was declared with, from the flat schema fields. */
function flagBaseValue(schema: FlagSchema): ValueSchema | undefined {
	switch (schema.kind) {
		case 'string':
			return stringValue(schema.stringConstraints);
		case 'number':
			return numberValue(schema.numberConstraints);
		case 'boolean':
			return booleanValue();
		case 'enum':
			return enumValue(schema.enumValues);
		case 'custom':
			return schema.parseFn === undefined ? passthroughValue() : customValue(schema.parseFn);
		case 'array':
		case 'count':
		case 'keyValue':
			return undefined;
	}
}

/**
 * Project an arg schema onto its value axis.
 *
 * @param schema - The arg schema to read.
 * @returns The value axis. Every arg kind carries one.
 */
function argValueSchema(schema: ArgSchema): ValueSchema {
	return {
		...argBaseValue(schema),
		standard: schema.standard,
		pathChecks: schema.pathChecks,
		valueHint: schema.valueHint,
	};
}

/** Rebuild the value an arg kind was declared with, from the flat schema fields. */
function argBaseValue(schema: ArgSchema): ValueSchema {
	switch (schema.kind) {
		case 'string':
			return stringValue(schema.stringConstraints);
		case 'number':
			return numberValue(schema.numberConstraints);
		case 'enum':
			return enumValue(schema.enumValues);
		case 'custom':
			return schema.parseFn === undefined ? passthroughValue() : stringParsedValue(schema.parseFn);
	}
}

/** The literals an enum value allows, or `undefined` for every other codec. */
function valueEnumValues(value: ValueSchema | undefined): readonly string[] | undefined {
	return value?.codec.name === 'enum' ? value.codec.enumValues : undefined;
}

export type {
	ValueCodec,
	ValueConstraints,
	ValueDecoder,
	ValueDefinitionFields,
	ValueFailure,
	ValueInput,
	ValueParseFn,
	ValueResult,
	ValueSchema,
	ValueTypeName,
};
export {
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
};
