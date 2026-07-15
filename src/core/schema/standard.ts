/**
 * The Standard Schema v1 interface, vendored as types only.
 *
 * Mirrors the specification at https://standardschema.dev so validators from
 * zod, valibot, arktype, and any other conforming library can be passed to
 * `flag.custom()` / `arg.custom()` without adding a runtime dependency. Every
 * member is a type or interface, so this module erases to nothing at runtime.
 *
 * @module
 */

/** A schema that conforms to the Standard Schema v1 specification. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	/** The Standard Schema properties, namespaced under a well-known key. */
	readonly '~standard': StandardSchemaV1Props<Input, Output>;
}

/** The properties exposed under a validator's `~standard` key. */
export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
	/** The version number of the specification. */
	readonly version: 1;
	/** The vendor name of the schema library. */
	readonly vendor: string;
	/** Validate an unknown value, returning its output or the issues found. */
	readonly validate: (
		value: unknown,
	) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
	/** Inferred input and output types, present only at the type level. */
	readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

/** The result of validating a value: either its output or a list of issues. */
export type StandardSchemaV1Result<Output> =
	| StandardSchemaV1SuccessResult<Output>
	| StandardSchemaV1FailureResult;

/** A successful validation carrying the parsed output value. */
export interface StandardSchemaV1SuccessResult<Output> {
	/** The validated (and possibly transformed) value. */
	readonly value: Output;
	/** Absent on success. */
	readonly issues?: undefined;
}

/** A failed validation carrying a non-empty list of issues. */
export interface StandardSchemaV1FailureResult {
	/** The issues that caused validation to fail. */
	readonly issues: ReadonlyArray<StandardSchemaV1Issue>;
}

/** A single validation issue. */
export interface StandardSchemaV1Issue {
	/** The human-readable error message. */
	readonly message: string;
	/** The path to the offending value, when the validator reports one. */
	readonly path?: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined;
}

/** One segment of an issue path. */
export interface StandardSchemaV1PathSegment {
	/** The key of this path segment. */
	readonly key: PropertyKey;
}

/** The type-level input and output carried by a validator. */
export interface StandardSchemaV1Types<Input = unknown, Output = Input> {
	/** The input type accepted by the validator. */
	readonly input: Input;
	/** The output type produced by the validator. */
	readonly output: Output;
}

/** Infer the input type of a Standard Schema validator. */
export type InferStandardInput<Schema extends StandardSchemaV1> = NonNullable<
	Schema['~standard']['types']
>['input'];

/** Infer the output type of a Standard Schema validator. */
export type InferStandardOutput<Schema extends StandardSchemaV1> = NonNullable<
	Schema['~standard']['types']
>['output'];
