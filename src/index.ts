/**
 * DreamCLI — Schema-first, fully typed TypeScript CLI framework.
 *
 * @module dreamcli
 */

// Public API will be re-exported here as modules are implemented.
// Each module barrel (e.g. ./errors/index.ts) exports only the public surface.

export type { CLIRunOptions, CLISchema } from './core/cli/index.js';
export { CLIBuilder, cli } from './core/cli/index.js';
export type { CompletionOptions, Shell } from './core/completion/index.js';
export {
	generateBashCompletion,
	generateCompletion,
	generateZshCompletion,
	SHELLS,
} from './core/completion/index.js';
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
export type {
	PromptEngine,
	ReadFn,
	ResolvedMultiselectPromptConfig,
	ResolvedPromptConfig,
	ResolvedSelectPromptConfig,
	TestAnswer,
	TestPrompterOptions,
} from './core/prompt/index.js';
export {
	createTerminalPrompter,
	createTestPrompter,
	PROMPT_CANCEL,
	resolvePromptConfig,
} from './core/prompt/index.js';
export type { ResolveOptions, ResolveResult } from './core/resolve/index.js';
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
	ConfirmPromptConfig,
	ErasedInteractiveResolver,
	ErasedMiddlewareHandler,
	FlagConfig,
	FlagFactory,
	FlagKind,
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
	PromptConfig,
	PromptConfigBase,
	PromptKind,
	PromptResult,
	ResolvedArgValue,
	ResolvedValue,
	SelectChoice,
	SelectPromptConfig,
	TableColumn,
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
	middleware,
} from './core/schema/index.js';
export type { RunOptions, RunResult } from './core/testkit/index.js';
export { runCommand } from './core/testkit/index.js';
export type { RuntimeAdapter, TestAdapterOptions } from './runtime/index.js';
export { createNodeAdapter, createTestAdapter, ExitError } from './runtime/index.js';
