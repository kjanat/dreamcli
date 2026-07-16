/**
 * CLI entry point builder with command registration and dispatch.
 *
 * The {@linkcode cli | cli()} factory returns an immutable {@linkcode CLIBuilder} that registers
 * commands, handles `--help`/`--version` at root level, dispatches to
 * the matched command, and provides both a testable `.execute()` path
 * and a production `.run()` path.
 *
 * @module dreamcli/core/cli
 */

import type { CompletionOptions, Shell } from '#internals/core/completion/index.ts';
import {
	detectShell,
	generateCompletion,
	normalizeShell,
	SHELLS,
} from '#internals/core/completion/index.ts';
import type { FormatLoader } from '#internals/core/config/index.ts';
import type { PackageJsonData } from '#internals/core/config/package-json.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { buildRunResult, executeCommand } from '#internals/core/execution/index.ts';
import type { HelpOptions, HelpThemeFactory } from '#internals/core/help/index.ts';
import { formatHelp } from '#internals/core/help/index.ts';
import { generateCommandSchema, generateSchema } from '#internals/core/json-schema/index.ts';
import type { CapturedOutput } from '#internals/core/output/index.ts';
import {
	clearRequestedExitCode,
	createCaptureOutput,
	createOutput,
} from '#internals/core/output/index.ts';
import type { ParseOptions } from '#internals/core/parse/index.ts';
import { includesBeforeSeparator } from '#internals/core/parse/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg } from '#internals/core/schema/arg.ts';
import type {
	AnyCommandBuilder,
	CommandBuilder,
	CommandMeta,
	CommandSchema,
	ErasedCommand,
	Out,
} from '#internals/core/schema/command.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { getFlagAliasNames } from '#internals/core/schema/flag.ts';
import type { RunOptions, RunResult } from '#internals/core/schema/run.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import { createAdapter } from '#internals/runtime/auto.ts';
import { BACKSLASH, SLASH, stripTrailing } from '#internals/strings.ts';
import type { HelpLinks } from './help-links.ts';
import { deriveHelpLinks } from './help-links.ts';
import type { OutputPolicy } from './planner.ts';
import { planInvocation } from './planner.ts';
import type { CLIPlugin } from './plugin.ts';
import { plugin } from './plugin.ts';
import { formatRootHelp } from './root-help.ts';
import { prepareRuntimePreflight } from './runtime-preflight.ts';

// --- Type-erased command — erasure function (interface now in schema/command.ts)

/** Long-flag name reserved by `.completions({ as: 'flag' })`; the planner intercepts it before dispatch. */
const COMPLETIONS_FLAG_NAME = 'completions';

/**
 * Whether a command — or any of its nested subcommands — declares a flag that
 * collides with the eager `--completions` flag, by canonical name or long alias.
 *
 * @internal
 */
function commandReservesCompletionsFlag(schema: CommandSchema): boolean {
	if (Object.hasOwn(schema.flags, COMPLETIONS_FLAG_NAME)) return true;
	for (const flagSchema of Object.values(schema.flags)) {
		if (
			getFlagAliasNames(flagSchema, { kind: 'long', includeHidden: true }).includes(
				COMPLETIONS_FLAG_NAME,
			)
		) {
			return true;
		}
	}
	return schema.commands.some(commandReservesCompletionsFlag);
}

/**
 * Reject a command whose flags would be shadowed by the eager `--completions`
 * flag once `.completions({ as: 'flag' })` is active. Because the planner
 * intercepts `--completions` before dispatch, such a flag could never be reached.
 *
 * @internal
 */
function assertNoCompletionsFlagCollision(schema: CommandSchema): void {
	if (commandReservesCompletionsFlag(schema)) {
		throw new CLIError(
			`Command '${schema.name}' defines a '--${COMPLETIONS_FLAG_NAME}' flag, which is reserved by .completions({ as: 'flag' })`,
			{
				code: 'RESERVED_FLAG',
				suggest: `Rename the flag, or register completions as a subcommand with .completions() instead of { as: 'flag' }`,
			},
		);
	}
}

function commandRoutes(schema: CommandSchema): readonly string[] {
	return [schema.name, ...schema.aliases];
}

function assertNoSiblingRouteConflict(
	parentCommandName: string,
	routeOwners: Map<string, string>,
	route: string,
	commandName: string,
): void {
	const owner = routeOwners.get(route);
	if (owner !== undefined) {
		throw new CLIError(
			`Duplicate command route '${route}' under '${parentCommandName}' (${owner} and ${commandName})`,
			{
				code: 'DUPLICATE_COMMAND',
				suggest: 'Ensure sibling command names and aliases are unique',
			},
		);
	}

	routeOwners.set(route, commandName);
}

function assertNoTopLevelRouteConflict(
	commands: readonly ErasedCommand[],
	incoming: CommandSchema,
	defaultCommand?: ErasedCommand | undefined,
): void {
	const routeOwners = new Map<string, string>();

	const existing = defaultCommand !== undefined ? [...commands, defaultCommand] : commands;
	for (const command of existing) {
		for (const route of commandRoutes(command.schema)) {
			assertNoSiblingRouteConflict('root', routeOwners, route, command.schema.name);
		}
	}

	for (const route of commandRoutes(incoming)) {
		const owner = routeOwners.get(route);
		if (owner !== undefined) {
			throw new CLIError(`Command route '${route}' is already registered by '${owner}'`, {
				code: 'DUPLICATE_COMMAND',
				suggest:
					owner === incoming.name
						? `Ensure command '${incoming.name}' does not reuse route '${route}'`
						: `Rename '${incoming.name}' or remove route '${route}' from '${owner}'`,
			});
		}

		routeOwners.set(route, incoming.name);
	}
}

/**
 * Erase a typed  {@linkcode CommandBuilder} into an {@linkcode ErasedCommand}, recursively
 * building the subcommand tree.
 *
 * The closure captures the fully-typed builder, so  {@linkcode runCommand()} receives
 * the original `CommandBuilder<F, A>` — no type assertions needed.\
 * Subcommands are recursively erased and indexed by name and alias for
 * O(1) lookup during dispatch.
 *
 * @internal
 */
function eraseCommand<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown>,
>(cmd: CommandBuilder<F, A, C>): ErasedCommand {
	// Recursively erase subcommands, keyed by name and alias.
	const subcommands = new Map<string, ErasedCommand>();
	const routeOwners = new Map<string, string>();
	for (const sub of cmd._subcommands) {
		const routes = commandRoutes(sub.schema);
		for (const route of routes) {
			assertNoSiblingRouteConflict(cmd.schema.name, routeOwners, route, sub.schema.name);
		}

		const erased = eraseCommand(sub);
		for (const route of routes) {
			subcommands.set(route, erased);
		}
	}

	return {
		schema: cmd.schema,
		subcommands,
		_command: cmd as unknown as AnyCommandBuilder,
		_execute(argv, options) {
			return runCommand(cmd, argv, options);
		},
	};
}

// --- CLI schema — runtime descriptor for the CLI program

/**
 * Runtime descriptor for the CLI program.
 *
 * Stores the program name, version, description, and registered commands.\
 * Built incrementally by {@linkcode CLIBuilder}.
 */
interface CLISchema {
	/** Program name (used in help text, usage lines, and completion scripts). */
	readonly name: string;
	/**
	 * Whether `.run()` should replace `name` with the invoked program name.
	 *
	 * Set via the `cli({ inherit: true })` factory form.
	 */
	readonly inheritName: boolean;
	/** Program version (shown by `--version`). */
	readonly version: string | undefined;
	/** Program description (shown in root help). */
	readonly description: string | undefined;
	/** Registered commands (type-erased for heterogeneous storage). */
	readonly commands: readonly ErasedCommand[];
	/**
	 * Default command dispatched when no subcommand matches.
	 *
	 * When set, the CLI root behaves like a hybrid command group: subcommands
	 * dispatch by name as usual, but empty argv or flags-only argv falls
	 * through to this command instead of showing root help.
	 *
	 * Set via the {@linkcode CLIBuilder.default | .default()} builder method.
	 */
	readonly defaultCommand: ErasedCommand | undefined;
	/**
	 * Whether the default command is also exposed as a named top-level route.
	 *
	 * Set by `.default(cmd, { route: true })`. When `true`, `mycli <name>`
	 * dispatches to the default command (in addition to the bare/flags-only root
	 * surface behavior) and the command is listed in the root `Commands:`
	 * section. When `false` (the default), the default is the root surface only.
	 */
	readonly defaultCommandRouted: boolean;
	/**
	 * Config discovery settings.
	 *
	 * When defined, {@linkcode CLIBuilder.run | .run()} auto-discovers and loads a config file before command dispatch.
	 *
	 * Set via the {@linkcode CLIBuilder.config | .config()} builder method.
	 */
	readonly configSettings: ConfigSettings | undefined;
	/**
	 * Manifest auto-discovery settings. When defined, `.run()` discovers the
	 * nearest manifest (`package.json`, `deno.json`, `jsr.json`, …) and merges
	 * metadata before dispatch.
	 *
	 * Set via the {@linkcode CLIBuilder.manifest | .manifest()} builder method
	 * (or the {@linkcode CLIBuilder.packageJson | .packageJson()} /
	 * {@linkcode CLIBuilder.denoJson | .denoJson()} presets).
	 */
	readonly packageJsonSettings: ResolvedManifestSettings | undefined;
	/**
	 * OSC 8 hyperlink targets for the root-help header (name/version).
	 *
	 * Set via the {@linkcode CLIBuilder.links | .links()} builder method.
	 * Fields left `undefined` are derived from manifest metadata
	 * (`repository` / `homepage`) when manifest discovery ({@linkcode
	 * CLIBuilder.manifest | .manifest()}) is active.
	 */
	readonly helpLinks: HelpLinks | undefined;
	/** Whether built-in `.completions()` registration (command or flag) is active. */
	readonly hasBuiltInCompletions: boolean;
	/**
	 * Eager `--completions <shell>` flag configuration.
	 *
	 * Set when `.completions({ as: 'flag' })` is used instead of the default
	 * `completions` subcommand. When defined, the planner intercepts
	 * `--completions <shell>` before dispatch, prints the script, and exits;
	 * root help advertises the flag in its `Flags:` section.
	 */
	readonly completionsFlag: CompletionsFlagConfig | undefined;
	/**
	 * Consumer-configured root-help defaults.
	 *
	 * Set via the {@linkcode CLIBuilder.help | .help()} builder method and merged
	 * under runtime `options.help` (runtime wins) before rendering.
	 */
	readonly helpConfig: HelpConfig | undefined;
	/**
	 * Flag-parsing behavior settings ({@link ParseOptions}).
	 *
	 * Set via the `cli(name, { flags })` / `cli({ flags })` factory forms.
	 */
	readonly flagSettings: ParseOptions | undefined;
	/** Registered CLI plugins. */
	readonly plugins: readonly CLIPlugin[];
}

/**
 * Configuration for the eager `--completions <shell>` flag.
 *
 * Stored in {@link CLISchema} when `.completions({ as: 'flag' })` is used.
 *
 * @internal
 */
interface CompletionsFlagConfig {
	/** Shell targets the flag accepts (mirrors {@link SHELLS}). */
	readonly shells: readonly Shell[];
	/** Generator options captured at build time (e.g. `functionPrefix`, `rootMode`). */
	readonly options: CompletionOptions | undefined;
}

/**
 * Consumer-facing root-help configuration set via {@linkcode CLIBuilder.help}.
 *
 * Every field is optional; unset fields fall back to built-in defaults and may
 * be overridden per call through runtime `options.help`.
 */
interface HelpConfig {
	/**
	 * Render the default command's arguments and flags inline at the root.
	 *
	 * @defaultValue `true`
	 */
	readonly inlineDefault?: boolean;
	/**
	 * Also list the default command in the root `Commands:` table.
	 *
	 * By default the default command is the root surface and is omitted from the
	 * command list (its args/flags render inline instead).
	 *
	 * @defaultValue `false`
	 */
	readonly showDefaultInCommands?: boolean;
	/**
	 * Show the `Run '<bin> <command> --help' for more information.` hint.
	 *
	 * Defaults to showing the hint only when visible subcommands exist.
	 */
	readonly footer?: boolean;
	/** Maximum line width (columns). */
	readonly width?: number;
	/** Emit OSC 8 hyperlinks in the header when supported. */
	readonly hyperlinks?: boolean;
	/**
	 * Theme overrides for help output, merged over the built-in theme.
	 *
	 * The factory receives the gated ansispeck palette (same instance as
	 * `out.color`), so overrides follow the output channel's color policy.
	 * It is never invoked when color is off — themed help cannot leak escapes
	 * into piped, `--json`, or `NO_COLOR` output.
	 *
	 * @defaultValue `undefined` (built-in theme)
	 */
	readonly theme?: HelpThemeFactory;
}

/**
 * Config discovery settings for automatic config file loading.
 *
 * Stored in {@link CLISchema} and consumed by {@linkcode CLIBuilder.run()} to call
 * {@link discoverConfig} before dispatching to a command.
 */
interface ConfigSettings {
	/**
	 * Application name used to build config search paths.
	 *
	 * Search paths: `.{appName}.json` (cwd), `{appName}.config.json` (cwd),
	 * and `{configDir}/{appName}/config.json` where `configDir` is
	 * `$XDG_CONFIG_HOME` / `~/.config` on Unix or `%APPDATA%` /
	 * `%USERPROFILE%\\AppData\\Roaming` on Windows.
	 */
	readonly appName: string;

	/** Additional format loaders beyond the built-in JSON loader. */
	readonly loaders: readonly FormatLoader[] | undefined;
}

/**
 * Manifest auto-discovery settings — the resolved/normalized shape stored in
 * the schema.
 *
 * Stored in {@link CLISchema} and consumed by `CLIBuilder.run()` to
 * call {@link discoverManifest} before dispatching to a command.
 *
 * Note: the schema FIELD name (`packageJsonSettings`) keeps its `packageJson`
 * prefix for backward compatibility — renaming it would break consumers reading
 * `app.schema.packageJsonSettings`. The type itself is now generically named
 * (it holds discovery config for any manifest — `package.json`, `deno.json`,
 * `jsr.json`); the legacy {@link PackageJsonSettings} alias remains exported for
 * backward compatibility.
 */
interface ResolvedManifestSettings {
	/**
	 * Infer CLI name from manifest `bin` keys or `name` field.
	 *
	 * When `true`, the discovered name replaces the `cli(name)` value.
	 * Explicit `.version()`/`.description()` calls still take precedence
	 * over discovered values.
	 *
	 * @defaultValue `false`
	 */
	readonly inferName: boolean;
	/**
	 * Strip a leading `@scope/` from the inferred `name` fallback.
	 *
	 * Only consulted when {@link ResolvedManifestSettings.inferName | `inferName`}
	 * is `true` and the name comes from the manifest `name` field (not a `bin`
	 * key, which is never scoped).
	 *
	 * @defaultValue `true`
	 */
	readonly stripScope: boolean;
	/**
	 * Explicit filesystem anchor for discovery; overrides `adapter.cwd`.
	 *
	 * Resolved to a string path before storage. When set, `discoverManifest`
	 * walks up from here instead of the runtime cwd. Required for installable
	 * CLIs whose version should reflect THEIR OWN package, not the consumer's
	 * working directory.
	 */
	readonly from: string | undefined;
	/**
	 * Candidate manifest filenames, in per-directory priority order
	 * (e.g. `['deno.json', 'deno.jsonc', 'jsr.json']` for `.denoJson()`).
	 */
	readonly files: readonly string[];
	/**
	 * Pre-loaded data; skips filesystem discovery, uses values verbatim.
	 *
	 * @example
	 * ```ts
	 * import pkg from './package.json' with { type: 'json' };
	 *
	 * cli('mycli').manifest(pkg);
	 * ```
	 */
	readonly data: PackageJsonData | undefined;
}

/**
 * Resolved manifest discovery settings stored in {@link CLISchema}.
 *
 * @deprecated Renamed to {@link ResolvedManifestSettings}. The stored shape
 *   holds generic manifest discovery config (`package.json`, `deno.json`,
 *   `jsr.json`), not just `package.json`; the misleading name is kept only for
 *   backward compatibility.
 */
type PackageJsonSettings = ResolvedManifestSettings;

// --- Options for execute/run

/**
 * Options for {@linkcode CLIBuilder.execute | .execute()} and {@linkcode CLIBuilder.run | .run()}.
 *
 * Derives from {@linkcode RunOptions} while excluding command-execution internals
 * (`meta`, `mergedSchema`) and adding the CLI-level runtime adapter.
 */
interface CLIRunOptions extends Omit<RunOptions, 'meta' | 'mergedSchema'> {
	/**
	 * Runtime adapter providing platform-specific I/O, argv, env, etc.
	 *
	 * When provided to `.run()`, replaces the default Node adapter.
	 * Ignored by `.execute()` (which is process-free by design).
	 */
	readonly adapter?: RuntimeAdapter;
}

// --- Command run options builder

/**
 * Build {@linkcode RunOptions} from {@linkcode CLIRunOptions}, conditionally spreading each
 * field to satisfy `exactOptionalPropertyTypes`.
 *
 * @param options - CLI-level run options (may be `undefined` for defaults).
 * @param helpOptions - Help formatting options forwarded to commands.
 * @param meta - Optional command metadata (omitted for root-level dispatch).
 * @returns Options record ready for {@linkcode ErasedCommand._execute | ErasedCommand._execute()}.
 *
 * @internal
 */
function buildCommandRunOptions(
	options: CLIRunOptions | undefined,
	helpOptions: HelpOptions,
	meta?: CommandMeta,
): RunOptions {
	return {
		help: helpOptions,
		...(meta !== undefined ? { meta } : {}),
		...(options?.plugins !== undefined ? { plugins: options.plugins } : {}),
		...(options?.env !== undefined ? { env: options.env } : {}),
		...(options?.config !== undefined ? { config: options.config } : {}),
		...(options?.stdinData !== undefined ? { stdinData: options.stdinData } : {}),
		...(options?.prompter !== undefined ? { prompter: options.prompter } : {}),
		...(options?.answers !== undefined ? { answers: options.answers } : {}),
		...(options?.stat !== undefined ? { stat: options.stat } : {}),
		...(options?.verbosity !== undefined ? { verbosity: options.verbosity } : {}),
		...(options?.jsonMode !== undefined ? { jsonMode: options.jsonMode } : {}),
		...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
		...(options?.out !== undefined ? { out: options.out } : {}),
		...(options?.captured !== undefined ? { captured: options.captured } : {}),
		...(options?.flags !== undefined ? { flags: options.flags } : {}),
	};
}

// --- CLIBuilder — immutable builder for the CLI program

/**
 * Options for {@linkcode CLIBuilder.default | .default()}.
 */
interface DefaultCommandOptions {
	/**
	 * Also expose the default command under its own name as a routable
	 * top-level command.
	 *
	 * By default a default command is the root *surface* only — `mycli` (bare or
	 * flags-only) runs it, but `mycli <its-name>` does not route to it (the token
	 * is consumed as the default's first positional). Set `route: true` for CLIs
	 * that intentionally expose both forms: `mycli` and `mycli <its-name>` become
	 * the same command, and it is listed in the root `Commands:` section beside
	 * its siblings.
	 *
	 * The name wins over positional interpretation: with `route: true`, a
	 * positional value equal to the command's own name is consumed as the route,
	 * so pass such a value after `--` (`mycli -- <name>`).
	 *
	 * @defaultValue `false`
	 */
	readonly route?: boolean;
}

/**
 * Immutable CLI program builder.
 *
 * Registers commands, handles root-level `--help`/`--version`, and
 * dispatches to the matched command based on argv.
 *
 * Two execution paths:
 * - `.execute(argv, options?)` — testable, returns {@linkcode RunResult}
 * - `.run(options?)` — production entry, reads `process.argv`, exits process
 *
 * @example
 * ```ts
 * import { cli, command, flag, arg } from '@kjanat/dreamcli';
 *
 * const deploy = command('deploy')
 *   .arg('target', arg.string())
 *   .flag('force', flag.boolean().alias('f'))
 *   .action(({ args, flags, out }) => {
 *     out.log(`Deploying ${args.target}...`);
 *   });
 *
 * cli('mycli')
 *   .version('1.0.0')
 *   .command(deploy)
 *   .run();
 * ```
 */
class CLIBuilder {
	/** @internal Runtime schema descriptor. */
	readonly schema: CLISchema;

	/** Build a CLIBuilder from a pre-constructed schema descriptor. */
	constructor(schema: CLISchema) {
		this.schema = schema;
	}

	// -- Metadata modifiers --------------------------------------------------

	/**
	 * Set the program version (shown by `--version`).
	 *
	 * @param v - Semantic version string.
	 * @returns The builder (for chaining).
	 */
	version(v: string): CLIBuilder {
		return new CLIBuilder({ ...this.schema, version: v });
	}

	/**
	 * Set the program description (shown in root help).
	 *
	 * @param text - Short description displayed in root help output.
	 * @returns The builder (for chaining).
	 */
	description(text: string): CLIBuilder {
		return new CLIBuilder({ ...this.schema, description: text });
	}

	/**
	 * Make the root-help header clickable with OSC 8 hyperlinks.
	 *
	 * Links the program name and version on the first line of root `--help`
	 * output in terminals that support
	 * [OSC 8 hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda).
	 * The escapes are only emitted when stdout is a TTY (overridable via
	 * `options.help.hyperlinks`), and only in the header — usage lines, the
	 * `--help` hint, the commands table, and completion scripts stay plain.
	 *
	 * URLs not provided here are derived from manifest metadata when
	 * `.manifest()` is active (works with both filesystem discovery and
	 * pre-loaded data):
	 * - **name** → normalized `repository` URL, falling back to `homepage`
	 * - **version** → forge release tag (`{repo}/releases/tag/v{version}` on
	 *   GitHub, `{repo}/-/releases/v{version}` on GitLab)
	 *
	 * @param links - Explicit URLs; omit to derive everything from the manifest.
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * // Derive both links from the manifest repository/homepage:
	 * cli('mycli')
	 *   .manifest()
	 *   .links()
	 *   .run();
	 *
	 * // Explicit URLs (no package.json required):
	 * cli('mycli')
	 *   .version('1.0.0')
	 *   .links({
	 *     name: 'https://github.com/me/mycli',
	 *     version: 'https://github.com/me/mycli/releases/tag/v1.0.0',
	 *   })
	 *   .run();
	 * ```
	 */
	links(links?: { readonly name?: string | URL; readonly version?: string | URL }): CLIBuilder {
		return new CLIBuilder({
			...this.schema,
			helpLinks: {
				name: toUrlString(links?.name),
				version: toUrlString(links?.version),
			},
		});
	}

	/**
	 * Configure root-help rendering defaults.
	 *
	 * Stored on the schema and merged **under** any runtime `options.help`
	 * (runtime wins). Call multiple times to set fields incrementally.
	 *
	 * @param config - Help rendering options (see {@link HelpConfig}).
	 * @returns The builder (for chaining).
	 *
	 * @example
	 * ```ts
	 * // Echo the default command under Commands and never show the footer:
	 * cli('mycli')
	 *   .help({ showDefaultInCommands: true, footer: false })
	 *   .default(serve)
	 *   .run();
	 * ```
	 */
	help(config: HelpConfig): CLIBuilder {
		return new CLIBuilder({
			...this.schema,
			helpConfig: { ...this.schema.helpConfig, ...config },
		});
	}

	/**
	 * Enable automatic config file discovery.
	 *
	 * When enabled, `.run()` probes standard paths before dispatching:
	 * 1. `$CWD/.{appName}.json`
	 * 2. `$CWD/{appName}.config.json`
	 * 3. `$CONFIG_DIR/{appName}/config.json`
	 *    (`$XDG_CONFIG_HOME` / `~/.config` on Unix,
	 *    `%APPDATA%` / `%USERPROFILE%\\AppData\\Roaming` on Windows)
	 *
	 * The user can override the path via `--config <path>` or `--config=<path>`.
	 *
	 * Loaded config feeds into the resolution chain
	 * (CLI → env → **config** → prompt → default) for flags that
	 * declare `.config('dotted.path')`.
	 *
	 * Has no effect in `.execute()` (which receives config via
	 * `options.config` directly).
	 *
	 * @param appName - Name used to build search paths.
	 * @param loaders - Additional {@link FormatLoader}s (JSON is built-in).
	 * @returns The builder (for chaining).
	 */
	config(appName: string, loaders?: readonly FormatLoader[]): CLIBuilder {
		return new CLIBuilder({
			...this.schema,
			configSettings: {
				appName,
				loaders,
			},
		});
	}

	/**
	 * Register a custom config format loader.
	 *
	 * Adds a {@link FormatLoader} incrementally — call multiple times to
	 * register multiple formats. Loaders registered later for the same
	 * extension override earlier ones.
	 *
	 * Requires `.config()` to have been called first (sets the app name).
	 *
	 * @param loader - Format loader (or extensions + parse function).
	 * @returns The builder (for chaining).
	 *
	 * @example Bun built-in parsers
	 * ```ts
	 * import { configFormat } from '@kjanat/dreamcli';
	 *
	 * cli('myapp')
	 *   .config('myapp')
	 *   .configLoader(configFormat(['yaml', 'yml'], Bun.YAML.parse))
	 *   .configLoader(configFormat(['toml'], Bun.TOML.parse))
	 *   .run();
	 * ```
	 *
	 * @example npm package parsers
	 * ```ts
	 * import { configFormat } from '@kjanat/dreamcli';
	 * import { parse as parseYaml } from 'yaml';
	 * import { parse as parseTOML } from '@iarna/toml';
	 *
	 * cli('myapp')
	 *   .config('myapp')
	 *   .configLoader(configFormat(['yaml', 'yml'], parseYaml))
	 *   .configLoader(configFormat(['toml'], parseTOML))
	 *   .run();
	 * ```
	 */
	configLoader(loader: FormatLoader): CLIBuilder {
		if (this.schema.configSettings === undefined) {
			throw new CLIError('.configLoader() requires .config() to be called first', {
				code: 'INVALID_BUILDER_STATE',
				suggest: 'Call .config(appName) before .configLoader()',
			});
		}
		const existing = this.schema.configSettings.loaders ?? [];
		return new CLIBuilder({
			...this.schema,
			configSettings: {
				...this.schema.configSettings,
				loaders: [...existing, loader],
			},
		});
	}

	/**
	 * Enable manifest metadata from pre-loaded data.
	 *
	 * Pass an already-imported manifest (`package.json`, `deno.json`, `jsr.json`)
	 * to skip filesystem discovery entirely — useful for bundled or installable
	 * CLIs where the version should be locked at build time. The data's
	 * `version`/`description` are merged into the CLI schema immediately, so this
	 * form works in **both** `.run()` and `.execute()` (the filesystem-free path).
	 * Explicit `.version()`/`.description()` calls still take precedence, and the
	 * data form does not infer the CLI name — `inferName` / `{ scope }` are
	 * available only on the discovery (settings) form. For a pre-loaded manifest
	 * whose scoped `name` should drive the CLI name, set the name explicitly via
	 * `cli(name)` (or call {@link inferCliName} on the data yourself).
	 *
	 * Detected by field shape: an object carrying at least one of
	 * `name`/`version`/`description`/`bin`/`homepage`/`repository`. An empty `{}`
	 * or a settings-shaped object falls through to the settings overload.
	 *
	 * @param data - Pre-loaded manifest metadata.
	 *
	 * @example
	 * ```ts
	 * import denoCfg from './deno.json' with { type: 'json' };
	 *
	 * // No filesystem; works in .run() AND .execute():
	 * cli('mycli')
	 *   .manifest(denoCfg)
	 *   .command(deploy)
	 *   .run();
	 * ```
	 */
	manifest(data: PackageJsonData): CLIBuilder;
	/**
	 * Enable automatic manifest metadata discovery.
	 *
	 * When enabled, `.run()` walks up from `cwd` (or {@link ManifestSettings.from})
	 * to find the nearest manifest among {@link ManifestSettings.files} and merges
	 * its `version`/`description` into the CLI schema. Explicit `.version()` /
	 * `.description()` calls always take precedence.
	 *
	 * Files are parsed as JSON with a JSONC fallback — `package.json`, `deno.json`,
	 * `jsr.json`, and `deno.jsonc` all qualify, including files with `//` / block
	 * comments or trailing commas. A file that fails both parses is skipped
	 * (discovery keeps walking).
	 *
	 * Has no effect in `.execute()` (filesystem-free) — use the data overload.
	 *
	 * @param settings - Optional settings:
	 *   - `files`: candidate manifest filenames in priority order
	 *     (default `['package.json']`).
	 *   - `inferName`: infer the CLI name from `bin` keys or `name`. Pass
	 *     `{ scope: 'keep' }` to keep a leading `@scope/` (stripped by default).
	 *   - `from`: anchor discovery to a file/URL/path instead of `cwd`. Pass
	 *     `import.meta` for installable CLIs that must report THEIR OWN version.
	 *     Accepts `import.meta`, string paths, `file:` URL strings, or `URL`
	 *     instances.
	 *
	 * @example
	 * ```ts
	 * // Deno CLI: discover OUR deno.json (then jsr.json), keep the scope in name:
	 * cli('mycli')
	 *   .manifest({
	 *     files: ['deno.json', 'jsr.json'],
	 *     from: import.meta,
	 *     inferName: { scope: 'keep' },
	 *   })
	 *   .command(deploy)
	 *   .run();
	 * ```
	 */
	manifest(settings?: ManifestSettings): CLIBuilder;
	manifest(input?: PackageJsonData | ManifestSettings): CLIBuilder {
		return new CLIBuilder(buildManifestSchema(this.schema, input, DEFAULT_MANIFEST_FILES, false));
	}

	/**
	 * Discover metadata from `package.json` (preset for {@link CLIBuilder.manifest}).
	 *
	 * @deprecated Use {@link CLIBuilder.manifest} — `.manifest()` defaults to
	 *   `package.json` and also supports `deno.json` / `jsr.json` via `files`.
	 *
	 * @param data - Pre-loaded `package.json` metadata.
	 */
	packageJson(data: PackageJsonData): CLIBuilder;
	/**
	 * Discover metadata from `package.json` (preset for {@link CLIBuilder.manifest}).
	 *
	 * @deprecated Use {@link CLIBuilder.manifest}.
	 *
	 * @param settings - `inferName` / `from` (see {@link CLIBuilder.manifest}).
	 */
	packageJson(settings?: ManifestPresetSettings): CLIBuilder;
	packageJson(input?: PackageJsonData | ManifestPresetSettings): CLIBuilder {
		return new CLIBuilder(buildManifestSchema(this.schema, input, DEFAULT_MANIFEST_FILES, true));
	}

	/**
	 * Discover metadata from `deno.json`, `deno.jsonc`, then `jsr.json` (preset for
	 * {@link CLIBuilder.manifest}).
	 *
	 * @deprecated Use `.manifest({ files: ['deno.json', 'deno.jsonc', 'jsr.json'] })`.
	 *
	 * @param data - Pre-loaded `deno.json` / `jsr.json` metadata.
	 */
	denoJson(data: PackageJsonData): CLIBuilder;
	/**
	 * Discover metadata from `deno.json`, `deno.jsonc`, then `jsr.json` (preset for
	 * {@link CLIBuilder.manifest}).
	 *
	 * @deprecated Use `.manifest({ files: ['deno.json', 'deno.jsonc', 'jsr.json'] })`.
	 *
	 * @param settings - `inferName` / `from` (see {@link CLIBuilder.manifest}).
	 *   `deno.json` / `jsr.json` have no `bin` field, so `inferName` resolves
	 *   from `name`; pass `{ scope: 'keep' }` to retain a leading `@scope/`.
	 *
	 * @example
	 * ```ts
	 * cli('mycli')
	 *   .denoJson({ from: import.meta })
	 *   .command(deploy)
	 *   .run();
	 * ```
	 */
	denoJson(settings?: ManifestPresetSettings): CLIBuilder;
	denoJson(input?: PackageJsonData | ManifestPresetSettings): CLIBuilder {
		return new CLIBuilder(buildManifestSchema(this.schema, input, DENO_MANIFEST_FILES, true));
	}

	// -- Command registration ------------------------------------------------

	/**
	 * Register a command with the CLI program.
	 *
	 * The command's type parameters are erased for heterogeneous storage.
	 * Type safety is preserved inside the closure that delegates to
	 * {@linkcode runCommand | runCommand()}.
	 *
	 * @param cmd - {@link CommandBuilder} to register.
	 * @returns The builder (for chaining).
	 */
	command<
		F extends Record<string, FlagBuilder<FlagConfig>>,
		A extends Record<string, ArgBuilder<ArgConfig>>,
		C extends Record<string, unknown>,
	>(cmd: CommandBuilder<F, A, C>): CLIBuilder {
		assertNoTopLevelRouteConflict(this.schema.commands, cmd.schema, this.schema.defaultCommand);
		if (this.schema.completionsFlag !== undefined) {
			assertNoCompletionsFlagCollision(cmd.schema);
		}

		return new CLIBuilder({
			...this.schema,
			commands: [...this.schema.commands, eraseCommand(cmd)],
		});
	}

	/**
	 * Register a command as the default — dispatched when no subcommand is given.
	 *
	 * The CLI root behaves like a hybrid command group: named subcommands
	 * dispatch normally, but empty argv or flags-only argv falls through to
	 * this command instead of showing root help.
	 *
	 * The default command is the CLI's root *surface*: its flags and arguments
	 * are rendered inline in root help. By default it is **not** a named
	 * subcommand — it cannot be invoked by its own name (`mycli mycmd` does not
	 * route to it) and it is omitted from the root `Commands:` list (re-enable
	 * listing with `.help({ showDefaultInCommands: true })`). Only one default is
	 * allowed.
	 *
	 * Pass `{ route: true }` to *also* expose the command under its own name as a
	 * routable top-level command: `mycli` and `mycli <name>` then run the same
	 * command object, and it is listed in `Commands:` beside its siblings. This
	 * avoids duplicating the command just to keep both forms equivalent during a
	 * v3 migration.
	 *
	 * @example
	 * ```ts
	 * // Single-command CLI — no subcommand name needed:
	 * //   mytool --force production
	 * cli('mytool')
	 *   .default(deploy)
	 *   .run();
	 *
	 * // Multi-command CLI with a default:
	 * //   mytool production       → runs deploy
	 * //   mytool status           → runs status
	 * cli('mytool')
	 *   .default(deploy)
	 *   .command(status)
	 *   .run();
	 *
	 * // Default that is also a named route — `mytool` and `mytool status` are
	 * // the same surface, and `status` is listed beside `logs`:
	 * cli('mytool')
	 *   .default(status, { route: true })
	 *   .command(logs)
	 *   .run();
	 * ```
	 *
	 * @param cmd - {@link CommandBuilder} to register as the default.
	 * @param options - Default-command options. `{ route: true }` also exposes
	 *   the command under its own name (see {@link DefaultCommandOptions}).
	 * @returns The builder (for chaining).
	 */
	default<
		F extends Record<string, FlagBuilder<FlagConfig>>,
		A extends Record<string, ArgBuilder<ArgConfig>>,
		C extends Record<string, unknown>,
	>(cmd: CommandBuilder<F, A, C>, options?: DefaultCommandOptions): CLIBuilder {
		if (this.schema.defaultCommand !== undefined) {
			throw new CLIError('Only one default command is allowed', {
				code: 'DUPLICATE_DEFAULT',
				suggest: 'Call .default() only once when building the CLI',
			});
		}

		assertNoTopLevelRouteConflict(this.schema.commands, cmd.schema);
		if (this.schema.completionsFlag !== undefined) {
			assertNoCompletionsFlagCollision(cmd.schema);
		}

		const erased = eraseCommand(cmd);
		return new CLIBuilder({
			...this.schema,
			defaultCommand: erased,
			defaultCommandRouted: options?.route ?? false,
		});
	}

	/**
	 * Register a CLI plugin.
	 *
	 * Plugins run in registration order. At each lifecycle stage, all hooks for
	 * the first plugin run before hooks for the second plugin, and so on.
	 *
	 * @param definition - A frozen {@link CLIPlugin} created by {@link plugin}.
	 * @returns The builder (for chaining).
	 * @see {@link plugin} to construct plugin definitions.
	 */
	plugin(definition: CLIPlugin): CLIBuilder {
		return new CLIBuilder({
			...this.schema,
			plugins: [...this.schema.plugins, definition],
		});
	}

	// -- Built-in subcommands ------------------------------------------------

	/**
	 * Register built-in shell completion.
	 *
	 * By default (`{ as: 'command' }`) this registers a `completions` subcommand
	 * that accepts a `shell` argument and writes the script to stdout. With
	 * `{ as: 'flag' }` it instead exposes an eager `--completions <shell>` flag on
	 * the CLI root — no subcommand is registered, so a default command stays the
	 * lone root surface. The flag may be given without a value to auto-detect the
	 * shell from `$SHELL` / `$PSModulePath`.
	 *
	 * In subcommand mode, call this **after** registering all other commands so
	 * the completion script includes the full command set: that path snapshots the
	 * schema (and completion options) at call time, so commands registered
	 * afterwards will not appear in that subcommand's generated script. In flag
	 * mode, generation runs at execution time from the final builder schema, so
	 * registration order does not matter.
	 *
	 * @example
	 * ```ts
	 * // Subcommand form (default):
	 * cli('mycli')
	 *   .version('1.0.0')
	 *   .command(deploy)
	 *   .completions({ rootMode: 'surface' })
	 *   .run();
	 *
	 * // Eager-flag form, ideal for single-command CLIs:
	 * cli('mycli')
	 *   .completions({ as: 'flag' })
	 *   .default(serve)
	 *   .run();
	 * ```
	 */
	completions(options?: CompletionOptions): CLIBuilder {
		if (this.schema.hasBuiltInCompletions) {
			throw new CLIError('.completions() has already been called', {
				code: 'DUPLICATE_COMMAND',
				suggest: 'Call .completions() only once when building the CLI',
			});
		}

		// `as: 'flag'` exposes an eager `--completions <shell>` flag instead of a
		// subcommand. The planner intercepts it before dispatch (see planner.ts)
		// and root help advertises it in the Flags section. No subcommand is
		// registered, so the default command stays the lone root surface.
		if (options?.as === 'flag') {
			// The planner intercepts `--completions` before dispatch, so no command
			// may already reserve that flag name.
			if (this.schema.defaultCommand !== undefined) {
				assertNoCompletionsFlagCollision(this.schema.defaultCommand.schema);
			}
			for (const registered of this.schema.commands) {
				assertNoCompletionsFlagCollision(registered.schema);
			}
			return new CLIBuilder({
				...this.schema,
				hasBuiltInCompletions: true,
				completionsFlag: { shells: SHELLS, options },
			});
		}

		// Capture current schema — includes all commands registered so far.
		// The completions command itself is deliberately excluded from the
		// generated script (it would be noise in shell completions).
		const cliSchema = this.schema;
		const completionOptions = options;

		const cmd = command('completions')
			.alias('completion')
			.description('Generate shell completion script')
			.arg(
				'shell',
				arg
					.custom((raw: string): Shell => {
						// Normalize $SHELL paths across Unix/Windows:
						// /bin/zsh → zsh, C:\Program Files\PowerShell\7\pwsh.exe → pwsh
						const shell = normalizeShell(raw);
						if (shell === undefined) {
							throw new Error(`Unknown shell '${raw}'. Valid shells: ${SHELLS.join(', ')}`);
						}
						return shell;
					})
					.env('SHELL')
					.describe(`Target shell (${SHELLS.join(', ')})`),
			)
			.action(({ args, meta, out }) => {
				const completionSchema =
					meta.bin === cliSchema.name ? cliSchema : { ...cliSchema, name: meta.bin };
				const script = generateCompletion(completionSchema, args.shell, completionOptions);
				if (out.jsonMode) {
					out.json({ shell: args.shell, script });
				} else {
					out.log(script);
				}
			});

		const withCompletions = this.command(cmd);
		return new CLIBuilder({
			...withCompletions.schema,
			hasBuiltInCompletions: true,
		});
	}

	// -- Execution -----------------------------------------------------------

	/**
	 * Execute the CLI program against explicit argv.
	 *
	 * This is the testable execution path — no process state is touched.
	 * Returns a structured {@linkcode RunResult} with exit code and captured output.
	 *
	 * @param argv - Raw argv tokens (NOT including the binary/script path,
	 *   i.e. equivalent to `process.argv.slice(2)`).
	 * @param options - Injectable runtime state.
	 * @returns Structured result with exit code and captured output.
	 */
	async execute(argv: readonly string[], options?: CLIRunOptions): Promise<RunResult> {
		// -- Detect global --json mode before building output ---------------------
		// Only a `--json` before the `--` separator toggles JSON mode; a literal
		// `--json` positional (after `--`) must reach the command unchanged (#28).
		const hasJsonFlag = includesBeforeSeparator(argv, '--json');
		const jsonMode = hasJsonFlag || options?.jsonMode === true;

		const captureOptions = {
			...(options?.verbosity !== undefined ? { verbosity: options.verbosity } : {}),
			...(jsonMode ? { jsonMode } : {}),
			...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
		};
		let out: Out;
		let captured: CapturedOutput;
		if (options?.out !== undefined) {
			out = options.out;
			captured = options.captured ?? { stdout: [], stderr: [], activity: [] };
		} else {
			[out, captured] = createCaptureOutput(
				Object.keys(captureOptions).length > 0 ? captureOptions : undefined,
			);
		}
		clearRequestedExitCode(out);

		// Resolve help options — builder-level `.help()` config under runtime
		// `options.help` (runtime wins), then default binName to the CLI program
		// name, hyperlinks to TTY detection, and colors to the output channel's
		// gated palette (escapes never leak into piped output).
		const helpOptions: HelpOptions = {
			...this.schema.helpConfig,
			...options?.help,
			binName: options?.help?.binName ?? this.schema.name,
			hyperlinks: options?.help?.hyperlinks ?? this.schema.helpConfig?.hyperlinks ?? out.isTTY,
			colors: options?.help?.colors ?? out.color,
		};

		// -- Shared options for command execution ----------------------------------
		const flagSettings = options?.flags ?? this.schema.flagSettings;
		const effectiveOptions: CLIRunOptions = {
			...options,
			plugins: this.schema.plugins,
			...(jsonMode ? { jsonMode } : {}),
			...(flagSettings !== undefined ? { flags: flagSettings } : {}),
		};
		const output: OutputPolicy = {
			jsonMode,
			isTTY: out.isTTY,
			verbosity: options?.verbosity ?? 'normal',
		};
		// The planner scans flag arity during dispatch, so it must see the same
		// merged flag settings (runtime override wins) that command parsing uses.
		const planSchema =
			options?.flags !== undefined ? { ...this.schema, flagSettings } : this.schema;
		const planned = planInvocation({
			schema: planSchema,
			argv,
			help: helpOptions,
			output,
		});

		switch (planned.kind) {
			case 'root-version':
				out.log(planned.version);
				return buildRunResult({ exitCode: 0, error: undefined }, captured);

			case 'root-completions': {
				const shell = planned.shell ?? detectShell(options?.env ?? {});
				if (shell === undefined) {
					const error = new CLIError('Could not detect shell', {
						code: 'MISSING_VALUE',
						suggest: `Pass one explicitly, e.g. '${helpOptions.binName} --completions zsh'`,
					});
					if (jsonMode) {
						out.json({ error: error.toJSON() });
					} else {
						out.error(error.message);
						out.error(`Suggestion: ${error.suggest}`);
					}
					return buildRunResult({ exitCode: error.exitCode, error }, captured);
				}
				const completionSchema =
					helpOptions.binName === undefined || helpOptions.binName === this.schema.name
						? this.schema
						: { ...this.schema, name: helpOptions.binName };
				const script = generateCompletion(completionSchema, shell, planned.options);
				if (jsonMode) {
					out.json({ shell, script });
				} else {
					out.log(script);
				}
				return buildRunResult({ exitCode: 0, error: undefined }, captured);
			}

			case 'root-help': {
				if (jsonMode) {
					out.json(generateSchema(this.schema));
				} else {
					const helpText = formatRootHelp(resolveHelpLinksSchema(this.schema), planned.help);
					out.log(helpText);
				}
				return buildRunResult({ exitCode: 0, error: undefined }, captured);
			}

			case 'dispatch-error': {
				if (jsonMode) {
					out.json({ error: planned.error.toJSON() });
				} else {
					out.error(planned.error.message);
					if (planned.error.suggest !== undefined && planned.error.code !== 'NO_ACTION') {
						out.error(`Suggestion: ${planned.error.suggest}`);
					}
				}
				return buildRunResult({ exitCode: planned.error.exitCode, error: planned.error }, captured);
			}

			case 'needs-subcommand': {
				if (jsonMode) {
					out.json(generateCommandSchema(planned.command.schema));
				} else {
					const helpText = formatHelp(planned.command.schema, planned.help);
					out.log(helpText);
				}
				return buildRunResult({ exitCode: 0, error: undefined }, captured);
			}

			case 'match': {
				const commandRunOptions = buildCommandRunOptions(
					effectiveOptions,
					planned.plan.help ?? helpOptions,
					planned.plan.meta,
				);
				if (planned.plan.command._command === undefined) {
					return planned.plan.command._execute(planned.plan.argv, {
						...commandRunOptions,
						mergedSchema: planned.plan.mergedSchema,
					});
				}
				const result = await executeCommand({
					command: planned.plan.command._command,
					argv: planned.plan.argv,
					out,
					schema: planned.plan.mergedSchema,
					meta: planned.plan.meta,
					options: commandRunOptions,
				});
				return buildRunResult(result, captured);
			}
		}
	}

	/**
	 * Run the CLI program as a production entry point.
	 *
	 * Reads argv from the runtime adapter, dispatches to the matched
	 * command, writes output to real streams, and exits the process.
	 *
	 * This is the **only** place that touches process state (via the
	 * adapter). For testing, use `.execute()` instead — or provide a
	 * test adapter via `options.adapter`.
	 *
	 * Defaults to {@linkcode createAdapter | createAdapter()} when no adapter is provided,
	 * which auto-detects the runtime (Node.js, Bun) and creates
	 * the appropriate adapter.
	 *
	 * @param options - Optional runtime configuration including adapter.
	 */
	async run(options?: CLIRunOptions): Promise<never> {
		const adapter = options?.adapter ?? createAdapter();
		const inheritedName = this.schema.inheritName ? inferInvocationName(adapter.argv) : undefined;

		const preflight = await prepareRuntimePreflight({
			schema: this.schema,
			adapter,
			options,
			inheritedName,
		});

		if (preflight.kind === 'config-error') {
			if (preflight.jsonMode) {
				adapter.stdout(`${JSON.stringify({ error: preflight.error.toJSON() })}\n`);
			} else {
				adapter.stderr(`Error: ${preflight.error.message}\n`);
				if (preflight.error.suggest !== undefined) {
					adapter.stderr(`Suggestion: ${preflight.error.suggest}\n`);
				}
			}
			return adapter.exit(preflight.error.exitCode);
		}

		const effectiveBuilder =
			preflight.schema === this.schema ? this : new CLIBuilder(preflight.schema);
		const terminalSize = adapter.getTerminalSize();
		const runtimeHelpWidth =
			options?.help?.width === undefined && preflight.schema.helpConfig?.width === undefined
				? terminalSize?.columns
				: undefined;
		const runtimeHelpOptions =
			runtimeHelpWidth !== undefined
				? { ...options?.help, width: runtimeHelpWidth }
				: options?.help;
		const executeOptions: CLIRunOptions = {
			...options,
			...preflight.inputs,
			...(runtimeHelpOptions !== undefined ? { help: runtimeHelpOptions } : {}),
			out: createOutput({
				stdout: adapter.stdout,
				stderr: adapter.stderr,
				jsonMode: preflight.inputs.jsonMode,
				isTTY: preflight.inputs.isTTY,
				...(preflight.inputs.verbosity !== 'normal'
					? { verbosity: preflight.inputs.verbosity }
					: {}),
			}),
		};
		const result = await effectiveBuilder.execute(preflight.filteredArgv, executeOptions);

		// Write captured output to real streams via adapter
		for (const line of result.stdout) {
			adapter.stdout(line);
		}
		for (const line of result.stderr) {
			adapter.stderr(line);
		}

		return adapter.exit(result.exitCode);
	}
}
const RUNTIME_BINARIES = new Set(['bun', 'deno', 'node', 'tsx']);

/**
 * Extract the final path segment from a path-like or URL-like string.
 *
 * @param input - Forward- or backslash-delimited path.
 * @returns Trailing segment, or `undefined` when the input is empty or slash-only.
 *
 * @internal
 */
function basename(input: string): string | undefined {
	const trimmed = stripTrailing(input, [SLASH, BACKSLASH]);
	if (trimmed.length === 0) return undefined;
	const slashIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	const name = slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
	return name.length > 0 ? name : undefined;
}

/**
 * Detect known interpreter/runtime binary names (node, bun, deno, tsx).
 *
 * @param input - Candidate binary name, with or without `.exe` suffix.
 * @returns `true` when `input` matches a known runtime after normalization.
 *
 * @internal
 */
function isRuntimeBinaryName(input: string): boolean {
	const normalized = input.toLowerCase().replace(/\.exe$/i, '');
	return RUNTIME_BINARIES.has(normalized);
}

/**
 * Infer the displayed CLI name from the current runtime invocation.
 *
 * Resolution order:
 * 1. Node/Bun/tsx-style interpreters → script/entry argument basename
 * 2. Standalone executable invocations → argv[0] basename
 * 3. `undefined` when no stable entrypoint can be inferred (e.g. Deno synthetic argv)
 *
 * @param argv - Full process argv (typically `process.argv` or adapter equivalent).
 * @returns Inferred program name, or `undefined` when inference is ambiguous.
 *
 * @internal
 */
function inferInvocationName(argv: readonly string[]): string | undefined {
	const argv0 = argv[0];
	const argv1 = argv[1];
	const runtimeName = argv0 !== undefined ? basename(argv0) : undefined;

	if (runtimeName !== undefined && isRuntimeBinaryName(runtimeName)) {
		if (runtimeName === 'bun' && argv1 === 'run') {
			const entryArg = argv[2];
			if (entryArg === undefined || entryArg.startsWith('-')) return undefined;
			return basename(entryArg);
		}
		if (runtimeName === 'deno' && argv1 === 'run') return undefined;
		if (argv1 === undefined || argv1.startsWith('-')) return undefined;
		return basename(argv1);
	}

	return argv0 !== undefined ? basename(argv0) : undefined;
}

// --- Help link helpers

/** Coerce a `string | URL` link input to its string form. @internal */
function toUrlString(value: string | URL | undefined): string | undefined {
	if (value === undefined) return undefined;
	return value instanceof URL ? value.href : value;
}

/**
 * Resolve derived help links against pre-loaded package.json data.
 *
 * `.run()` resolves links during runtime preflight (where discovered
 * package.json metadata lives); this covers the filesystem-free
 * `.execute()` path, where only the `.packageJson(data)` overload can
 * contribute. Idempotent — already-resolved fields pass through unchanged.
 *
 * @internal
 */
function resolveHelpLinksSchema(schema: CLISchema): CLISchema {
	if (schema.helpLinks === undefined) return schema;
	return {
		...schema,
		helpLinks: deriveHelpLinks(schema.helpLinks, schema.packageJsonSettings?.data, schema.version),
	};
}

// --- manifest discovery settings

/** Default manifest filenames for `.manifest()` / `.packageJson()`. @internal */
const DEFAULT_MANIFEST_FILES: readonly string[] = ['package.json'];

/** Manifest filenames for the `.denoJson()` preset, in priority order. @internal */
const DENO_MANIFEST_FILES: readonly string[] = ['deno.json', 'deno.jsonc', 'jsr.json'];

/**
 * CLI-name inference control for {@link ManifestSettings.inferName}.
 *
 * - `false` (or omitted): do not infer the name.
 * - `true`: infer, stripping a leading `@scope/` from the `name` fallback.
 * - `{ scope: 'keep' }`: infer, keeping the full scoped name.
 * - `{ scope: 'strip' }`: infer, stripping the scope (explicit form of `true`).
 *
 * `scope` is required in the object form: an empty `{}` is rejected so that an
 * options object can never silently enable inference (use `true` for that).
 */
type InferNameOption = boolean | { readonly scope: 'keep' | 'strip' };

/** Discovery settings accepted by {@link CLIBuilder.manifest}. */
interface ManifestSettings {
	/** Infer the CLI name from `bin` keys or `name`. @defaultValue `false` */
	readonly inferName?: InferNameOption;
	/**
	 * Anchor discovery to a file/URL/path instead of `cwd`. Pass `import.meta`
	 * to anchor to the calling module without naming `import.meta.url`, which
	 * fails to type-check when a project `tsconfig.json` `lib` override drops the
	 * runtime's ambient `ImportMeta` extras.
	 */
	readonly from?: string | URL | ImportMeta;
	/**
	 * Candidate manifest filenames in priority order — NOT npm's `files` publish
	 * globs. Discovery probes each name per directory and takes the first that
	 * parses.
	 *
	 * @defaultValue `['package.json']`
	 */
	readonly files?: readonly string[];
}

/**
 * Discovery settings for the `.packageJson()` / `.denoJson()` presets (no `files`).
 *
 * @deprecated Both presets are deprecated; use {@link ManifestSettings} with
 *   {@link CLIBuilder.manifest}.
 */
type ManifestPresetSettings = Omit<ManifestSettings, 'files'>;

/**
 * Normalise an {@link InferNameOption} into the flat `{ inferName, stripScope }`
 * pair stored in {@link ResolvedManifestSettings}.
 *
 * @internal
 */
function normalizeInferName(option: InferNameOption | undefined): {
	readonly inferName: boolean;
	readonly stripScope: boolean;
} {
	if (option === undefined || option === false) return { inferName: false, stripScope: true };
	if (option === true) return { inferName: true, stripScope: true };
	return { inferName: true, stripScope: option.scope !== 'keep' };
}

/**
 * Build the next {@link CLISchema} for a manifest builder method.
 *
 * Shared by {@link CLIBuilder.manifest}, {@link CLIBuilder.packageJson}, and
 * {@link CLIBuilder.denoJson}. The data overload (detected via field shape)
 * merges `version`/`description` immediately so `.execute()` sees them; the
 * settings overload stores discovery config for runtime preflight.
 *
 * @internal
 */
function buildManifestSchema(
	schema: CLISchema,
	input: PackageJsonData | ManifestSettings | undefined,
	defaultFiles: readonly string[],
	pinFiles: boolean,
): CLISchema {
	if (isPackageJsonData(input)) {
		// Merge data into schema immediately so `.execute()` (which skips runtime
		// preflight) still picks up version/description. Explicit
		// `.version()`/`.description()` calls win, matching settings semantics.
		return {
			...schema,
			...(schema.version === undefined && input.version !== undefined
				? { version: input.version }
				: {}),
			...(schema.description === undefined && input.description !== undefined
				? { description: input.description }
				: {}),
			packageJsonSettings: {
				inferName: false,
				stripScope: true,
				from: undefined,
				files: defaultFiles,
				data: input,
			},
		};
	}
	const { inferName, stripScope } = normalizeInferName(input?.inferName);
	// Presets (`pinFiles`) always use their fixed list: the `Omit<…,'files'>` guard
	// only stops fresh literals at compile time, so a `ManifestSettings`-typed
	// variable could otherwise leak `files` through the data-overload dispatch gap.
	const files = pinFiles ? defaultFiles : (input?.files ?? defaultFiles);
	return {
		...schema,
		packageJsonSettings: {
			inferName,
			stripScope,
			from: normalizeFromSetting(input?.from),
			files,
			data: undefined,
		},
	};
}

// --- packageJson.from normalisation

/**
 * Coerce a {@link ResolvedManifestSettings.from | `manifest.from`} input
 * (string path, `file:` URL string, {@link URL} instance, or `import.meta`) to
 * a plain filesystem path string. `undefined` passes through unchanged.
 *
 * Runtime-agnostic by design — relies only on the `URL` global (available in
 * every JS runtime) rather than `node:url`, keeping core free of Node
 * built-ins. Non-`file:` inputs are returned unchanged as paths.
 *
 * @internal
 */
function normalizeFromSetting(from: string | URL | ImportMeta | undefined): string | undefined {
	if (from === undefined) return undefined;
	const source = typeof from === 'object' && !(from instanceof URL) ? from.url : from;
	if (source instanceof URL) {
		// Only file: URLs map to a filesystem path; pass others through verbatim.
		if (source.protocol !== 'file:') return source.href;
	} else if (!source.startsWith('file:')) {
		// Plain path (or non-file URL string) — already usable as-is.
		return source;
	}

	/*
	 * `URL.pathname` strips the `file://` scheme/authority; `decodeURIComponent`
	 * resolves percent-escapes. A leading-slash drive letter (`/C:/…`) marks a
	 * Windows path — drop the slash and switch to backslashes; otherwise it is a
	 * POSIX path already.
	 */
	const decoded = decodeURIComponent(new URL(source).pathname);
	if (/^\/[A-Za-z]:/.test(decoded)) {
		return decoded.slice(1).replace(/\//g, '\\');
	}
	return decoded;
}

/**
 * Predicate distinguishing the {@link PackageJsonData | data} overload of
 * `.packageJson()` from the settings overload at runtime.
 *
 * A value is treated as `PackageJsonData` when it's a plain object that
 * carries at least one recognised field (`name`, `version`, `description`,
 * `bin`, `homepage`, or `repository`). An empty `{}` or a settings-shaped
 * object (`inferName` / `from`) falls through to the settings overload.
 *
 * npm's `files` field (publish globs) is intentionally NOT recognised here, so
 * an object whose only key is `files` routes to the settings overload — where
 * `files` means candidate manifest filenames, never publish globs. Manifests
 * that publish a CLI carry `name`/`version`, so those route to the data overload
 * as expected.
 *
 * Edge case: a metadata-less manifest (e.g. a versionless private-root
 * `package.json` carrying only `files`/`private`) routes to settings, so its
 * `files` would be read as candidate filenames and the object is not stored as
 * data. This is harmless in practice — a metadata-less manifest contributes no
 * `version`/`description` either way — but it means a pre-loaded object must
 * carry real metadata to be honoured as data.
 *
 * @internal
 */
function isPackageJsonData(value: unknown): value is PackageJsonData {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	return (
		'name' in value ||
		'version' in value ||
		'description' in value ||
		'bin' in value ||
		'homepage' in value ||
		'repository' in value
	);
}

// --- Factory function

/**
 * Options for the `cli({...})` factory form.
 *
 * This form is useful when the displayed CLI name should be inferred from the
 * current runtime invocation instead of always being hard-coded.
 */
interface CLIOptions {
	/**
	 * Explicit fallback CLI name.
	 *
	 * Used by `.execute()`, and by `.run()` when runtime name inheritance is
	 * disabled or the invocation name cannot be inferred.
	 *
	 * @defaultValue `'cli'`
	 */
	readonly name?: string;

	/**
	 * Replace `name` with the invoked program basename during `.run()`.
	 *
	 * Examples:
	 * - `node ./bin/mycli.ts` → `mycli.ts`
	 * - `/usr/local/bin/mycli` → `mycli`
	 *
	 * @defaultValue `false`
	 */
	readonly inherit?: boolean;

	/**
	 * Flag-parsing behavior settings (e.g. `{ caseParity: false }` to accept
	 * only declared flag spellings). Shares the {@link ParseOptions} contract
	 * used by `parse()` and `RunOptions.flags`.
	 */
	readonly flags?: ParseOptions;
}

/**
 * Create a new CLI program builder.
 *
 * The CLI name is used in help text, usage lines, and generated completion scripts.
 *
 * @example
 * ```ts
 * cli('mycli')
 *   .version('1.0.0')
 *   .description('My awesome tool')
 *   .command(deploy)
 *   .command(login)
 *   .run();
 *
 * cli({ inherit: true })
 *   .command(deploy)
 *   .run();
 * ```
 */

function cli(name: string, options?: Omit<CLIOptions, 'name'>): CLIBuilder;
/** Create a new CLI program builder from an options object. */
function cli(options: CLIOptions): CLIBuilder;
function cli(
	nameOrOptions: string | CLIOptions,
	extraOptions?: Omit<CLIOptions, 'name'>,
): CLIBuilder {
	const options: CLIOptions =
		typeof nameOrOptions === 'string' ? { name: nameOrOptions, ...extraOptions } : nameOrOptions;
	const name = options.name ?? 'cli';
	const inheritName = options.inherit ?? false;

	return new CLIBuilder({
		name,
		inheritName,
		version: undefined,
		description: undefined,
		commands: [],
		defaultCommand: undefined,
		defaultCommandRouted: false,
		configSettings: undefined,
		packageJsonSettings: undefined,
		helpLinks: undefined,
		hasBuiltInCompletions: false,
		completionsFlag: undefined,
		helpConfig: undefined,
		flagSettings: options.flags,
		plugins: [],
	});
}

/**
 * Report whether the calling module is the process entrypoint, cross-runtime.
 *
 * Pass `import.meta`. The check reads its `main` flag, which Deno, Bun, and Node
 * set on the module invoked directly. Taking the whole `import.meta`
 * keeps calling code free of a direct `import.meta.main` access, which fails to
 * type-check when a project `tsconfig.json` `lib` override drops the runtime's
 * ambient `ImportMeta` extras.
 *
 * @param meta - The calling module's `import.meta`.
 * @returns `true` when the module was run as the entrypoint.
 *
 * @example
 * ```ts
 * if (isMainModule(import.meta)) cli('mycli').command(deploy).run();
 * ```
 */
function isMainModule(meta: ImportMeta): boolean {
	return meta.main === true;
}

// --- Exports

export type { HelpLinks } from './help-links.ts';
export type {
	BeforeParseParams,
	CLIPlugin,
	CLIPluginHooks,
	PluginCommandContext,
	ResolvedCommandParams,
} from './plugin.ts';
export type {
	CLIOptions,
	CLIRunOptions,
	CLISchema,
	CompletionsFlagConfig,
	ConfigSettings,
	DefaultCommandOptions,
	HelpConfig,
	InferNameOption,
	ManifestPresetSettings,
	ManifestSettings,
	PackageJsonSettings,
	ResolvedManifestSettings,
};
export { CLIBuilder, cli, formatRootHelp, isMainModule, plugin };
