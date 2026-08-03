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
	describeNumberConstraintViolation,
	type NumberConstraints,
	type NumberConstraintViolation,
	validateNumberConstraints,
} from './number-constraints.ts';
import type { StandardSchemaV1 } from './standard.ts';
import {
	describeStringConstraintViolation,
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

/** Reads a raw value as a string, rejecting every other type from every input. */
const strictStringCodec: ValueCodec<string> = {
	name: 'string',
	decode(raw) {
		return typeof raw === 'string' ? { ok: true, value: raw } : STRING_TYPE_FAILURE;
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
 * @param value - The value axis about to read the value.
 * @param raw - The raw value the source produced.
 * @param input - Which surface produced `raw`.
 * @returns The value to decode.
 */
function stdinDecodeInput(value: ValueSchema, raw: unknown, input: ValueInput): unknown {
	if (input !== 'stdin' || keepsStdinTerminator(value) || typeof raw !== 'string') return raw;
	return stripTerminator(raw);
}

/**
 * Drop the line terminator a pipe appends.
 *
 * @param text - The raw stdin buffer.
 * @returns The text without its single trailing terminator.
 */
function stripTerminator(text: string): string {
	if (text.endsWith('\r\n')) return text.slice(0, -2);
	if (text.endsWith('\n') || text.endsWith('\r')) return text.slice(0, -1);
	return text;
}

/**
 * Whether decoding leaves the line terminator a pipe appends on the value.
 *
 * @param value - The value axis about to read a stdin buffer.
 * @returns `true` when the terminator survives decoding.
 */
function keepsStdinTerminator(value: ValueSchema): boolean {
	return value.codec.name === 'string';
}

/**
 * Check a value that skipped decoding against everything the codec would have
 * produced and the constraints would have enforced.
 *
 * A declared default is already the typed value, so it is validated rather than
 * read from a raw source: it must lie in the codec's own output domain, and it
 * must satisfy the constraints. Standard Schema and filesystem checks ride on
 * the value schema separately and stay with their own passes.
 *
 * @param value - The value axis declaring the codec and the constraints.
 * @param decoded - The already-typed value to check.
 * @returns The {@link ValueFailure} that rejected it, or `undefined` when it passes.
 */
function validateDecodedValue(value: ValueSchema, decoded: unknown): ValueFailure | undefined {
	return (
		checkValueDomain(value.codec, decoded) ?? checkValueConstraints(value.constraints, decoded)
	);
}

/**
 * Check that a value lies in the domain a codec produces.
 *
 * A `custom` codec's output is whatever its parse function returns, so it has
 * no domain to check. `NaN` is left to the number constraints, which reject it
 * with the reason a reader can act on.
 *
 * @param codec - The codec the value claims to belong to.
 * @param value - The already-typed value to check.
 * @returns The {@link ValueFailure} that rejected it, or `undefined` when it passes.
 */
function checkValueDomain(codec: ValueCodec, value: unknown): ValueFailure | undefined {
	switch (codec.name) {
		case 'string':
			return typeof value === 'string' ? undefined : { kind: 'type', expected: 'string' };
		case 'number':
			return typeof value === 'number' ? undefined : { kind: 'type', expected: 'number' };
		case 'boolean':
			return typeof value === 'boolean' ? undefined : { kind: 'type', expected: 'boolean' };
		case 'enum':
			return typeof value === 'string' && codec.enumValues?.includes(value) === true
				? undefined
				: { kind: 'enum', enumValues: codec.enumValues };
		case 'custom':
			return undefined;
	}
}

/**
 * Describe a value failure in the words a message can carry.
 *
 * The subject the value belonged to is the caller's to name.
 *
 * @param failure - What the value layer rejected.
 * @returns One clause stating the problem.
 */
function describeValueFailure(failure: ValueFailure): string {
	switch (failure.kind) {
		case 'type':
			return `expected a ${failure.expected}`;
		case 'enum':
			return `expected one of: ${(failure.enumValues ?? []).join(', ')}`;
		case 'string-constraint':
			return describeStringConstraintViolation(failure.violation);
		case 'number-constraint':
			return describeNumberConstraintViolation(failure.violation);
		case 'thrown':
			return failure.error instanceof Error ? failure.error.message : String(failure.error);
	}
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

/**
 * A string value that accepts nothing but a string, from every input.
 *
 * The implicit element of an entries collection, whose values are strings on
 * every source rather than a config scalar a string codec would stringify.
 */
function strictStringValue(): ValueSchema<string> {
	return makeValue(strictStringCodec, {
		constraints: { kind: 'string', stringConstraints: undefined },
	});
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
 * A collection projects onto the value of each ELEMENT, so `flag.array()` and
 * `flag.keyValue()` read their element schema's codec, constraints, validator,
 * and path checks here. What the completed collection must satisfy lives on the
 * cardinality axis and is read through {@link flagAggregateStandard}.
 *
 * @param schema - The flag schema to read.
 * @returns The value axis of one value of the flag.
 */
function flagValueSchema(schema: FlagSchema): ValueSchema {
	switch (schema.kind) {
		case 'string':
			return scalarValue(schema, stringValue(schema.stringConstraints));
		case 'number':
			return scalarValue(schema, numberValue(schema.numberConstraints));
		case 'boolean':
			return scalarValue(schema, booleanValue());
		case 'enum':
			return scalarValue(schema, enumValue(schema.enumValues));
		case 'custom':
			return scalarValue(
				schema,
				schema.parseFn === undefined ? passthroughValue() : customValue(schema.parseFn),
			);
		case 'array':
			return elementValue(schema, passthroughValue);
		case 'keyValue':
			return elementValue(schema, strictStringValue);
		case 'count':
			return scalarValue(schema, numberValue({ int: true, min: 0 }));
	}
}

/**
 * Standard Schema validator applied to a flag's completed collection.
 *
 * @param schema - The flag schema to read.
 * @returns The aggregate validator, or `undefined` for a scalar flag, whose
 *   validator is the element's.
 */
function flagAggregateStandard(schema: FlagSchema): StandardSchemaV1 | undefined {
	return schema.aggregateStandard;
}

/**
 * Project an arg schema onto its value axis.
 *
 * An entries arg projects onto the value of each ENTRY, so
 * `arg.keyValue(arg.number())` reads its element schema's codec, constraints,
 * validator, and path checks here. What the completed record must satisfy lives
 * on the cardinality axis and is read through {@link argAggregateStandard}.
 *
 * @param schema - The arg schema to read.
 * @returns The value axis of one value of the arg.
 */
function argValueSchema(schema: ArgSchema): ValueSchema {
	switch (schema.kind) {
		case 'string':
			return scalarValue(schema, stringValue(schema.stringConstraints));
		case 'number':
			return scalarValue(schema, numberValue(schema.numberConstraints));
		case 'boolean':
			return scalarValue(schema, booleanValue());
		case 'enum':
			return scalarValue(schema, enumValue(schema.enumValues));
		case 'custom':
			return scalarValue(
				schema,
				schema.parseFn === undefined ? passthroughValue() : stringParsedValue(schema.parseFn),
			);
		case 'keyValue':
			return argElementValue(schema);
	}
}

/**
 * Project an entries arg's element schema, or the implicit string element it
 * declares none for.
 *
 * A validator on the arg itself is the element's when the element declares
 * none, which is how a definition-built `{ kind: 'keyValue', standard }`
 * validates each entry value.
 *
 * @param schema - The entries arg schema.
 * @returns The value axis of one entry value.
 */
function argElementValue(schema: ArgSchema): ValueSchema {
	const element =
		schema.elementSchema === undefined ? strictStringValue() : argValueSchema(schema.elementSchema);
	return element.standard === undefined && schema.standard !== undefined
		? { ...element, standard: schema.standard }
		: element;
}

/**
 * Standard Schema validator applied to an arg's completed collection.
 *
 * @param schema - The arg schema to read.
 * @returns The aggregate validator, or `undefined` when none was declared on
 *   the collection itself.
 */
function argAggregateStandard(schema: ArgSchema): StandardSchemaV1 | undefined {
	return schema.aggregateStandard;
}

/** Attach the element-level slots a schema carries alongside its codec. */
function scalarValue(
	schema: {
		readonly standard: StandardSchemaV1 | undefined;
		readonly pathChecks: PathChecks | undefined;
		readonly valueHint: string | undefined;
	},
	base: ValueSchema,
): ValueSchema {
	return {
		...base,
		standard: schema.standard,
		pathChecks: schema.pathChecks,
		valueHint: schema.valueHint,
	};
}

/**
 * Project a collection's element schema, or the implicit element it declares
 * none for.
 *
 * A validator on the collection itself is the element's when the element
 * declares none, so a definition-built `{ kind: 'array', standard }` validates
 * each element exactly as a variadic arg's own `standard` does.
 *
 * @param schema - The collection flag schema.
 * @param implicit - The element value used when no element schema is declared.
 * @returns The value axis of one element.
 */
function elementValue(schema: FlagSchema, implicit: () => ValueSchema): ValueSchema {
	const element =
		schema.elementSchema === undefined ? implicit() : flagValueSchema(schema.elementSchema);
	return element.standard === undefined && schema.standard !== undefined
		? { ...element, standard: schema.standard }
		: element;
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
	argAggregateStandard,
	argValueSchema,
	booleanValue,
	bytesValue,
	customValue,
	dateValue,
	decodeValue,
	describeValueFailure,
	durationValue,
	enumValue,
	flagAggregateStandard,
	flagValueSchema,
	keepsStdinTerminator,
	numberValue,
	passthroughValue,
	pathValue,
	standardValue,
	strictStringValue,
	stringParsedValue,
	stringValue,
	stripTerminator,
	urlValue,
	validateDecodedValue,
	valueDefinitionFields,
	valueEnumValues,
};
