/**
 * DreamCLI — Schema-first, fully typed TypeScript CLI framework.
 *
 * Start here for most applications:
 * - {@link cli} to define a program
 * - {@link command} to define commands and groups
 * - {@link flag} and {@link arg} to describe inputs
 *
 * This root entrypoint also re-exports lower-level building blocks such as
 * parsing, resolution, config discovery, and help formatting. Those are useful
 * for advanced integrations, custom tooling, or focused tests, but they are
 * not the typical starting point for application code.
 *
 * Test utilities (runCommand, createCaptureOutput, createTestPrompter, etc.)
 * are available from `dreamcli/testkit`. Runtime adapters (createAdapter,
 * RuntimeAdapter, etc.) are available from `dreamcli/runtime`.
 *
 * @module dreamcli
 */

export type {
	BeforeParseParams,
	CLIOptions,
	CLIPlugin,
	CLIPluginHooks,
	CLIRunOptions,
	CLISchema,
	ConfigSettings,
	PackageJsonSettings,
	PluginCommandContext,
	ResolvedCommandParams,
} from './core/cli/index.ts';
export { CLIBuilder, cli, plugin } from './core/cli/index.ts';
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
	PackageJsonAdapter,
	PackageJsonData,
} from './core/config/index.ts';
export {
	buildConfigSearchPaths,
	configFormat,
	discoverConfig,
	discoverPackageJson,
	inferCliName,
} from './core/config/index.ts';
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
export type { JsonSchemaOptions } from './core/json-schema/index.ts';
export {
	DEFINITION_SCHEMA_FILENAME,
	DEFINITION_SCHEMA_VERSION,
	definitionMetaSchema,
	generateInputSchema,
	generateSchema,
} from './core/json-schema/index.ts';
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
	CommandMeta,
	CommandSchema,
	ConfirmPromptConfig,
	DeriveHandler,
	DeriveParams,
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
	TableFormat,
	TableOptions,
	TableStream,
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
