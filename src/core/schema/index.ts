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
	ArgDefinition,
	ArgDefinitionBase,
	ArgDefinitionByKind,
	ArgDefinitionOverrides,
	ArgFactory,
	ArgKind,
	ArgParseFn,
	ArgPresence,
	ArgSchema,
	CustomArgDefinition,
	EnumArgDefinition,
	InferArg,
	InferArgs,
	NumberArgDefinition,
	ResolvedArgValue,
	StringArgDefinition,
	WithArgPresence,
	WithVariadic,
} from './arg.ts';
export { ARG_KINDS, ARG_PRESENCES, ArgBuilder, arg, createArgSchema } from './arg.ts';
export type {
	ActionHandler,
	ActionParams,
	AnyCommandBuilder,
	CommandArgEntry,
	CommandArgEntryDefinition,
	CommandDefinition,
	CommandExample,
	CommandMeta,
	CommandSchema,
	DeriveHandler,
	DeriveParams,
	ErasedDeriveHandler,
	ErasedInteractiveResolver,
	ExampleCommand,
	ExampleMeta,
	InteractiveParams,
	InteractiveResolver,
	InteractiveResult,
	Out,
} from './command.ts';
export {
	CommandBuilder,
	command,
	createCommandSchema,
	group,
	resolveExampleCommand,
} from './command.ts';
export type {
	ArrayFlagDefinition,
	BooleanFlagDefinition,
	ConfirmPromptConfig,
	CountFlagDefinition,
	CustomFlagDefinition,
	DateFlagOptions,
	DuplicatePolicy,
	EnumFlagDefinition,
	FlagAlias,
	FlagConfig,
	FlagDefinition,
	FlagDefinitionBase,
	FlagDefinitionByKind,
	FlagDefinitionOverrides,
	FlagFactory,
	FlagKind,
	FlagNegation,
	FlagParseFn,
	FlagPresence,
	FlagSchema,
	InferFlag,
	InferFlags,
	InputPromptConfig,
	KeyValueFlagDefinition,
	MultiselectPromptConfig,
	NumberFlagDefinition,
	PathChecks,
	PathFlagOptions,
	PromptConfig,
	PromptConfigBase,
	PromptKind,
	PromptResult,
	ResolvedValue,
	SelectChoice,
	SelectPromptConfig,
	StringFlagDefinition,
	UrlFlagOptions,
	WithPresence,
} from './flag.ts';
export {
	createFlagSchema,
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
export type { InternalRunOptions, RunOptions, RunResult } from './run.ts';
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
	stringConstraintDetails,
	validateStringConstraints,
} from './string-constraints.ts';
