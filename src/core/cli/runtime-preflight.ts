/**
 * Runtime preflight helpers for CLIBuilder.run().
 *
 * Separates adapter-driven sourcing work from planner and executor logic:
 * config discovery, package metadata discovery, invocation-scoped stdin reads,
 * prompt auto-wiring, and runtime-derived schema overrides.
 *
 * @module dreamcli/core/cli/runtime-preflight
 * @internal
 */

import type { CompletionOptions, Shell } from '#internals/core/completion/index.ts';
import type { FormatLoader } from '#internals/core/config/index.ts';
import { discoverConfig } from '#internals/core/config/index.ts';
import type { PackageJsonData } from '#internals/core/config/package-json.ts';
import { discoverManifest, inferCliName } from '#internals/core/config/package-json.ts';
import { CLIError, ParseError } from '#internals/core/errors/index.ts';
import type { Verbosity } from '#internals/core/output/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import { createTerminalPrompter } from '#internals/core/prompt/index.ts';
import type { CommandSchema, ErasedCommand } from '#internals/core/schema/command.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import type { HelpLinks } from './help-links.ts';
import { deriveHelpLinks } from './help-links.ts';
import { planInvocation } from './planner.ts';
import type { CLIPlugin } from './plugin.ts';

/** Config discovery settings extracted from CLISchema for preflight use. @internal */
interface RuntimeConfigSettings {
	/** Application name used to locate config files (e.g. `~/.config/<appName>/`). */
	readonly appName: string;
	/** Optional format loaders (JSON/YAML/TOML); `undefined` uses built-in JSON. */
	readonly loaders: readonly FormatLoader[] | undefined;
}

/**
 * Manifest discovery settings extracted from CLISchema for preflight use.
 *
 * Mirrors the public `ResolvedManifestSettings` shape (consumed structurally),
 * named with the `Runtime` prefix to match its {@link RuntimeConfigSettings}
 * sibling and avoid colliding with the exported public type.
 * @internal
 */
interface RuntimeManifestSettings {
	/** Whether to infer the CLI binary name from `bin` keys or `name`. */
	readonly inferName: boolean;
	/** Strip a leading `@scope/` from the inferred `name` fallback. */
	readonly stripScope: boolean;
	/** Explicit anchor (resolved path) for discovery; `undefined` falls back to `adapter.cwd`. */
	readonly from: string | undefined;
	/** Candidate manifest filenames in priority order. */
	readonly files: readonly string[];
	/** Pre-loaded data; when set, discovery is skipped entirely. */
	readonly data: PackageJsonData | undefined;
}

/**
 * Structural subset of CLISchema used by runtime preflight.
 *
 * Decouples adapter-driven sourcing (config, package.json, stdin) from the
 * full CLIBuilder surface so preflight can be tested independently.
 * @internal
 */
interface RuntimePreflightSchemaLike {
	/** CLI program name; may be overridden by package.json discovery or inheritance. */
	readonly name: string;
	/** Whether this CLI inherits its name from a parent (nested CLI embedding). */
	readonly inheritName: boolean;
	/** Declared version; `undefined` means version will be inferred from package.json if available. */
	readonly version: string | undefined;
	/** Declared description; `undefined` allows package.json inference. */
	readonly description: string | undefined;
	/** Registered top-level commands for dispatch planning during stdin detection. */
	readonly commands: readonly ErasedCommand[];
	/** Fallback command when no subcommand token matches. */
	readonly defaultCommand: ErasedCommand | undefined;
	/** Whether the default command is also exposed as a named top-level route. */
	readonly defaultCommandRouted: boolean;
	/** Config file discovery settings; `undefined` disables config loading. */
	readonly configSettings: RuntimeConfigSettings | undefined;
	/** Package.json discovery settings; `undefined` disables package.json inference. */
	readonly packageJsonSettings: RuntimeManifestSettings | undefined;
	/** Root-help header link targets; `undefined` fields may be derived from package.json. */
	readonly helpLinks: HelpLinks | undefined;
	/** Whether `.completions()` registered the built-in completions command/flag. */
	readonly hasBuiltInCompletions: boolean;
	/** Eager `--completions <shell>` flag config; `undefined` disables interception. */
	readonly completionsFlag:
		| { readonly shells: readonly Shell[]; readonly options: CompletionOptions | undefined }
		| undefined;
	/** Consumer-configured root-help defaults. */
	readonly helpConfig:
		| {
				readonly inlineDefault?: boolean;
				readonly showDefaultInCommands?: boolean;
				readonly footer?: boolean;
				readonly width?: number;
				readonly hyperlinks?: boolean;
		  }
		| undefined;
	/** Plugins forwarded into the execution pipeline. */
	readonly plugins: readonly CLIPlugin[];
}

/**
 * Caller-supplied overrides for runtime preflight.
 *
 * When provided, these bypass adapter auto-detection (useful for testing
 * and the `CLIRunOptions` public surface).
 * @internal
 */
interface RuntimePreflightOptions {
	/** Environment variables override; bypasses adapter env when set. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** Pre-loaded config object; skips config file discovery when set. */
	readonly config?: Readonly<Record<string, unknown>>;
	/** Pre-read stdin data; `null` means stdin was explicitly empty. */
	readonly stdinData?: string | null;
	/** Custom prompt engine; bypasses terminal prompter auto-creation. */
	readonly prompter?: PromptEngine;
	/** Output verbosity level override. */
	readonly verbosity?: Verbosity;
	/** Force JSON output mode regardless of `--json` flag presence. */
	readonly jsonMode?: boolean;
	/** TTY detection override; bypasses adapter TTY check. */
	readonly isTTY?: boolean;
}

/**
 * Fully resolved runtime inputs ready for the execution pipeline.
 *
 * All adapter vs. caller-override decisions are settled by the time this
 * is constructed; the executor treats these as final truth.
 * @internal
 */
interface RuntimeExecutionInputs {
	/** Resolved environment variables (from adapter or caller override). */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Whether stdout is a TTY (controls color, spinners, interactive prompts). */
	readonly isTTY: boolean;
	/** Whether structured JSON output mode is active. */
	readonly jsonMode: boolean;
	/** Output verbosity level. */
	readonly verbosity: Verbosity;
	/** Pre-read stdin data if the invocation declared stdin-mode args. */
	readonly stdinData?: string | null;
	/** Prompt engine for interactive flag resolution; absent in non-TTY. */
	readonly prompter?: PromptEngine;
	/** Loaded config data for the config resolution step. */
	readonly config?: Readonly<Record<string, unknown>>;
}

/** Preflight succeeded — all runtime inputs are resolved and ready for execution. @internal */
interface ReadyRuntimePreflight {
	/** Discriminant — preflight completed without errors. */
	readonly kind: 'ready';
	/** Schema after package.json discovery and name inheritance applied. */
	readonly schema: RuntimePreflightSchemaLike;
	/** Argv with valid runtime `--config` tokens stripped out. */
	readonly filteredArgv: readonly string[];
	/** Fully resolved runtime inputs for the execution pipeline. */
	readonly inputs: RuntimeExecutionInputs;
}

/** Preflight failed during config file discovery/loading. @internal */
interface RuntimeConfigErrorPreflight {
	/** Discriminant — config loading produced a structured error. */
	readonly kind: 'config-error';
	/** The config discovery/parse error to render. */
	readonly error: CLIError;
	/** Whether JSON output was requested (needed to choose error rendering). */
	readonly jsonMode: boolean;
}

/** Discriminated union of preflight outcomes — either ready or config-error. @internal */
type RuntimePreflightResult = ReadyRuntimePreflight | RuntimeConfigErrorPreflight;

/** Options bag for {@linkcode prepareRuntimePreflight}. @internal */
interface PrepareRuntimePreflightOptions {
	/** CLI schema subset driving preflight decisions. */
	readonly schema: RuntimePreflightSchemaLike;
	/** Runtime adapter providing argv, env, stdin, and filesystem access. */
	readonly adapter: RuntimeAdapter;
	/** Caller-supplied overrides; `undefined` means auto-detect everything. */
	readonly options: RuntimePreflightOptions | undefined;
	/** Name inherited from a parent CLI (nested embedding); `undefined` for standalone. */
	readonly inheritedName: string | undefined;
}

const PRECHECK_OUTPUT = {
	jsonMode: false,
	isTTY: false,
	verbosity: 'normal' as const,
};

/** Extract and strip valid runtime `--config` forms from argv, returning path + filtered tokens. @internal */
function extractConfigFlag(argv: readonly string[]): {
	readonly configPath: string | undefined;
	readonly filteredArgv: readonly string[];
} {
	const filteredArgv: string[] = [];
	let configPath: string | undefined;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === undefined) {
			continue;
		}

		if (arg === '--') {
			filteredArgv.push(...argv.slice(i));
			break;
		}

		if (configPath === undefined && arg.startsWith('--config=')) {
			const value = arg.slice('--config='.length);
			if (value.length > 0) {
				configPath = value;
				continue;
			}

			filteredArgv.push(arg);
			continue;
		}

		if (configPath === undefined && arg === '--config') {
			const nextArg = argv[i + 1];
			if (nextArg !== undefined && !nextArg.startsWith('-') && nextArg !== '--') {
				configPath = nextArg;
				i += 1;
				continue;
			}

			filteredArgv.push(arg);
			continue;
		}

		filteredArgv.push(arg);
	}

	return { configPath, filteredArgv };
}

/** Check whether a single command's args declare stdin-mode and argv leaves them unresolved. @internal */
function commandInvocationNeedsStdin(schema: CommandSchema, argv: readonly string[]): boolean {
	if (argv.includes('--help') || argv.includes('-h')) {
		return false;
	}

	try {
		const parsed = parse(schema, argv);
		return schema.args.some(({ name, schema: argSchema }) => {
			const parsedValue = parsed.args[name];
			return argSchema.stdinMode && (parsedValue === undefined || parsedValue === '-');
		});
	} catch (error: unknown) {
		if (error instanceof ParseError) {
			return false;
		}
		throw error;
	}
}

/** Plan the invocation and check whether the matched command needs stdin data. @internal */
function invocationNeedsStdin(
	schema: RuntimePreflightSchemaLike,
	argv: readonly string[],
): boolean {
	const plan = planInvocation({
		schema,
		argv,
		help: { binName: schema.name },
		output: PRECHECK_OUTPUT,
	});

	switch (plan.kind) {
		case 'match':
			return commandInvocationNeedsStdin(plan.plan.mergedSchema, plan.plan.argv);
		case 'dispatch-error':
		case 'needs-subcommand':
		case 'root-help':
		case 'root-version':
		case 'root-completions':
			return false;
	}
}

function isCompletionsInvocation(
	schema: RuntimePreflightSchemaLike,
	argv: readonly string[],
): boolean {
	if (!schema.hasBuiltInCompletions) {
		return false;
	}

	const plan = planInvocation({
		schema,
		argv,
		help: { binName: schema.name },
		output: PRECHECK_OUTPUT,
	});

	return plan.kind === 'match' && plan.plan.command.schema.name === 'completions';
}

async function applyPackageJsonDiscovery(
	schema: RuntimePreflightSchemaLike,
	adapter: RuntimeAdapter,
	inheritedName: string | undefined,
	isCompletions: boolean,
): Promise<RuntimePreflightSchemaLike> {
	const packageJsonSettings = schema.packageJsonSettings;
	const packageSchema =
		packageJsonSettings !== undefined && !isCompletions
			? await (async (): Promise<RuntimePreflightSchemaLike> => {
					// Pre-loaded data short-circuits filesystem discovery entirely.
					const pkg =
						packageJsonSettings.data ??
						(await discoverManifest(adapter, {
							...(packageJsonSettings.from !== undefined
								? { startDir: packageJsonSettings.from }
								: {}),
							files: packageJsonSettings.files,
						}));
					if (pkg === null) return schema;

					const inferredName = packageJsonSettings.inferName
						? inferCliName(pkg, { stripScope: packageJsonSettings.stripScope })
						: undefined;
					return {
						...schema,
						...(schema.version === undefined && pkg.version !== undefined
							? { version: pkg.version }
							: {}),
						...(schema.description === undefined && pkg.description !== undefined
							? { description: pkg.description }
							: {}),
						...(inferredName !== undefined ? { name: inferredName } : {}),
						helpLinks: deriveHelpLinks(schema.helpLinks, pkg, schema.version ?? pkg.version),
					};
				})()
			: schema;

	return inheritedName !== undefined ? { ...packageSchema, name: inheritedName } : packageSchema;
}

async function loadRuntimeConfig(
	schema: RuntimePreflightSchemaLike,
	adapter: RuntimeAdapter,
	configPath: string | undefined,
	isCompletions: boolean,
	existingConfig: Readonly<Record<string, unknown>> | undefined,
): Promise<Readonly<Record<string, unknown>> | CLIError | undefined> {
	if (schema.configSettings === undefined || isCompletions || existingConfig !== undefined) {
		return existingConfig;
	}

	try {
		const result = await discoverConfig(schema.configSettings.appName, adapter, {
			...(configPath !== undefined ? { configPath } : {}),
			...(schema.configSettings.loaders !== undefined
				? { loaders: schema.configSettings.loaders }
				: {}),
		});
		return result.found ? result.data : undefined;
	} catch (error: unknown) {
		if (error instanceof CLIError) {
			return error;
		}
		throw error;
	}
}

/**
 * Run all adapter-driven sourcing work before command execution.
 *
 * Discovers config files, reads package.json metadata, detects stdin needs,
 * wires up the prompt engine, and resolves output policy overrides into a
 * single {@linkcode RuntimePreflightResult}.
 * @internal
 */
async function prepareRuntimePreflight(
	options: PrepareRuntimePreflightOptions,
): Promise<RuntimePreflightResult> {
	const rawArgv = options.adapter.argv.slice(2);
	const { configPath, filteredArgv } =
		options.schema.configSettings !== undefined
			? extractConfigFlag(rawArgv)
			: { configPath: undefined, filteredArgv: rawArgv };
	const hasJsonFlag = filteredArgv.includes('--json');
	const jsonMode = hasJsonFlag || options.options?.jsonMode === true;
	const isCompletions = isCompletionsInvocation(options.schema, filteredArgv);
	const schema = await applyPackageJsonDiscovery(
		options.schema,
		options.adapter,
		options.inheritedName,
		isCompletions,
	);
	const loadedConfig = await loadRuntimeConfig(
		schema,
		options.adapter,
		configPath,
		isCompletions,
		options.options?.config,
	);

	if (loadedConfig instanceof CLIError) {
		return {
			kind: 'config-error',
			error: loadedConfig,
			jsonMode,
		};
	}

	const autoPrompter =
		options.options?.prompter === undefined && options.adapter.stdinIsTTY
			? createTerminalPrompter(options.adapter.stdin, options.adapter.stderr)
			: undefined;
	const stdinData =
		options.options?.stdinData === undefined && invocationNeedsStdin(schema, filteredArgv)
			? await options.adapter.readStdin()
			: options.options?.stdinData;

	return {
		kind: 'ready',
		schema,
		filteredArgv,
		inputs: {
			env: options.options?.env ?? options.adapter.env,
			isTTY: options.options?.isTTY ?? options.adapter.isTTY,
			jsonMode,
			verbosity: options.options?.verbosity ?? 'normal',
			...(stdinData !== undefined ? { stdinData } : {}),
			...(options.options?.prompter !== undefined
				? { prompter: options.options.prompter }
				: autoPrompter !== undefined
					? { prompter: autoPrompter }
					: {}),
			...(loadedConfig !== undefined ? { config: loadedConfig } : {}),
		},
	};
}

export type {
	PrepareRuntimePreflightOptions,
	ReadyRuntimePreflight,
	RuntimeExecutionInputs,
	RuntimePreflightOptions,
	RuntimePreflightResult,
	RuntimePreflightSchemaLike,
};
export {
	commandInvocationNeedsStdin,
	extractConfigFlag,
	invocationNeedsStdin,
	prepareRuntimePreflight,
};
