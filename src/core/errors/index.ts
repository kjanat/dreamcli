/**
 * Structured error types for DreamCLI.
 *
 * Base `CLIError` carries stable code, exit code, suggestion, and structured
 * details. `ParseError` and `ValidationError` derive from it with
 * category-appropriate defaults.
 *
 * @module dreamcli/core/errors
 */

// ---------------------------------------------------------------------------
// Error codes — discriminated string union per category
// ---------------------------------------------------------------------------

/** Codes emitted during argv parsing. */
export type ParseErrorCode =
	| 'UNKNOWN_FLAG'
	| 'UNKNOWN_COMMAND'
	| 'MISSING_VALUE'
	| 'INVALID_VALUE'
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

// ---------------------------------------------------------------------------
// Options bag for CLIError construction
// ---------------------------------------------------------------------------

/** Options accepted by the `CLIError` constructor. */
export interface CLIErrorOptions {
	/** Stable machine-readable identifier (e.g. `"UNKNOWN_FLAG"`). */
	readonly code: ErrorCode;
	/**
	 * Process exit code.
	 * @default 1
	 */
	readonly exitCode?: number;
	/** One-liner actionable hint shown to the user. */
	readonly suggest?: string;
	/** Arbitrary structured payload (serialised in `--json` mode). */
	readonly details?: Readonly<Record<string, unknown>>;
	/** Original error, if this wraps another. */
	readonly cause?: unknown;
}

// ---------------------------------------------------------------------------
// CLIError — base structured error
// ---------------------------------------------------------------------------

/**
 * Base structured error for DreamCLI.
 *
 * Every error surfaced by the framework extends this class, ensuring a
 * consistent shape for rendering (TTY pretty-print, `--json`, test assertions).
 */
export class CLIError extends Error {
	override readonly name: string = 'CLIError';

	/** Stable machine-readable identifier. */
	readonly code: ErrorCode;

	/** Process exit code (defaults to `1`). */
	readonly exitCode: number;

	/** One-liner actionable hint. */
	readonly suggest: string | undefined;

	/** Structured payload for machine output. */
	readonly details: Readonly<Record<string, unknown>> | undefined;

	constructor(message: string, options: CLIErrorOptions) {
		super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
		this.code = options.code;
		this.exitCode = options.exitCode ?? 1;
		this.suggest = options.suggest;
		this.details = options.details;
	}

	/** Serialise to a plain object suitable for JSON output. */
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

/** Shape returned by `CLIError.toJSON()`. */
export interface CLIErrorJSON {
	readonly name: string;
	readonly code: ErrorCode;
	readonly message: string;
	readonly exitCode: number;
	readonly suggest?: string;
	readonly details?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// ParseError — argv parsing failures
// ---------------------------------------------------------------------------

/** Options for `ParseError`. Code is narrowed to parse-specific codes. */
export interface ParseErrorOptions extends Omit<CLIErrorOptions, 'code' | 'exitCode'> {
	readonly code: ParseErrorCode;
	/**
	 * @default 2
	 */
	readonly exitCode?: number;
}

/**
 * Error thrown when argv tokenization / parsing fails.
 *
 * Exit code defaults to `2` (standard for CLI usage errors).
 */
export class ParseError extends CLIError {
	override readonly name = 'ParseError' as const;
	declare readonly code: ParseErrorCode;

	constructor(message: string, options: ParseErrorOptions) {
		super(message, { ...options, exitCode: options.exitCode ?? 2 });
	}
}

// ---------------------------------------------------------------------------
// ValidationError — post-parse validation / resolution failures
// ---------------------------------------------------------------------------

/** Options for `ValidationError`. Code is narrowed to validation-specific codes. */
export interface ValidationErrorOptions extends Omit<CLIErrorOptions, 'code' | 'exitCode'> {
	readonly code: ValidationErrorCode;
	/**
	 * @default 2
	 */
	readonly exitCode?: number;
}

/**
 * Error thrown when resolved values fail validation constraints.
 *
 * Exit code defaults to `2` (standard for CLI usage errors).
 */
export class ValidationError extends CLIError {
	override readonly name = 'ValidationError' as const;
	declare readonly code: ValidationErrorCode;

	constructor(message: string, options: ValidationErrorOptions) {
		super(message, { ...options, exitCode: options.exitCode ?? 2 });
	}
}

// ---------------------------------------------------------------------------
// Type guard utilities
// ---------------------------------------------------------------------------

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
