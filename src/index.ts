/**
 * DreamCLI — Schema-first, fully typed TypeScript CLI framework.
 *
 * @module dreamcli
 */

// Public API will be re-exported here as modules are implemented.
// Each module barrel (e.g. ./errors/index.ts) exports only the public surface.

export type {
	CLIErrorJSON,
	CLIErrorOptions,
	ErrorCode,
	ParseErrorCode,
	ParseErrorOptions,
	ValidationErrorCode,
	ValidationErrorOptions,
} from './core/errors/index.js';
export {
	CLIError,
	isCLIError,
	isParseError,
	isValidationError,
	ParseError,
	ValidationError,
} from './core/errors/index.js';
export type {
	ArgConfig,
	ArgFactory,
	ArgKind,
	ArgParseFn,
	ArgPresence,
	ArgSchema,
	FlagConfig,
	FlagFactory,
	FlagKind,
	FlagPresence,
	FlagSchema,
	InferArg,
	InferArgs,
	InferFlag,
	InferFlags,
	ResolvedArgValue,
	ResolvedValue,
	WithArgPresence,
	WithPresence,
	WithVariadic,
} from './core/schema/index.js';
export {
	ArgBuilder,
	arg,
	createArgSchema,
	createSchema,
	FlagBuilder,
	flag,
} from './core/schema/index.js';
