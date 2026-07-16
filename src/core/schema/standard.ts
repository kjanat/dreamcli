/**
 * The Standard Schema v1 interface, vendored as types only.
 *
 * Mirrors the specification at https://standardschema.dev so validators from
 * zod, valibot, arktype, and any other conforming library can be passed to
 * `flag.custom()` / `arg.custom()` without adding a runtime dependency.
 *
 * @module
 */

/** A schema that conforms to the Standard Schema v1 specification. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	/** The Standard Schema properties, namespaced under a well-known key. */
	readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

/** Types copied from the Standard Schema v1 specification. */
export declare namespace StandardSchemaV1 {
	/** The properties exposed under a validator's `~standard` key. */
	export interface Props<Input = unknown, Output = Input> {
		/** The version number of the specification. */
		readonly version: 1;
		/** The vendor name of the schema library. */
		readonly vendor: string;
		/** Validate an unknown value, returning its output or the issues found. */
		readonly validate: (
			value: unknown,
			options?: Options | undefined,
		) => Result<Output> | Promise<Result<Output>>;
		/** Inferred input and output types, present only at the type level. */
		readonly types?: Types<Input, Output> | undefined;
	}

	/** Optional parameters passed to a validator. */
	export interface Options {
		/** Explicit support for vendor-specific validation parameters. */
		readonly libraryOptions?: Record<string, unknown> | undefined;
	}

	/** The result of validating a value: either its output or a list of issues. */
	export type Result<Output> = SuccessResult<Output> | FailureResult;

	/** A successful validation carrying the parsed output value. */
	export interface SuccessResult<Output> {
		/** The validated (and possibly transformed) value. */
		readonly value: Output;
		/** Absent on success. */
		readonly issues?: undefined;
	}

	/** A failed validation carrying validation issues. */
	export interface FailureResult {
		/** The issues that caused validation to fail. */
		readonly issues: ReadonlyArray<Issue>;
	}

	/** A single validation issue. */
	export interface Issue {
		/** The human-readable error message. */
		readonly message: string;
		/** The path to the offending value, when the validator reports one. */
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	/** One segment of an issue path. */
	export interface PathSegment {
		/** The key of this path segment. */
		readonly key: PropertyKey;
	}

	/** The type-level input and output carried by a validator. */
	export interface Types<Input = unknown, Output = Input> {
		/** The input type accepted by the validator. */
		readonly input: Input;
		/** The output type produced by the validator. */
		readonly output: Output;
	}

	/** Infer the input type of a Standard Schema validator. */
	export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
		Schema['~standard']['types']
	>['input'];

	/** Infer the output type of a Standard Schema validator. */
	export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
		Schema['~standard']['types']
	>['output'];
}

/** Backward-compatible flat alias for {@link StandardSchemaV1.Props}. */
export type StandardSchemaV1Props<Input = unknown, Output = Input> = StandardSchemaV1.Props<
	Input,
	Output
>;
/** Flat alias for {@link StandardSchemaV1.Options}. */
export type StandardSchemaV1Options = StandardSchemaV1.Options;
/** Flat alias for {@link StandardSchemaV1.Result}. */
export type StandardSchemaV1Result<Output> = StandardSchemaV1.Result<Output>;
/** Flat alias for {@link StandardSchemaV1.SuccessResult}. */
export type StandardSchemaV1SuccessResult<Output> = StandardSchemaV1.SuccessResult<Output>;
/** Flat alias for {@link StandardSchemaV1.FailureResult}. */
export type StandardSchemaV1FailureResult = StandardSchemaV1.FailureResult;
/** Flat alias for {@link StandardSchemaV1.Issue}. */
export type StandardSchemaV1Issue = StandardSchemaV1.Issue;
/** Flat alias for {@link StandardSchemaV1.PathSegment}. */
export type StandardSchemaV1PathSegment = StandardSchemaV1.PathSegment;
/** Backward-compatible flat alias for {@link StandardSchemaV1.Types}. */
export type StandardSchemaV1Types<Input = unknown, Output = Input> = StandardSchemaV1.Types<
	Input,
	Output
>;
/** Flat alias for {@link StandardSchemaV1.InferInput}. */
export type InferStandardInput<Schema extends StandardSchemaV1> =
	StandardSchemaV1.InferInput<Schema>;
/** Flat alias for {@link StandardSchemaV1.InferOutput}. */
export type InferStandardOutput<Schema extends StandardSchemaV1> =
	StandardSchemaV1.InferOutput<Schema>;

/**
 * Detect a Standard Schema validator without assuming validators are plain
 * objects. Some conforming libraries expose callable schema values.
 *
 * @internal
 */
function isStandardSchemaV1(value: unknown): value is StandardSchemaV1 {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
		return false;
	}
	if (!('~standard' in value)) {
		return false;
	}
	const properties = value['~standard'];
	return (
		properties !== null &&
		typeof properties === 'object' &&
		'version' in properties &&
		properties.version === 1 &&
		'validate' in properties &&
		typeof properties.validate === 'function'
	);
}

export { isStandardSchemaV1 };
