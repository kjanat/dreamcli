/**
 * Structured error types for DreamCLI.
 *
 * Base {@linkcode CLIError} carries stable code, exit code, suggestion, and structured
 * details. {@linkcode ParseError} and {@linkcode ValidationError} derive from it with
 * category-appropriate defaults.
 *
 * @module dreamcli/core/errors
 */

// --- Error codes — discriminated string union per category

/** Codes emitted during argv parsing. */
export type ParseErrorCode =
	| 'UNKNOWN_FLAG'
	| 'UNKNOWN_COMMAND'
	| 'MISSING_VALUE'
	| 'INVALID_VALUE'
	| 'INVALID_SCHEMA'
	| 'UNEXPECTED_POSITIONAL';

/** Codes emitted during post-parse validation / resolution. */
export type ValidationErrorCode =
	| 'REQUIRED_FLAG'
	| 'REQUIRED_ARG'
	| 'INVALID_ENUM'
	| 'TYPE_MISMATCH'
	| 'CONSTRAINT_VIOLATED';

/** Any framework error code (extensible via `string & {}`). */
// deno-lint-ignore ban-types
export type ErrorCode = ParseErrorCode | ValidationErrorCode | (string & {});

// --- Options bag for CLIError construction

/** Options accepted by the `CLIError` constructor. */
export interface CLIErrorOptions {
	/** Stable machine-readable identifier (e.g. `"UNKNOWN_FLAG"`). */
	readonly code: ErrorCode;
	/**
	 * Process exit code.
	 * @defaultValue `1`
	 */
	readonly exitCode?: number;
	/** One-liner actionable hint shown to the user. */
	readonly suggest?: string;
	/** Arbitrary structured payload (serialised in `--json` mode). */
	readonly details?: Readonly<Record<string, unknown>>;
	/** Original error, if this wraps another. */
	readonly cause?: unknown;
}

// --- CLIError — base structured error

/**
 * Base structured error for DreamCLI.
 *
 * Every error surfaced by the framework extends this class, ensuring a
 * consistent shape for rendering (TTY pretty-print, `--json`, test assertions).
 */
export class CLIError extends Error {
	/** Error class name, always `'CLIError'` for the base class. @override */
	override readonly name: string = 'CLIError';

	/** Stable machine-readable identifier. */
	readonly code: ErrorCode;

	/** Process exit code (defaults to `1`). */
	readonly exitCode: number;

	/** One-liner actionable hint. */
	readonly suggest: string | undefined;

	/** Structured payload for machine output. */
	readonly details: Readonly<Record<string, unknown>> | undefined;

	/** Create a structured CLI error from a human message and machine-readable options. */
	constructor(message: string, options: CLIErrorOptions) {
		super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
		this.code = options.code;
		this.exitCode = options.exitCode ?? 1;
		this.suggest = options.suggest;
		this.details = options.details;
	}

	/**
	 * Serialise to a plain object suitable for JSON output.
	 * @sealed
	 */
	toJSON(): CLIErrorJSON {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			exitCode: this.exitCode,
			...(this.suggest !== undefined && { suggest: this.suggest }),
			...(this.details !== undefined && { details: this.details }),
		};
	}
}

/** Shape returned by {@linkcode CLIError}.toJSON(). */
export interface CLIErrorJSON {
	/** Error class name (e.g. `'CLIError'`, `'ParseError'`). */
	readonly name: string;
	/** Stable machine-readable identifier for programmatic matching. */
	readonly code: ErrorCode;
	/** Human-readable description of what went wrong. */
	readonly message: string;
	/** Process exit code associated with this error. */
	readonly exitCode: number;
	/** Actionable hint shown to the user, when available. */
	readonly suggest?: string;
	/** Structured payload for machine consumers, when available. */
	readonly details?: Readonly<Record<string, unknown>>;
}

// --- ParseError — argv parsing failures

/** Options for {@linkcode ParseError}. Code is narrowed to parse-specific codes. */
export interface ParseErrorOptions extends Omit<CLIErrorOptions, 'code' | 'exitCode'> {
	/** Parse-category error code (e.g. `'UNKNOWN_FLAG'`, `'MISSING_VALUE'`). */
	readonly code: ParseErrorCode;
	/**
	 * Process exit code for parse failures.
	 * @defaultValue `2`
	 */
	readonly exitCode?: number;
}

/**
 * Error thrown when argv tokenization / parsing fails.
 *
 * Exit code defaults to `2` (standard for CLI usage errors).
 */
export class ParseError extends CLIError {
	/** Always `'ParseError'`. @override */
	override readonly name = 'ParseError' as const;
	/** Narrowed to parse-category codes. */
	declare readonly code: ParseErrorCode;

	/** Create a parse error with exit code defaulting to `2`. */
	constructor(message: string, options: ParseErrorOptions) {
		super(message, { ...options, exitCode: options.exitCode ?? 2 });
	}
}

// --- ValidationError — post-parse validation / resolution failures

/** Options for {@linkcode ValidationError}. Code is narrowed to validation-specific codes. */
export interface ValidationErrorOptions extends Omit<CLIErrorOptions, 'code' | 'exitCode'> {
	/** Validation-category error code (e.g. `'REQUIRED_FLAG'`, `'INVALID_ENUM'`). */
	readonly code: ValidationErrorCode;
	/**
	 * Process exit code for validation failures.
	 * @defaultValue `2`
	 */
	readonly exitCode?: number;
}

/**
 * Error thrown when resolved values fail validation constraints.
 *
 * Exit code defaults to `2` (standard for CLI usage errors).
 */
export class ValidationError extends CLIError {
	/** Always `'ValidationError'`. @override */
	override readonly name = 'ValidationError' as const;
	/** Narrowed to validation-category codes. */
	declare readonly code: ValidationErrorCode;

	/** Create a validation error with exit code defaulting to `2`. */
	constructor(message: string, options: ValidationErrorOptions) {
		super(message, { ...options, exitCode: options.exitCode ?? 2 });
	}
}

// --- Type guard utilities

/** Narrows an unknown value to `CLIError`. */
export function isCLIError(value: unknown): value is CLIError {
	return value instanceof CLIError;
}

/** Narrows an unknown value to `ParseError`. */
export function isParseError(value: unknown): value is ParseError {
	return value instanceof ParseError;
}

/** Narrows an unknown value to `ValidationError`. */
export function isValidationError(value: unknown): value is ValidationError {
	return value instanceof ValidationError;
}
