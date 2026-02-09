/**
 * DreamCLI — Schema-first, fully typed TypeScript CLI framework.
 *
 * @module dreamcli
 */

// Public API will be re-exported here as modules are implemented.
// Each module barrel (e.g. ./errors/index.ts) exports only the public surface.

export type { CLIRunOptions, CLISchema } from './core/cli/index.js';
export { CLIBuilder, cli } from './core/cli/index.js';
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
export type { HelpOptions } from './core/help/index.js';
export { formatHelp } from './core/help/index.js';
export type {
	CapturedOutput,
	OutputOptions,
	Verbosity,
	WriteFn,
} from './core/output/index.js';
export { createCaptureOutput, createOutput } from './core/output/index.js';
export type { ParseResult, Token } from './core/parse/index.js';
export { parse, tokenize } from './core/parse/index.js';
export type { ResolveResult } from './core/resolve/index.js';
export { resolve } from './core/resolve/index.js';
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
export type { RunOptions, RunResult } from './core/testkit/index.js';
export { runCommand } from './core/testkit/index.js';
