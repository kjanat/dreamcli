/**
 * Command, flag, and arg schema builders with full type inference.
 *
 * @module dreamcli/core/schema
 */

export type {
	ActivityEvent,
	Fallback,
	ProgressHandle,
	ProgressOptions,
	SpinnerHandle,
	SpinnerOptions,
	TableColumn,
	TableFormat,
	TableOptions,
	TableStream,
} from './activity.ts';
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
} from './arg.ts';
export { ARG_KINDS, ARG_PRESENCES, ArgBuilder, arg, createArgSchema } from './arg.ts';
export type {
	ActionHandler,
	ActionParams,
	AnyCommandBuilder,
	CommandArgEntry,
	CommandConfig,
	CommandExample,
	CommandMeta,
	CommandSchema,
	DeriveHandler,
	DeriveParams,
	ErasedCommand,
	ErasedDeriveHandler,
	ErasedInteractiveResolver,
	InteractiveParams,
	InteractiveResolver,
	InteractiveResult,
	Out,
} from './command.ts';
export { CommandBuilder, command, group } from './command.ts';
export type {
	ConfirmPromptConfig,
	DateFlagOptions,
	DuplicatePolicy,
	FlagAlias,
	FlagConfig,
	FlagFactory,
	FlagKind,
	FlagNegation,
	FlagParseFn,
	FlagPresence,
	FlagSchema,
	FlagSchemaOverrides,
	InferFlag,
	InferFlags,
	InputPromptConfig,
	MultiselectPromptConfig,
	PathChecks,
	PathFlagOptions,
	PromptConfig,
	PromptConfigBase,
	PromptKind,
	PromptResult,
	ResolvedValue,
	SelectChoice,
	SelectPromptConfig,
	UrlFlagOptions,
	WithPresence,
} from './flag.ts';
export {
	createSchema,
	FLAG_KINDS,
	FLAG_PRESENCES,
	FlagBuilder,
	flag,
	getFlagNegatedName,
	PROMPT_KINDS,
} from './flag.ts';
export type {
	ErasedMiddlewareHandler,
	Middleware,
	MiddlewareHandler,
	MiddlewareParams,
} from './middleware.ts';
export { middleware } from './middleware.ts';
export type { NumberConstraints, NumberConstraintViolation } from './number-constraints.ts';
export {
	describeNumberConstraintViolation,
	validateNumberConstraints,
} from './number-constraints.ts';
export type { RunOptions, RunResult } from './run.ts';
export type {
	InferStandardInput,
	InferStandardOutput,
	StandardSchemaV1,
	StandardSchemaV1FailureResult,
	StandardSchemaV1Issue,
	StandardSchemaV1Options,
	StandardSchemaV1PathSegment,
	StandardSchemaV1Props,
	StandardSchemaV1Result,
	StandardSchemaV1SuccessResult,
	StandardSchemaV1Types,
} from './standard.ts';
export type { StringConstraints, StringConstraintViolation } from './string-constraints.ts';
export {
	describeStringConstraintViolation,
	validateStringConstraints,
} from './string-constraints.ts';
