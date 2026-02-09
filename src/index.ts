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
	ActionHandler,
	ActionParams,
	ArgConfig,
	ArgFactory,
	ArgKind,
	ArgParseFn,
	ArgPresence,
	ArgSchema,
	CommandArgEntry,
	CommandConfig,
	CommandExample,
	CommandSchema,
	FlagConfig,
	FlagFactory,
	FlagKind,
	FlagPresence,
	FlagSchema,
	InferArg,
	InferArgs,
	InferFlag,
	InferFlags,
	Out,
	ResolvedArgValue,
	ResolvedValue,
	WithArgPresence,
	WithPresence,
	WithVariadic,
} from './core/schema/index.js';
export {
	ArgBuilder,
	arg,
	CommandBuilder,
	command,
	createArgSchema,
	createSchema,
	FlagBuilder,
	flag,
} from './core/schema/index.js';
