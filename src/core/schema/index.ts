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
	ActionHandler,
	ActionParams,
	CommandArgEntry,
	CommandConfig,
	CommandExample,
	CommandSchema,
	ErasedInteractiveResolver,
	InteractiveParams,
	InteractiveResolver,
	InteractiveResult,
	Out,
	TableColumn,
} from './command.js';
export { CommandBuilder, command } from './command.js';
export type {
	ConfirmPromptConfig,
	FlagConfig,
	FlagFactory,
	FlagKind,
	FlagPresence,
	FlagSchema,
	InferFlag,
	InferFlags,
	InputPromptConfig,
	MultiselectPromptConfig,
	PromptConfig,
	PromptConfigBase,
	PromptKind,
	PromptResult,
	ResolvedValue,
	SelectChoice,
	SelectPromptConfig,
	WithPresence,
} from './flag.js';
export { createSchema, FlagBuilder, flag } from './flag.js';
export type {
	ErasedMiddlewareHandler,
	Middleware,
	MiddlewareHandler,
	MiddlewareParams,
} from './middleware.js';
export { middleware } from './middleware.js';
