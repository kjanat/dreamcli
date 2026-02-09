/**
 * Command, flag, and arg schema builders with full type inference.
 *
 * @module dreamcli/core/schema
 */

export type {
	ArgConfig,
	ArgFactory,
	ArgKind,
	ArgParseFn,
	ArgPresence,
	ArgSchema,
	InferArg,
	InferArgs,
	ResolvedArgValue,
	WithArgPresence,
	WithVariadic,
} from './arg.js';
export { ArgBuilder, arg, createArgSchema } from './arg.js';

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
} from './flag.js';
export { createSchema, FlagBuilder, flag } from './flag.js';
