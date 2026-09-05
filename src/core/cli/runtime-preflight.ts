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
import type { PackageJsonData } from '#internals/core/config/package-json.ts';
import { CLIError, ParseError } from '#internals/core/errors/index.ts';
import type { HelpThemeFactory } from '#internals/core/help/index.ts';
import type { Verbosity } from '#internals/core/output/index.ts';
import type { ParseOptions } from '#internals/core/parse/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { invocationSelectsStdin } from '#internals/core/schema/source.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import type { BuiltinsConfig, BuiltinsDraft } from './builtins.ts';
import { builtinEnabled } from './builtins.ts';
import type { CompiledCLI } from './compiled.ts';
import type { HelpLinks } from './help-links.ts';
import { deriveHelpLinks } from './help-links.ts';
import { planInvocation } from './planner.ts';
import { assertNoReservedFlagCollisions } from './reserved-flags.ts';
import {
	readRootOutputFlags,
	resolveRootJsonMode,
	resolveRootVerbosity,
} from './root-output-flags.ts';

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
 * Descriptive subset of CLISchema used by runtime preflight.
 *
 * Decouples adapter-driven sourcing (config, package.json, stdin) from the
 * full CLIBuilder surface so preflight can be tested independently. Preflight
 * rewrites fields of this shape and hands the result back; the executable half
 * of the program travels beside it as a {@linkcode CompiledCLI}.
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
				readonly theme?: HelpThemeFactory;
		  }
		| undefined;
	/** Flag-parsing behavior settings (e.g. case parity). */
	readonly flagSettings: ParseOptions | undefined;
	/** Which built-in flags the root still owns; a released one is left in argv. */
	readonly builtins: BuiltinsDraft;
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
	/** Filesystem probe override for `flag.path()` checks; bypasses the adapter probe. */
	readonly stat?: (path: string) => Promise<'file' | 'directory' | null>;
	/** Directory creation override for `flag.path()` `create` checks; bypasses the adapter. */
	readonly mkdir?: (path: string) => Promise<void>;
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
	/** Pre-read stdin data if the invocation would select a stdin source. */
	readonly stdinData?: string | null;
	/** Prompt engine for interactive flag resolution; absent in non-TTY. */
	readonly prompter?: PromptEngine;
	/** Loaded config data for the config resolution step. */
	readonly config?: Readonly<Record<string, unknown>>;
	/** Filesystem probe (from the adapter) for `flag.path()` checks. */
	readonly stat?: (path: string) => Promise<'file' | 'directory' | null>;
	/** Directory creation (from the adapter) for `flag.path()` `create` checks. */
	readonly mkdir?: (path: string) => Promise<void>;
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

/** Preflight failed before the CLI could start. @internal */
interface RuntimeStartupErrorPreflight {
	/** Discriminant — a startup step produced a structured error. */
	readonly kind: 'startup-error';
	/** The startup error to render. */
	readonly error: CLIError;
	/** Whether JSON output was requested (needed to choose error rendering). */
	readonly jsonMode: boolean;
}

/** Discriminated union of preflight outcomes — either ready or startup-error. @internal */
type RuntimePreflightResult = ReadyRuntimePreflight | RuntimeStartupErrorPreflight;

/** Options bag for {@linkcode prepareRuntimePreflight}. @internal */
interface PrepareRuntimePreflightOptions {
	/** CLI schema subset driving preflight decisions. */
	readonly schema: RuntimePreflightSchemaLike;
	/** Compiled execution graph, forwarded to the planner for stdin detection. */
	readonly compiled: CompiledCLI;
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

/**
 * Check whether this invocation will actually select a stdin source.
 *
 * A `'dash'` binding is eligible when its token is `-`. A `'missing'` binding is
 * eligible when argv left the input absent; env, config, prompt, and default do
 * not suppress the read, because the stdin fallback outranks all four.
 *
 * @param schema - The matched command's merged schema.
 * @param argv - The command's own argv slice.
 * @param flagSettings - Parser behavior settings.
 * @param builtins - Which built-in flags the root still owns.
 * @returns `true` when at least one input would read stdin.
 * @internal
 */
function commandInvocationNeedsStdin(
	schema: CommandSchema,
	argv: readonly string[],
	flagSettings?: ParseOptions,
	builtins?: BuiltinsConfig,
): boolean {
	if (builtinEnabled(builtins, 'help') && (argv.includes('--help') || argv.includes('-h'))) {
		return false;
	}

	try {
		const parsed = parse(schema, argv, flagSettings);
		return invocationSelectsStdin(schema.flags, schema.args, parsed);
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
	compiled: CompiledCLI,
	argv: readonly string[],
): boolean {
	const plan = planInvocation({
		schema,
		compiled,
		argv,
		help: { binName: schema.name },
		output: PRECHECK_OUTPUT,
	});

	switch (plan.kind) {
		case 'match':
			return commandInvocationNeedsStdin(
				plan.plan.mergedSchema,
				plan.plan.argv,
				schema.flagSettings,
				schema.builtins,
			);
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
	compiled: CompiledCLI,
	argv: readonly string[],
): boolean {
	if (!schema.hasBuiltInCompletions) {
		return false;
	}

	const plan = planInvocation({
		schema,
		compiled,
		argv,
		help: { binName: schema.name },
		output: PRECHECK_OUTPUT,
	});

	return (
		plan.kind === 'root-completions' ||
		(plan.kind === 'match' && plan.plan.command.schema.name === 'completions')
	);
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
					const { discoverManifest, inferCliName } = await import(
						'#internals/core/config/package-json.ts'
					);
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

/**
 * Re-run the `RESERVED_FLAG` guard when discovery supplied the version.
 *
 * `.manifest()` reads a version off the filesystem at `.run()` time, past every
 * build-time check, so a command flag spelling `--version` or `-V` as a name, an
 * alias, or a negated spelling would become unreachable without ever being
 * rejected. Running the same guard here fails the startup with the identical
 * error the build paths raise (#86), rendered like every other startup failure
 * rather than thrown at the caller.
 *
 * @param discovered - Schema after manifest discovery merged its metadata in.
 * @param declared - Schema as the builder had it before discovery.
 * @param compiled - Compiled graph carrying every registered command schema.
 * @returns The `RESERVED_FLAG` error for the first collision, or `undefined`.
 *
 * @internal
 */
function discoveredVersionCollision(
	discovered: RuntimePreflightSchemaLike,
	declared: RuntimePreflightSchemaLike,
	compiled: CompiledCLI,
): CLIError | undefined {
	if (discovered.version === declared.version) return undefined;

	try {
		assertNoReservedFlagCollisions(
			discovered.version,
			[compiled.defaultCommand?.schema, ...compiled.commands.map((command) => command.schema)],
			discovered.builtins,
		);
		return undefined;
	} catch (error: unknown) {
		if (error instanceof CLIError) {
			return error;
		}
		throw error;
	}
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
		const { discoverConfig } = await import('#internals/core/config/index.ts');
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

function createLazyTerminalPrompter(adapter: RuntimeAdapter): PromptEngine {
	let engine: Promise<PromptEngine> | undefined;
	return {
		async promptOne(config) {
			engine ??= import('#internals/core/prompt/terminal.ts').then(({ createTerminalPrompter }) =>
				createTerminalPrompter(adapter.stdin, adapter.stderr),
			);
			return (await engine).promptOne(config);
		},
	};
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
	const rootOutputFlags = readRootOutputFlags(filteredArgv, options.schema.builtins);
	const jsonMode = resolveRootJsonMode(rootOutputFlags, options.options?.jsonMode);
	const verbosity = resolveRootVerbosity(rootOutputFlags, options.options?.verbosity) ?? 'normal';
	const isCompletions = isCompletionsInvocation(options.schema, options.compiled, filteredArgv);
	const schema = await applyPackageJsonDiscovery(
		options.schema,
		options.adapter,
		options.inheritedName,
		isCompletions,
	);
	const versionCollision = discoveredVersionCollision(schema, options.schema, options.compiled);

	if (versionCollision !== undefined) {
		return {
			kind: 'startup-error',
			error: versionCollision,
			jsonMode,
		};
	}
	const loadedConfig = await loadRuntimeConfig(
		schema,
		options.adapter,
		configPath,
		isCompletions,
		options.options?.config,
	);

	if (loadedConfig instanceof CLIError) {
		return {
			kind: 'startup-error',
			error: loadedConfig,
			jsonMode,
		};
	}

	const autoPrompter =
		options.options?.prompter === undefined && options.adapter.stdinIsTTY
			? createLazyTerminalPrompter(options.adapter)
			: undefined;
	const stdinData =
		options.options?.stdinData === undefined &&
		invocationNeedsStdin(schema, options.compiled, filteredArgv)
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
			verbosity,
			stat: options.options?.stat ?? options.adapter.stat,
			mkdir: options.options?.mkdir ?? options.adapter.mkdir,
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
