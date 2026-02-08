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
	FlagConfig,
	FlagFactory,
	FlagKind,
	FlagPresence,
	FlagSchema,
	InferFlag,
	InferFlags,
	ResolvedValue,
	WithPresence,
} from './core/schema/index.js';
export { createSchema, FlagBuilder, flag } from './core/schema/index.js';
