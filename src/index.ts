/**
 * DreamCLI — Schema-first, fully typed TypeScript CLI framework.
 *
 * Test utilities (runCommand, createCaptureOutput, createTestPrompter, etc.)
 * are available from `dreamcli/testkit`. Runtime adapters (createAdapter,
 * RuntimeAdapter, etc.) are available from `dreamcli/runtime`.
 *
 * @module dreamcli
 */

export type { CLIRunOptions, CLISchema, ConfigSettings } from './core/cli/index.ts';
export { CLIBuilder, cli } from './core/cli/index.ts';
export type { CompletionOptions, Shell } from './core/completion/index.ts';
export {
	generateBashCompletion,
	generateCompletion,
	generateZshCompletion,
	SHELLS,
} from './core/completion/index.ts';
export type {
	ConfigAdapter,
	ConfigDiscoveryOptions,
	ConfigDiscoveryResult,
	ConfigFound,
	ConfigNotFound,
	FormatLoader,
} from './core/config/index.ts';
export { buildConfigSearchPaths, configFormat, discoverConfig } from './core/config/index.ts';
export type {
	CLIErrorJSON,
	CLIErrorOptions,
	ErrorCode,
	ParseErrorCode,
	ParseErrorOptions,
	ValidationErrorCode,
	ValidationErrorOptions,
} from './core/errors/index.ts';
export {
	CLIError,
	isCLIError,
	isParseError,
	isValidationError,
	ParseError,
	ValidationError,
} from './core/errors/index.ts';
export type { HelpOptions } from './core/help/index.ts';
export { formatHelp } from './core/help/index.ts';
export type { OutputOptions, Verbosity, WriteFn } from './core/output/index.ts';
export { createOutput } from './core/output/index.ts';
export type { ParseResult, Token } from './core/parse/index.ts';
export { parse, tokenize } from './core/parse/index.ts';
export type {
	PromptEngine,
	ReadFn,
	ResolvedMultiselectPromptConfig,
	ResolvedPromptConfig,
	ResolvedSelectPromptConfig,
} from './core/prompt/index.ts';
export { createTerminalPrompter, resolvePromptConfig } from './core/prompt/index.ts';
export type { DeprecationWarning, ResolveOptions, ResolveResult } from './core/resolve/index.ts';
export { resolve } from './core/resolve/index.ts';
export type {
	ActionHandler,
	ActionParams,
	ActivityEvent,
	AnyCommandBuilder,
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
	ConfirmPromptConfig,
	ErasedCommand,
	ErasedInteractiveResolver,
	ErasedMiddlewareHandler,
	Fallback,
	FlagConfig,
	FlagFactory,
	FlagKind,
	FlagParseFn,
	FlagPresence,
	FlagSchema,
	InferArg,
	InferArgs,
	InferFlag,
	InferFlags,
	InputPromptConfig,
	InteractiveParams,
	InteractiveResolver,
	InteractiveResult,
	Middleware,
	MiddlewareHandler,
	MiddlewareParams,
	MultiselectPromptConfig,
	Out,
	ProgressHandle,
	ProgressOptions,
	PromptConfig,
	PromptConfigBase,
	PromptKind,
	PromptResult,
	ResolvedArgValue,
	ResolvedValue,
	RunResult,
	SelectChoice,
	SelectPromptConfig,
	SpinnerHandle,
	SpinnerOptions,
	TableColumn,
	WithArgPresence,
	WithPresence,
	WithVariadic,
} from './core/schema/index.ts';
export {
	ArgBuilder,
	arg,
	CommandBuilder,
	command,
	createArgSchema,
	createSchema,
	FlagBuilder,
	flag,
	group,
	middleware,
} from './core/schema/index.ts';
