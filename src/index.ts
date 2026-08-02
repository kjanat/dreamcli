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
 * are available from `@kjanat/dreamcli/testkit`. Runtime adapters (createAdapter,
 * RuntimeAdapter, etc.) are available from `@kjanat/dreamcli/runtime`.
 *
 * @module @kjanat/dreamcli
 */

// The palette type behind `out.color` (from `ansispeck`), re-exported so
// handlers can type color-aware helpers without a direct dependency.
export type { Colors } from 'ansispeck';
export type {
	BeforeParseParams,
	BuiltinMode,
	BuiltinName,
	Builtins,
	BuiltinsConfig,
	CLIDefinition,
	CLIExecuteOptions,
	CLIOptions,
	CLIPlugin,
	CLIPluginHooks,
	CLIRunOptions,
	CLISchema,
	CompletionsFlagConfig,
	ConfigSettings,
	ConfigSettingsDefinition,
	DefaultCommandOptions,
	HelpConfig,
	HelpLinks,
	InferNameOption,
	ManifestSettings,
	PluginCommandContext,
	RenderContext,
	RenderContextOptions,
	ResolvedCommandParams,
	ResolvedManifestSettings,
} from './core/cli/index.ts';
export {
	CLIBuilder,
	cli,
	createCLISchema,
	isMainModule,
	plugin,
	resolveRenderContext,
} from './core/cli/index.ts';
export type { CompletionOptions, Shell } from './core/completion/index.ts';
export {
	generateBashCompletion,
	generateCompletion,
	generateFishCompletion,
	generatePowerShellCompletion,
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
	ManifestDiscoveryOptions,
	PackageJsonAdapter,
	PackageJsonData,
	PackageRepository,
	PackageRepositoryUrlOptions,
} from './core/config/index.ts';
export {
	buildConfigSearchPaths,
	configFormat,
	discoverConfig,
	discoverManifest,
	inferCliName,
	packageRepositoryUrl,
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
export type { HelpOptions, HelpTheme, HelpThemeFactory } from './core/help/index.ts';
export { formatHelp, osc8, visibleWidth } from './core/help/index.ts';
export type {
	ArgDefinitionFragmentV1,
	CommandDefinitionDocument,
	CommandDefinitionDocumentV1,
	CommandDefinitionFragmentV1,
	DefinitionDocument,
	DefinitionDocumentV1,
	ExampleDefinitionFragmentV1,
	FlagDefinitionFragmentV1,
	FlagNegationFragmentV1,
	FlagPathChecksFragmentV1,
	FlagStringConstraintsFragmentV1,
	InputSchemaBranch,
	InputSchemaDocument,
	InputSchemaProperty,
	JsonSchemaOptions,
	PromptChoiceFragmentV1,
	PromptDefinitionFragmentV1,
} from './core/json-schema/index.ts';
export {
	DEFINITION_SCHEMA_URL,
	DEFINITION_SCHEMA_VERSION,
	definitionMetaSchema,
	generateCommandSchema,
	generateInputSchema,
	generateSchema,
} from './core/json-schema/index.ts';
export type { OutputOptions, Verbosity, WriteFn } from './core/output/index.ts';
export { createOutput } from './core/output/index.ts';
export type { ParseOptions, ParseResult, Token } from './core/parse/index.ts';
export {
	includesBeforeSeparator,
	parse,
	stripBeforeSeparator,
	tokenize,
} from './core/parse/index.ts';
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
	ArrayFlagDefinition,
	BooleanFlagDefinition,
	CommandArgEntry,
	CommandArgEntryDefinition,
	CommandDefinition,
	CommandExample,
	CommandMeta,
	CommandSchema,
	ConfirmPromptConfig,
	CountFlagDefinition,
	CustomArgDefinition,
	CustomFlagDefinition,
	DateFlagOptions,
	DeriveHandler,
	DeriveParams,
	DuplicatePolicy,
	EnumArgDefinition,
	EnumFlagDefinition,
	ExampleCommand,
	ExampleMeta,
	Fallback,
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
	InferArg,
	InferArgs,
	InferFlag,
	InferFlags,
	InferStandardInput,
	InferStandardOutput,
	InputPromptConfig,
	InteractiveParams,
	InteractiveResolver,
	InteractiveResult,
	KeyValueFlagDefinition,
	Middleware,
	MiddlewareHandler,
	MiddlewareParams,
	MultiselectPromptConfig,
	NumberArgDefinition,
	NumberConstraints,
	NumberConstraintViolation,
	NumberFlagDefinition,
	Out,
	PathChecks,
	PathFlagOptions,
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
	StandardSchemaV1,
	StandardSchemaV1FailureResult,
	StandardSchemaV1Issue,
	StandardSchemaV1Options,
	StandardSchemaV1PathSegment,
	StandardSchemaV1Props,
	StandardSchemaV1Result,
	StandardSchemaV1SuccessResult,
	StandardSchemaV1Types,
	StringArgDefinition,
	StringConstraints,
	StringConstraintViolation,
	StringFlagDefinition,
	TableColumn,
	TableFormat,
	TableOptions,
	TableStream,
	UrlFlagOptions,
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
	createCommandSchema,
	createFlagSchema,
	FlagBuilder,
	flag,
	getFlagNegatedName,
	group,
	middleware,
	resolveExampleCommand,
} from './core/schema/index.ts';
