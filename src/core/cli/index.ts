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

import type { Colors } from 'ansispeck';
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
import type { CapturedOutput, Verbosity } from '#internals/core/output/index.ts';
import {
	clearRequestedExitCode,
	createCaptureOutput,
	createOutput,
	resolveHyperlinkOverride,
} from '#internals/core/output/index.ts';
import type { ParseOptions } from '#internals/core/parse/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg } from '#internals/core/schema/arg.ts';
import type { schemaBrand } from '#internals/core/schema/brand.ts';
import type {
	CommandBuilder,
	CommandDefinition,
	CommandMeta,
	CommandSchema,
	Out,
} from '#internals/core/schema/command.ts';
import { command, createCommandSchema } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { getFlagAliasNames, getFlagNegatedName } from '#internals/core/schema/flag.ts';
import type { InternalRunOptions, RunOptions, RunResult } from '#internals/core/schema/run.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import { createAdapter } from '#internals/runtime/auto.ts';
import { BACKSLASH, SLASH, stripTrailing } from '#internals/strings.ts';
import type { CompiledCLI } from './compiled.ts';
import { assertNoSiblingRouteConflict, commandRoutes, compileCommand } from './compiled.ts';
import type { HelpLinks } from './help-links.ts';
import { deriveHelpLinks } from './help-links.ts';
import type { OutputPolicy } from './planner.ts';
import { planInvocation } from './planner.ts';
import type { CLIPlugin } from './plugin.ts';
import { plugin } from './plugin.ts';
import { assertNoReservedFlagCollisions } from './reserved-flags.ts';
import { formatRootHelp } from './root-help.ts';
import {
	readRootOutputFlags,
	resolveRootJsonMode,
	resolveRootVerbosity,
} from './root-output-flags.ts';
import { prepareRuntimePreflight } from './runtime-preflight.ts';

/** Long-flag name reserved by `.completions({ as: 'flag' })`; the planner intercepts it before dispatch. */
const COMPLETIONS_FLAG_NAME = 'completions';

/**
 * Whether a command — or any of its nested subcommands — declares a flag that
 * collides with the eager `--completions` flag, by canonical name, long alias,
 * or negated spelling.
 *
 * @internal
 */
function commandReservesCompletionsFlag(schema: CommandSchema): boolean {
	if (Object.hasOwn(schema.flags, COMPLETIONS_FLAG_NAME)) return true;
	for (const [flagName, flagSchema] of Object.entries(schema.flags)) {
		if (
			getFlagAliasNames(flagSchema, { kind: 'long', includeHidden: true }).includes(
				COMPLETIONS_FLAG_NAME,
			)
		) {
			return true;
		}
		if (getFlagNegatedName(flagName, flagSchema) === COMPLETIONS_FLAG_NAME) return true;
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

function assertNoTopLevelRouteConflict(
	commands: readonly CommandSchema[],
	incoming: CommandSchema,
	defaultCommand?: CommandSchema | undefined,
): void {
	const routeOwners = new Map<string, string>();

	const existing = defaultCommand !== undefined ? [...commands, defaultCommand] : commands;
	for (const registered of existing) {
		for (const route of commandRoutes(registered)) {
			assertNoSiblingRouteConflict('root', routeOwners, route, registered.name);
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

// --- CLI schema — runtime descriptor for the CLI program

/**
 * Runtime descriptor for the CLI program.
 *
 * Stores the program name, version, description, and registered command schemas.\
 * Sealed by {@linkcode createCLISchema} and rebuilt by each {@linkcode CLIBuilder} step.
 */
interface CLISchema {
	/** Type-only seal produced by {@link createCLISchema}. */
	readonly [schemaBrand]: 'cli';
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
	/** Schemas of the registered commands, in registration order. */
	readonly commands: readonly CommandSchema[];
	/**
	 * Schema of the default command dispatched when no subcommand matches.
	 *
	 * When set, the CLI root behaves like a hybrid command group: subcommands
	 * dispatch by name as usual, but empty argv or flags-only argv falls
	 * through to this command instead of showing root help.
	 *
	 * Set via the {@linkcode CLIBuilder.default | .default()} builder method
	 * or the `defaultCommand` field of {@link CLIDefinition}.
	 */
	readonly defaultCommand: CommandSchema | undefined;
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
	 * Set via the {@linkcode CLIBuilder.manifest | .manifest()} builder method.
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
}

/**
 * Compiled execution graph per builder instance.
 *
 * Keyed weakly so handlers and execution steps stay off the public schema and
 * out of the emitted declarations.
 *
 * @internal
 */
const compiledStates = new WeakMap<CLIBuilder, CompiledCLI>();

/**
 * Read the compiled state seeded by {@linkcode CLIBuilder._from}.
 *
 * @param builder - Builder to look up.
 * @returns Its compiled execution graph.
 * @throws {@linkcode CLIError} `INVALID_BUILDER_STATE` when the builder was not created by `cli()`.
 *
 * @internal
 */
function compiledStateOf(builder: CLIBuilder): CompiledCLI {
	const compiled = compiledStates.get(builder);
	if (compiled === undefined) {
		throw new CLIError('CLI builder carries no compiled command graph', {
			code: 'INVALID_BUILDER_STATE',
			suggest: 'Create CLI builders with cli()',
		});
	}
	return compiled;
}

/**
 * Build the next builder in a chain, carrying the current compiled state.
 *
 * @param builder - Builder the chained call was made on.
 * @param schema - Schema for the new builder.
 * @returns The new builder.
 *
 * @internal
 */
function rebuild(builder: CLIBuilder, schema: CLISchema): CLIBuilder {
	return CLIBuilder._from(schema, compiledStateOf(builder));
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
	 * Order of flags in the `Flags:` table.
	 *
	 * - `'alphabetical'` — short-aliased flags first, then alphabetical by name.
	 * - `'declaration'` — the order `.flag()` was called.
	 *
	 * Ignored when {@link HelpConfig.sortFlags} is set.
	 *
	 * @defaultValue `'alphabetical'`
	 */
	readonly flagOrder?: 'alphabetical' | 'declaration';
	/**
	 * Custom comparator over flag long names for the `Flags:` table. When set,
	 * it wins over {@link HelpConfig.flagOrder}.
	 *
	 * @defaultValue `undefined` (use `flagOrder`)
	 */
	readonly sortFlags?: (a: string, b: string) => number;
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
	/** Type-only seal produced by {@link createCLISchema}. */
	readonly [schemaBrand]: 'config';
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
 * `app.schema.packageJsonSettings`. The type itself is generically named (it
 * holds discovery config for any manifest — `package.json`, `deno.json`,
 * `jsr.json`).
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
	 * (e.g. `['deno.json', 'deno.jsonc', 'jsr.json']` for a Deno CLI).
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

// --- CLI definition — input shape accepted by createCLISchema

/**
 * Input shape for {@link CLISchema.configSettings}, accepted by
 * {@link createCLISchema}.
 *
 * Mirrors {@link ConfigSettings} with `loaders` optional.
 */
interface ConfigSettingsDefinition {
	/** Application name used to build config search paths. */
	readonly appName: string;
	/**
	 * Additional format loaders beyond the built-in JSON loader.
	 * @defaultValue `undefined`
	 */
	readonly loaders?: readonly FormatLoader[] | undefined;
}

/**
 * Input shape accepted by {@link createCLISchema}.
 *
 * Every field except `name` is optional. Commands accept either
 * {@link CommandDefinition | definitions} or already-built
 * {@link CommandSchema | schemas}. Plugins are execution state and have no
 * definition field.
 */
interface CLIDefinition {
	/** Program name used in help text, usage lines, and completion scripts. */
	readonly name: string;
	/**
	 * Whether `.run()` should replace `name` with the invoked program name.
	 * @defaultValue `false`
	 */
	readonly inheritName?: boolean | undefined;
	/**
	 * Program version shown by `--version`.
	 * @defaultValue `undefined`
	 */
	readonly version?: string | undefined;
	/**
	 * Program description shown in root help.
	 * @defaultValue `undefined`
	 */
	readonly description?: string | undefined;
	/**
	 * Whether the default command is also exposed as a named top-level route.
	 * @defaultValue `false`
	 */
	readonly defaultCommandRouted?: boolean | undefined;
	/**
	 * Config discovery settings, as a definition or an already-built value.
	 * @defaultValue `undefined`
	 */
	readonly configSettings?: ConfigSettingsDefinition | ConfigSettings | undefined;
	/**
	 * Manifest auto-discovery settings.
	 * @defaultValue `undefined`
	 */
	readonly packageJsonSettings?: ResolvedManifestSettings | undefined;
	/**
	 * OSC 8 hyperlink targets for the root-help header.
	 * @defaultValue `undefined`
	 */
	readonly helpLinks?: HelpLinks | undefined;
	/**
	 * Whether built-in `.completions()` registration is active.
	 * @defaultValue `false`
	 */
	readonly hasBuiltInCompletions?: boolean | undefined;
	/**
	 * Eager `--completions <shell>` flag configuration.
	 * @defaultValue `undefined`
	 */
	readonly completionsFlag?: CompletionsFlagConfig | undefined;
	/**
	 * Consumer-configured root-help defaults.
	 * @defaultValue `undefined`
	 */
	readonly helpConfig?: HelpConfig | undefined;
	/**
	 * Flag-parsing behavior settings.
	 * @defaultValue `undefined`
	 */
	readonly flagSettings?: ParseOptions | undefined;
	/**
	 * Registered command definitions or built schemas, in registration order.
	 * @defaultValue `[]`
	 */
	readonly commands?: readonly (CommandDefinition | CommandSchema)[] | undefined;
	/**
	 * Default command dispatched when no subcommand matches.
	 * @defaultValue `undefined`
	 */
	readonly defaultCommand?: CommandDefinition | CommandSchema | undefined;
}

/**
 * {@link ConfigSettings} before the type-only seal is applied.
 *
 * @internal
 */
type ConfigSettingsDraft = Omit<ConfigSettings, typeof schemaBrand>;

/**
 * {@link CLISchema} before the type-only seals are applied, at the CLI level
 * and on the nested config settings.
 *
 * @internal
 */
type CLISchemaDraft = Omit<CLISchema, typeof schemaBrand | 'configSettings'> & {
	readonly configSettings: ConfigSettingsDraft | undefined;
};

/**
 * Apply the type-only seal to a fully populated CLI schema draft.
 *
 * The brand has no runtime value, so this is the single construction path for
 * {@link CLISchema} and {@link ConfigSettings} values in this module.
 *
 * @param draft - Draft carrying every schema field.
 * @returns The sealed schema.
 *
 * @internal
 */
function sealCLISchema(draft: CLISchemaDraft): CLISchema {
	return draft as CLISchema;
}

/**
 * Merge definition fields onto the {@link CLISchema} defaults.
 *
 * @param definition - CLI definition with the name already validated.
 * @returns A fully populated {@link CLISchema}.
 *
 * @internal
 */
function buildCLISchema(definition: CLIDefinition): CLISchema {
	const configSettings = definition.configSettings;
	return sealCLISchema({
		name: definition.name,
		inheritName: definition.inheritName ?? false,
		version: definition.version,
		description: definition.description,
		commands: (definition.commands ?? []).map((child) => createCommandSchema(child)),
		defaultCommand:
			definition.defaultCommand !== undefined
				? createCommandSchema(definition.defaultCommand)
				: undefined,
		defaultCommandRouted: definition.defaultCommandRouted ?? false,
		configSettings:
			configSettings !== undefined
				? { appName: configSettings.appName, loaders: configSettings.loaders }
				: undefined,
		packageJsonSettings: definition.packageJsonSettings,
		helpLinks: definition.helpLinks,
		hasBuiltInCompletions: definition.hasBuiltInCompletions ?? false,
		completionsFlag: definition.completionsFlag,
		helpConfig: definition.helpConfig,
		flagSettings: definition.flagSettings,
	});
}

/**
 * Create a {@link CLISchema} from a plain definition object.
 *
 * Most consumers should prefer {@link cli | cli()}, which returns a
 * {@link CLIBuilder} carrying the execution graph. `createCLISchema()` builds a
 * description only: it normalizes commands recursively through
 * {@link createCommandSchema}, so handlers and execution steps are not part of
 * the result and the schema cannot be executed.
 *
 * Feeding a built schema back in produces a deep-equal schema.
 *
 * @param definition - Program name plus optional metadata and commands.
 * @returns A fully populated {@link CLISchema}.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` when the name is empty.
 * @throws {CLIError} With code `'RESERVED_FLAG'` when a command spells a flag
 *   the same way as a root-owned flag (`--json`, `--quiet`/`-q`, `--help`/`-h`,
 *   `--version`/`-V` once `version` is set, and `--completions` once
 *   `completionsFlag` is set), by name, alias, or negated spelling.
 *
 * @example
 * ```ts
 * const schema = createCLISchema({
 *   name: 'mycli',
 *   version: '1.0.0',
 *   commands: [{ name: 'deploy', flags: { force: { kind: 'boolean' } } }],
 * });
 * ```
 */
function createCLISchema(definition: CLIDefinition): CLISchema {
	if (definition.name === '') {
		throw new CLIError('CLI schema requires a non-empty name', {
			code: 'INVALID_SCHEMA',
			details: { name: definition.name },
			suggest: 'Pass a program name such as { name: "mycli" }',
		});
	}

	const schema = buildCLISchema(definition);
	const registered = [schema.defaultCommand, ...schema.commands];
	assertNoReservedFlagCollisions(schema.version, registered);
	if (schema.completionsFlag !== undefined) {
		for (const cmd of registered) {
			if (cmd !== undefined) assertNoCompletionsFlagCollision(cmd);
		}
	}
	return schema;
}

// --- Options for execute/run

/**
 * Options for {@linkcode CLIBuilder.execute | .execute()}, the process-free
 * execution surface.
 *
 * Derives from {@linkcode RunOptions} with every input injected explicitly.
 */
interface CLIExecuteOptions extends RunOptions {}

/**
 * Options for {@linkcode CLIBuilder.run | .run()}.
 *
 * Derives from {@linkcode CLIExecuteOptions}, adding the CLI-level runtime adapter.
 */
interface CLIRunOptions extends CLIExecuteOptions {
	/**
	 * Runtime adapter providing platform-specific I/O, argv, env, etc.
	 *
	 * Replaces the default Node adapter.
	 */
	readonly adapter?: RuntimeAdapter;
}

/**
 * CLI execution options extended with the fields `.run()` and dispatch
 * populate themselves.
 *
 * @internal
 */
interface InternalCLIExecuteOptions extends CLIExecuteOptions {
	/** Output channel override so activity renders to the terminal. */
	readonly out?: Out;
	/** Capture buffers override paired with `out`. */
	readonly captured?: CapturedOutput;
	/** CLI plugins registered on the builder. */
	readonly plugins?: readonly CLIPlugin[];
}

// --- Render context

/**
 * Inputs for {@linkcode resolveRenderContext}. Pass the host facts (TTY
 * status, environment) and any explicit overrides; the resolver applies the
 * same gating `.execute()`/`.run()` feed into the output channel.
 */
interface RenderContextOptions {
	/**
	 * Whether stdout is connected to a TTY (e.g. `process.stdout.isTTY`).
	 *
	 * @defaultValue `false`
	 */
	readonly isTTY?: boolean;
	/**
	 * JSON mode when argv carries no root `--json`. An explicit `--json=false`
	 * in argv wins over this.
	 *
	 * @defaultValue detected from a pre-separator `--json` in `argv`
	 */
	readonly jsonMode?: boolean;
	/**
	 * Output verbosity when argv carries no root `--quiet`/`-q`. An explicit
	 * `--quiet=false` in argv wins over this.
	 *
	 * @defaultValue detected from a pre-separator `--quiet`/`-q` in `argv`,
	 *   otherwise `'normal'`
	 */
	readonly verbosity?: Verbosity;
	/**
	 * Explicitly enable or disable colors, winning over the auto-gate.
	 *
	 * @defaultValue auto — `isTTY && !jsonMode` and environment support
	 */
	readonly color?: boolean;
	/**
	 * Environment variables consulted for `NO_HYPERLINKS`/`FORCE_HYPERLINKS`
	 * (e.g. `process.env`).
	 *
	 * @defaultValue `{}`
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Seals {@linkcode RenderContext} against structural construction outside the
 * framework.
 *
 * @internal
 */
const renderContextBrand: unique symbol = Symbol('dreamcli.renderContext');

/**
 * The output decisions the framework will make for a given argv, resolved
 * before `.run()`.
 *
 * `RenderContext` is a framework-created, non-exhaustive value: obtain
 * instances from {@linkcode resolveRenderContext} — do not implement it. New
 * readonly members may be added in minor releases.
 */
interface RenderContext {
	/** Framework-construction seal. Obtain values from `resolveRenderContext()`; do not implement this interface. */
	readonly [renderContextBrand]: never;
	/** Whether a pre-separator `--json` puts the run in JSON mode. */
	readonly jsonMode: boolean;
	/** Active verbosity after pre-separator `--quiet`/`-q` detection. */
	readonly verbosity: Verbosity;
	/** The TTY status the output channel will carry. */
	readonly isTTY: boolean;
	/**
	 * The gated ANSI palette the output channel will expose as `out.color` —
	 * identity formatters when color is off; `color.isColorSupported` is the
	 * boolean gate.
	 */
	readonly color: Colors;
	/** Whether OSC 8 hyperlinks should be emitted (see `out.isHyperlinkSupported`). */
	readonly isHyperlinkSupported: boolean;
}

/**
 * Concrete {@linkcode RenderContext} carrying the resolved output decisions.
 *
 * @internal
 */
class ResolvedRenderContext implements RenderContext {
	declare readonly [renderContextBrand]: never;

	readonly jsonMode: boolean;
	readonly verbosity: Verbosity;
	readonly isTTY: boolean;
	readonly color: Colors;
	readonly isHyperlinkSupported: boolean;

	constructor(out: Out) {
		this.jsonMode = out.jsonMode;
		this.verbosity = out.verbosity;
		this.isTTY = out.isTTY;
		this.color = out.color;
		this.isHyperlinkSupported = out.isHyperlinkSupported;
	}
}

/**
 * Resolve the render context for content built before `.run()`.
 *
 * Content styled ahead of execution — hand-rendered banners, custom help, or
 * anything else emitted outside an action handler — has no `out` to consult,
 * which pushes consumers into re-deriving the framework's decisions from raw
 * argv (`argv.includes('--json')` misreads a post-`--` literal). This probe
 * runs the same composition `.execute()`/`.run()` feed into the output
 * channel — `--`-aware `--json` detection, the color gate, and the hyperlink
 * override — so pre-run styling matches the channel that will render.
 *
 * @param argv - Raw argv tokens (NOT including the binary/script path,
 *   i.e. equivalent to `process.argv.slice(2)`).
 * @param options - Host facts and overrides.
 * @returns The resolved output decisions.
 *
 * @example
 * ```ts
 * const ctx = resolveRenderContext(process.argv.slice(2), {
 *   isTTY: process.stdout.isTTY === true,
 *   env: process.env,
 * });
 * const banner = ctx.color.bold('mycli');
 * ```
 */
function resolveRenderContext(
	argv: readonly string[],
	options?: RenderContextOptions,
): RenderContext {
	const rootOutputFlags = readRootOutputFlags(argv);
	const jsonMode = resolveRootJsonMode(rootOutputFlags, options?.jsonMode);
	const verbosity = resolveRootVerbosity(rootOutputFlags, options?.verbosity) ?? 'normal';
	const out = createOutput({
		jsonMode,
		isTTY: options?.isTTY ?? false,
		verbosity,
		...(options?.color !== undefined ? { color: options.color } : {}),
		...hyperlinksOption(resolveHyperlinkOverride(options?.env ?? {}, argv)),
	});
	return new ResolvedRenderContext(out);
}

// --- Command run options builder

/**
 * Conditional-spread wrapper for the output channel's `hyperlinks` option:
 * omit the key entirely when there is no override so `exactOptionalPropertyTypes`
 * stays happy and the channel falls back to `isTTY`.
 *
 * @internal
 */
function hyperlinksOption(override: boolean | undefined): { hyperlinks?: boolean } {
	return override !== undefined ? { hyperlinks: override } : {};
}

/**
 * Build {@linkcode RunOptions} from {@linkcode CLIExecuteOptions}, conditionally spreading each
 * field to satisfy `exactOptionalPropertyTypes`.
 *
 * @param options - CLI-level run options (may be `undefined` for defaults).
 * @param helpOptions - Help formatting options forwarded to commands.
 * @param meta - Optional command metadata (omitted for root-level dispatch).
 * @returns Options record ready for the shared executor.
 *
 * @internal
 */
function buildCommandRunOptions(
	options: InternalCLIExecuteOptions | undefined,
	helpOptions: HelpOptions,
	meta?: CommandMeta,
): InternalRunOptions {
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
		...(options?.mkdir !== undefined ? { mkdir: options.mkdir } : {}),
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

	private constructor(schema: CLISchema) {
		this.schema = schema;
	}

	/**
	 * Build a CLI builder around a schema and its compiled execution graph.
	 *
	 * @param schema - Runtime schema descriptor.
	 * @param compiled - Compiled commands, default command, and plugins.
	 * @returns The builder, with its compiled state registered.
	 *
	 * @internal
	 */
	static _from(schema: CLISchema, compiled: CompiledCLI): CLIBuilder {
		const builder = new CLIBuilder(schema);
		compiledStates.set(builder, compiled);
		return builder;
	}

	// -- Metadata modifiers --------------------------------------------------

	/**
	 * Set the program version (shown by `--version`).
	 *
	 * Declaring a version also reserves `--version`/`-V` on every registered
	 * command, so this rejects a command that already declares either spelling.
	 *
	 * @param v - Semantic version string.
	 * @returns The builder (for chaining).
	 * @throws {@link CLIError} `RESERVED_FLAG` when a registered command declares
	 *   a flag named `version` or aliased `V`.
	 */
	version(v: string): CLIBuilder {
		assertNoReservedFlagCollisions(v, [this.schema.defaultCommand, ...this.schema.commands]);
		return rebuild(this, { ...this.schema, version: v });
	}

	/**
	 * Set the program description (shown in root help).
	 *
	 * @param text - Short description displayed in root help output.
	 * @returns The builder (for chaining).
	 */
	description(text: string): CLIBuilder {
		return rebuild(this, { ...this.schema, description: text });
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
		return rebuild(this, {
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
		return rebuild(this, {
			...this.schema,
			helpConfig: { ...this.schema.helpConfig, ...config },
		});
	}

	/**
	 * Enable automatic config file discovery.
	 *
	 * When enabled, `.run()` probes standard paths before dispatching,
	 * first match wins, no merging:
	 * 1. Project scope — for `$CWD` and each ancestor directory up to the
	 *    filesystem root, nearest first:
	 *    `.{appName}.json`, `{appName}.config.json`, `.config/{appName}.json`
	 * 2. User scope — `{dir}/{appName}/config.json` for each user config
	 *    root (`$XDG_CONFIG_HOME` / `~/.config` on Unix, plus
	 *    `~/Library/Application Support` on macOS,
	 *    `%APPDATA%` / `%USERPROFILE%\\AppData\\Roaming` on Windows)
	 * 3. System scope — `/etc/{appName}/config.json` on Linux and macOS
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
		return rebuild(
			this,
			sealCLISchema({
				...this.schema,
				configSettings: {
					appName,
					loaders,
				},
			}),
		);
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
		return rebuild(
			this,
			sealCLISchema({
				...this.schema,
				configSettings: {
					...this.schema.configSettings,
					loaders: [...existing, loader],
				},
			}),
		);
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
	 *     `import.meta.url` for installable CLIs that must report THEIR OWN
	 *     version. If the consumer's ambient `ImportMeta` omits `url`, pass
	 *     `import.meta` instead. Also accepts string paths, `file:` URL strings,
	 *     or `URL` instances.
	 *
	 * @example
	 * ```ts
	 * // Deno CLI: discover OUR deno.json (then jsr.json), keep the scope in name:
	 * cli('mycli')
	 *   .manifest({
	 *     files: ['deno.json', 'jsr.json'],
	 *     from: import.meta.url,
	 *     inferName: { scope: 'keep' },
	 *   })
	 *   .command(deploy)
	 *   .run();
	 * ```
	 */
	manifest(settings?: ManifestSettings): CLIBuilder;
	manifest(input?: PackageJsonData | ManifestSettings): CLIBuilder {
		const next = buildManifestSchema(this.schema, input, DEFAULT_MANIFEST_FILES);
		assertNoReservedFlagCollisions(next.version, [next.defaultCommand, ...next.commands]);
		return rebuild(this, next);
	}

	// -- Command registration ------------------------------------------------

	/**
	 * Register a command with the CLI program.
	 *
	 * The command's schema joins {@link CLISchema.commands}; its handler and
	 * subcommand tree are compiled into the builder's execution graph.
	 *
	 * @param cmd - {@link CommandBuilder} to register.
	 * @returns The builder (for chaining).
	 * @throws {@link CLIError} `RESERVED_FLAG` when the command, or one of its
	 *   nested subcommands, declares a flag named or aliased to a root-owned flag
	 *   (`--json`, `--quiet`/`-q`, `--help`/`-h`, and `--version`/`-V` once
	 *   {@link CLIBuilder.version | .version()} is set).
	 */
	command<
		F extends Record<string, FlagBuilder<FlagConfig>>,
		A extends Record<string, ArgBuilder<ArgConfig>>,
		C extends Record<string, unknown>,
	>(cmd: CommandBuilder<F, A, C>): CLIBuilder {
		assertNoTopLevelRouteConflict(this.schema.commands, cmd.schema, this.schema.defaultCommand);
		assertNoReservedFlagCollisions(this.schema.version, [cmd.schema]);
		if (this.schema.completionsFlag !== undefined) {
			assertNoCompletionsFlagCollision(cmd.schema);
		}

		const compiled = compiledStateOf(this);
		return CLIBuilder._from(
			{
				...this.schema,
				commands: [...this.schema.commands, cmd.schema],
			},
			{
				...compiled,
				commands: [...compiled.commands, compileCommand(cmd)],
			},
		);
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
	 * @throws {@link CLIError} `RESERVED_FLAG` when the command, or one of its
	 *   nested subcommands, declares a flag named or aliased to a root-owned flag
	 *   (`--json`, `--quiet`/`-q`, `--help`/`-h`, and `--version`/`-V` once
	 *   {@link CLIBuilder.version | .version()} is set).
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
		assertNoReservedFlagCollisions(this.schema.version, [cmd.schema]);
		if (this.schema.completionsFlag !== undefined) {
			assertNoCompletionsFlagCollision(cmd.schema);
		}

		const compiled = compiledStateOf(this);
		return CLIBuilder._from(
			{
				...this.schema,
				defaultCommand: cmd.schema,
				defaultCommandRouted: options?.route ?? false,
			},
			{
				...compiled,
				defaultCommand: compileCommand(cmd),
			},
		);
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
		const compiled = compiledStateOf(this);
		return CLIBuilder._from(this.schema, {
			...compiled,
			plugins: [...compiled.plugins, definition],
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
				assertNoCompletionsFlagCollision(this.schema.defaultCommand);
			}
			for (const registered of this.schema.commands) {
				assertNoCompletionsFlagCollision(registered);
			}
			return rebuild(this, {
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
		return rebuild(withCompletions, {
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
	async execute(argv: readonly string[], options?: CLIExecuteOptions): Promise<RunResult> {
		return executeCLI(this, argv, options);
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

		const compiled = compiledStateOf(this);
		const preflight = await prepareRuntimePreflight({
			schema: this.schema,
			compiled,
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
			preflight.schema === this.schema
				? this
				: rebuild(this, sealCLISchema({ ...this.schema, ...preflight.schema }));
		const terminalSize = adapter.getTerminalSize();
		const runtimeHelpWidth =
			options?.help?.width === undefined && preflight.schema.helpConfig?.width === undefined
				? terminalSize?.columns
				: undefined;
		const runtimeHelpOptions =
			runtimeHelpWidth !== undefined
				? { ...options?.help, width: runtimeHelpWidth }
				: options?.help;
		const executeOptions: InternalCLIExecuteOptions = {
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
				...hyperlinksOption(resolveHyperlinkOverride(adapter.env, adapter.argv)),
			}),
		};
		const result = await executeCLI(effectiveBuilder, preflight.filteredArgv, executeOptions);

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

/**
 * Execution body shared by {@linkcode CLIBuilder.execute} and {@linkcode CLIBuilder.run},
 * accepting the framework-populated output channel and plugin fields.
 *
 * @param builder - Builder supplying the schema and compiled command graph.
 * @param argv - Raw argv tokens (NOT including the binary/script path).
 * @param options - Injectable runtime state plus framework-populated fields.
 * @returns Structured result with exit code and captured output.
 *
 * @internal
 */
async function executeCLI(
	builder: CLIBuilder,
	argv: readonly string[],
	options?: InternalCLIExecuteOptions,
): Promise<RunResult> {
	// -- Detect global --json / --quiet before building output ----------------
	const rootOutputFlags = readRootOutputFlags(argv);
	const jsonMode = resolveRootJsonMode(rootOutputFlags, options?.jsonMode);
	const verbosity: Verbosity | undefined = resolveRootVerbosity(
		rootOutputFlags,
		options?.verbosity,
	);

	const captureOptions = {
		...(verbosity !== undefined ? { verbosity } : {}),
		...(jsonMode ? { jsonMode } : {}),
		...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
		...hyperlinksOption(resolveHyperlinkOverride(options?.env ?? {}, argv)),
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
	// name, hyperlinks to the channel's resolved support (NO_HYPERLINKS/
	// FORCE_HYPERLINKS honored, else TTY), and colors to the output
	// channel's gated palette (escapes never leak into piped output).
	const resolvedVersion = options?.help?.version ?? builder.schema.version;
	const helpOptions: HelpOptions = {
		...builder.schema.helpConfig,
		...options?.help,
		binName: options?.help?.binName ?? builder.schema.name,
		hyperlinks:
			options?.help?.hyperlinks ??
			builder.schema.helpConfig?.hyperlinks ??
			out.isHyperlinkSupported,
		colors: options?.help?.colors ?? out.color,
		...(resolvedVersion !== undefined ? { version: resolvedVersion } : {}),
	};

	// -- Shared options for command execution ----------------------------------
	const compiled = compiledStateOf(builder);
	const flagSettings = options?.flags ?? builder.schema.flagSettings;
	const effectiveOptions: InternalCLIExecuteOptions = {
		...options,
		plugins: compiled.plugins,
		...(jsonMode ? { jsonMode } : {}),
		...(verbosity !== undefined ? { verbosity } : {}),
		...(flagSettings !== undefined ? { flags: flagSettings } : {}),
	};
	const output: OutputPolicy = {
		jsonMode,
		isTTY: out.isTTY,
		verbosity: verbosity ?? 'normal',
	};
	// The planner scans flag arity during dispatch, so it must see the same
	// merged flag settings (runtime override wins) that command parsing uses.
	const planSchema =
		options?.flags !== undefined ? { ...builder.schema, flagSettings } : builder.schema;
	const planned = planInvocation({
		schema: planSchema,
		compiled,
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
				helpOptions.binName === undefined || helpOptions.binName === builder.schema.name
					? builder.schema
					: { ...builder.schema, name: helpOptions.binName };
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
				out.json(
					generateSchema(builder.schema, undefined, {
						name: planned.help.binName ?? builder.schema.name,
						version: planned.help.version ?? builder.schema.version,
					}),
				);
			} else {
				const helpText = formatRootHelp(resolveHelpLinksSchema(builder.schema), planned.help);
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
				out.json(
					generateCommandSchema(planned.command.schema, undefined, {
						name: planned.help.binName ?? planned.command.schema.name,
						version: planned.help.version,
					}),
				);
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
			const result = await executeCommand({
				command: {
					handler: planned.plan.command.handler,
					steps: planned.plan.command.steps,
				},
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
 * Resolve derived help links against pre-loaded manifest data.
 *
 * `.run()` resolves links during runtime preflight (where discovered manifest
 * metadata lives); this covers the filesystem-free `.execute()` path, where
 * only the `.manifest(data)` overload can contribute. Idempotent —
 * already-resolved fields pass through unchanged.
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

/** Default manifest filenames for `.manifest()`. @internal */
const DEFAULT_MANIFEST_FILES: readonly string[] = ['package.json'];

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
	 * Anchor discovery to a file/URL/path instead of `cwd`. Normally, pass
	 * `import.meta.url`. Pass `import.meta` whole as a compatibility form when a
	 * project `tsconfig.json` `lib` override drops the runtime's ambient
	 * `ImportMeta` extras and direct `.url` access does not type-check.
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
 * Build the next {@link CLISchema} for {@link CLIBuilder.manifest}.
 *
 * The data overload (detected via field shape) merges `version`/`description`
 * immediately so `.execute()` sees them; the settings overload stores discovery
 * config for runtime preflight.
 *
 * @internal
 */
function buildManifestSchema(
	schema: CLISchema,
	input: PackageJsonData | ManifestSettings | undefined,
	defaultFiles: readonly string[],
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
	const files = input?.files ?? defaultFiles;
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

// --- manifest.from normalisation

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
 * `.manifest()` from the settings overload at runtime.
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

	return CLIBuilder._from(createCLISchema({ name, inheritName, flagSettings: options.flags }), {
		commands: [],
		defaultCommand: undefined,
		plugins: [],
	});
}

/**
 * Report whether the calling module is the process entrypoint, cross-runtime.
 *
 * Node, Bun, and Deno set `import.meta.main` on the module invoked directly;
 * projects with the runtime's ambient types can read that property directly.
 * This helper is a compatibility form for projects whose `tsconfig.json` `lib`
 * override drops those `ImportMeta` extras: passing `import.meta` whole avoids
 * a direct `.main` access without requiring global augmentation.
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
	CLIDefinition,
	CLIExecuteOptions,
	CLIOptions,
	CLIRunOptions,
	CLISchema,
	CompletionsFlagConfig,
	ConfigSettings,
	ConfigSettingsDefinition,
	DefaultCommandOptions,
	HelpConfig,
	InferNameOption,
	ManifestSettings,
	RenderContext,
	RenderContextOptions,
	ResolvedManifestSettings,
};
export {
	CLIBuilder,
	cli,
	compiledStateOf,
	createCLISchema,
	executeCLI,
	formatRootHelp,
	isMainModule,
	plugin,
	resolveRenderContext,
};
