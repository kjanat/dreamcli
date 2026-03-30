/**
 * CLI entry point builder with command registration and dispatch.
 *
 * The `cli()` factory returns an immutable `CLIBuilder` that registers
 * commands, handles `--help`/`--version` at root level, dispatches to
 * the matched command, and provides both a testable `.execute()` path
 * and a production `.run()` path.
 *
 * @module dreamcli/core/cli
 */

import type { RuntimeAdapter } from '../../runtime/adapter.ts';
import { createAdapter } from '../../runtime/auto.ts';
import type { Shell } from '../completion/index.ts';
import { generateCompletion, SHELLS } from '../completion/index.ts';
import type { FormatLoader } from '../config/index.ts';
import { discoverConfig } from '../config/index.ts';
import { discoverPackageJson, inferCliName } from '../config/package-json.ts';
import { CLIError, ParseError } from '../errors/index.ts';
import type { HelpOptions } from '../help/index.ts';
import { formatHelp } from '../help/index.ts';
import type { CapturedOutput, Verbosity } from '../output/index.ts';
import { createCaptureOutput } from '../output/index.ts';
import type { PromptEngine, TestAnswer } from '../prompt/index.ts';
import { createTerminalPrompter } from '../prompt/index.ts';
import type { ArgBuilder, ArgConfig } from '../schema/arg.ts';
import { arg } from '../schema/arg.ts';
import type {
	CommandBuilder,
	CommandMeta,
	CommandSchema,
	ErasedCommand,
} from '../schema/command.ts';
import { command } from '../schema/command.ts';
import type { FlagBuilder, FlagConfig } from '../schema/flag.ts';
import type { RunOptions, RunResult } from '../testkit/index.ts';
import { runCommand } from '../testkit/index.ts';
import { dispatch, findClosestCommand } from './dispatch.ts';
import type { CLIPlugin } from './plugin.ts';
import { plugin } from './plugin.ts';
import { collectPropagatedFlags } from './propagate.ts';
import { formatRootHelp } from './root-help.ts';

// ---------------------------------------------------------------------------
// Type-erased command — erasure function (interface now in schema/command.ts)
// ---------------------------------------------------------------------------

/**
 * Erase a typed CommandBuilder into an ErasedCommand, recursively
 * building the subcommand tree.
 *
 * The closure captures the fully-typed builder, so `runCommand()` receives
 * the original `CommandBuilder<F, A>` — no type assertions needed.
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
	for (const sub of cmd._subcommands) {
		const erased = eraseCommand(sub);
		subcommands.set(sub.schema.name, erased);
		for (const alias of sub.schema.aliases) {
			subcommands.set(alias, erased);
		}
	}

	return {
		schema: cmd.schema,
		subcommands,
		_execute(argv, options) {
			return runCommand(cmd, argv, options);
		},
	};
}

// ---------------------------------------------------------------------------
// CLI schema — runtime descriptor for the CLI program
// ---------------------------------------------------------------------------

/**
 * Runtime descriptor for the CLI program.
 *
 * Stores the program name, version, description, and registered commands.
 * Built incrementally by `CLIBuilder`.
 */
interface CLISchema {
	/** Program name (used in help text and usage line). */
	readonly name: string;
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
	 * Set via the `.default()` builder method.
	 */
	readonly defaultCommand: ErasedCommand | undefined;
	/**
	 * Config discovery settings. When defined, `.run()` auto-discovers and
	 * loads a config file before command dispatch.
	 *
	 * Set via the `.config()` builder method.
	 */
	readonly configSettings: ConfigSettings | undefined;
	/**
	 * Package.json auto-discovery settings. When defined, `.run()` discovers
	 * the nearest `package.json` and merges metadata before dispatch.
	 *
	 * Set via the `.packageJson()` builder method.
	 */
	readonly packageJsonSettings: PackageJsonSettings | undefined;
	/** Registered CLI plugins. */
	readonly plugins: readonly CLIPlugin[];
}

/**
 * Config discovery settings for automatic config file loading.
 *
 * Stored in {@link CLISchema} and consumed by `CLIBuilder.run()` to
 * call {@link discoverConfig} before dispatching to a command.
 */
interface ConfigSettings {
	/**
	 * Application name used to build config search paths.
	 *
	 * Search paths: `.{appName}.json` (cwd), `{appName}.config.json` (cwd),
	 * `$CONFIG_DIR/{appName}/config.json` (XDG / AppData).
	 */
	readonly appName: string;

	/** Additional format loaders beyond the built-in JSON loader. */
	readonly loaders: readonly FormatLoader[] | undefined;
}

/**
 * Package.json auto-discovery settings.
 *
 * Stored in {@link CLISchema} and consumed by `CLIBuilder.run()` to
 * call {@link discoverPackageJson} before dispatching to a command.
 */
interface PackageJsonSettings {
	/**
	 * Infer CLI name from package.json `bin` keys or `name` field.
	 *
	 * When `true`, the discovered name replaces the `cli(name)` value.
	 * Explicit `.version()`/`.description()` calls still take precedence
	 * over discovered values.
	 *
	 * @default false
	 */
	readonly inferName: boolean;
}

// ---------------------------------------------------------------------------
// Options for execute/run
// ---------------------------------------------------------------------------

/**
 * Options for `CLIBuilder.execute()` and `CLIBuilder.run()`.
 *
 * Mirrors `RunOptions` from testkit but adds CLI-level concerns
 * (version display, root help formatting, runtime adapter).
 */
interface CLIRunOptions {
	/**
	 * CLI plugins to apply for this execution.
	 *
	 * @internal — populated from `CLIBuilder.schema.plugins` during dispatch.
	 */
	readonly plugins?: readonly CLIPlugin[];

	/**
	 * Runtime adapter providing platform-specific I/O, argv, env, etc.
	 *
	 * When provided to `.run()`, replaces the default Node adapter.
	 * Ignored by `.execute()` (which is process-free by design).
	 */
	readonly adapter?: RuntimeAdapter;

	/**
	 * Environment variables for flag resolution.
	 *
	 * Flags with `.env('VAR')` configured resolve from this record
	 * when no CLI value is provided (CLI → env → config → default).
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;

	/**
	 * Configuration object for flag resolution.
	 *
	 * Flags with `.config('path')` configured resolve from this record
	 * when no CLI or env value is provided (CLI → env → config → prompt → default).
	 * Config is plain JSON — file loading is the caller's responsibility.
	 */
	readonly config?: Readonly<Record<string, unknown>>;

	/**
	 * Full stdin contents for args configured with `.stdin()`.
	 *
	 * `run()` populates this from `adapter.readStdin()`. `execute()` accepts it
	 * directly so tests can simulate piped input without a runtime adapter.
	 */
	readonly stdinData?: string | null;

	/**
	 * Prompt engine for interactive flag resolution.
	 *
	 * When provided, flags with `.prompt()` configured that have no value
	 * after CLI/env/config resolution will be prompted interactively.
	 * When absent (and `answers` is also absent), prompting is skipped.
	 *
	 * Takes precedence over `answers` when both are provided.
	 */
	readonly prompter?: PromptEngine;

	/**
	 * Pre-configured prompt answers for testing convenience.
	 *
	 * When provided, a test prompter is created from these answers via
	 * `createTestPrompter(answers)`. Each entry is consumed in order —
	 * use `PROMPT_CANCEL` to simulate cancellation.
	 *
	 * Ignored when an explicit `prompter` is provided.
	 */
	readonly answers?: readonly TestAnswer[];

	/**
	 * Verbosity level for the output channel.
	 * @default 'normal'
	 */
	readonly verbosity?: Verbosity;

	/**
	 * Enable JSON output mode.
	 *
	 * When `true`, `log` and `info` messages are redirected to stderr
	 * so that stdout is reserved exclusively for structured `json()` output.
	 * Errors are also rendered as JSON to stderr.
	 *
	 * @default false
	 */
	readonly jsonMode?: boolean;

	/**
	 * Whether stdout is connected to a TTY.
	 *
	 * When provided, propagated to the output channel's `isTTY` field.
	 * In `.run()`, automatically sourced from `adapter.isTTY` when not
	 * explicitly set.
	 *
	 * @default false
	 */
	readonly isTTY?: boolean;

	/**
	 * Help formatting options (width, binName).
	 * `binName` defaults to the CLI program name.
	 */
	readonly help?: HelpOptions;
}

// ---------------------------------------------------------------------------
// --config flag extraction
// ---------------------------------------------------------------------------

/**
 * Extract `--config <path>` or `--config=<path>` from argv.
 *
 * Returns the config path (if present) and the filtered argv with the
 * flag (and its value) removed. Bare `--config` at end of argv (no value)
 * and `--config=` (empty value) are silently ignored (treated as absent).
 *
 * The `--config=<path>` form is checked first so that a bare `--config`
 * token does not consume the next element when an equals-form is present.
 *
 * @internal
 */
function extractConfigFlag(argv: readonly string[]): {
	readonly configPath: string | undefined;
	readonly filteredArgv: readonly string[];
} {
	// --- equals form: --config=<path> ---
	const eqIdx = argv.findIndex((arg) => arg.startsWith('--config='));
	if (eqIdx !== -1) {
		const value = (argv[eqIdx] as string).slice('--config='.length);
		// Always strip the element; empty value (--config=) treated as absent.
		const filteredArgv = [...argv.slice(0, eqIdx), ...argv.slice(eqIdx + 1)];
		return {
			configPath: value.length > 0 ? value : undefined,
			filteredArgv,
		};
	}

	// --- space-separated form: --config <path> ---
	const idx = argv.indexOf('--config');
	const nextArg = idx >= 0 ? argv[idx + 1] : undefined;
	if (idx === -1 || nextArg === undefined) {
		return { configPath: undefined, filteredArgv: argv };
	}
	const filteredArgv = [...argv.slice(0, idx), ...argv.slice(idx + 2)];
	return { configPath: nextArg, filteredArgv };
}

// ---------------------------------------------------------------------------
// CLI → CommandMeta builder
// ---------------------------------------------------------------------------

/**
 * Build {@link CommandMeta} from CLI-level schema and the leaf command name.
 *
 * @internal
 */
function buildMeta(
	cliSchema: CLISchema,
	helpOptions: HelpOptions,
	commandName: string,
): CommandMeta {
	return {
		name: cliSchema.name,
		bin: helpOptions.binName ?? cliSchema.name,
		version: cliSchema.version,
		command: commandName,
	};
}

// ---------------------------------------------------------------------------
// Command run options builder
// ---------------------------------------------------------------------------

/**
 * Build `RunOptions` from `CLIRunOptions`, handling
 * `exactOptionalPropertyTypes` by conditionally spreading each field.
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
		...(options?.verbosity !== undefined ? { verbosity: options.verbosity } : {}),
		...(options?.jsonMode !== undefined ? { jsonMode: options.jsonMode } : {}),
		...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
	};
}

// ---------------------------------------------------------------------------
// CLIBuilder — immutable builder for the CLI program
// ---------------------------------------------------------------------------

/**
 * Immutable CLI program builder.
 *
 * Registers commands, handles root-level `--help`/`--version`, and
 * dispatches to the matched command based on argv.
 *
 * Two execution paths:
 * - `.execute(argv, options?)` — testable, returns `RunResult`
 * - `.run(options?)` — production entry, reads `process.argv`, exits process
 *
 * @example
 * ```ts
 * import { cli, command, flag, arg } from 'dreamcli';
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

	constructor(schema: CLISchema) {
		this.schema = schema;
	}

	// -- Metadata modifiers --------------------------------------------------

	/** Set the program version (shown by `--version`). */
	version(v: string): CLIBuilder {
		return new CLIBuilder({ ...this.schema, version: v });
	}

	/** Set the program description (shown in root help). */
	description(text: string): CLIBuilder {
		return new CLIBuilder({ ...this.schema, description: text });
	}

	/**
	 * Enable automatic config file discovery.
	 *
	 * When enabled, `.run()` probes standard paths before dispatching:
	 * 1. `$CWD/.{appName}.json`
	 * 2. `$CWD/{appName}.config.json`
	 * 3. `$CONFIG_DIR/{appName}/config.json`
	 *
	 * The user can override the path via `--config <path>`.
	 *
	 * Loaded config feeds into the resolution chain
	 * (CLI → env → **config** → prompt → default) for flags that
	 * declare `.config('dotted.path')`.
	 *
	 * Has no effect in `.execute()` (which receives config via
	 * `options.config` directly).
	 *
	 * @param appName - Name used to build search paths.
	 * @param loaders - Additional format loaders (JSON is built-in).
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
	 *
	 * @example
	 * ```ts
	 * import { configFormat } from 'dreamcli';
	 * import { parse as parseYAML } from 'yaml';
	 * import { parse as parseTOML } from '@iarna/toml';
	 *
	 * cli('myapp')
	 *   .config('myapp')
	 *   .configLoader(configFormat(['yaml', 'yml'], parseYAML))
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
	 * Enable automatic package.json metadata discovery.
	 *
	 * When enabled, `.run()` walks up from `cwd` to find the nearest
	 * `package.json` and merges its `version` and `description` fields
	 * into the CLI schema. Explicit `.version()` and `.description()`
	 * calls always take precedence over discovered values.
	 *
	 * Has no effect in `.execute()` (which is filesystem-free by design).
	 *
	 * @param settings - Optional settings. Pass `{ inferName: true }` to
	 *   also infer the CLI name from `bin` keys or the package `name` field.
	 *
	 * @example
	 * ```ts
	 * // Auto-fill version + description from nearest package.json:
	 * cli('mycli')
	 *   .packageJson()
	 *   .command(deploy)
	 *   .run();
	 *
	 * // Also infer CLI name from bin key / package name:
	 * cli('mycli')
	 *   .packageJson({ inferName: true })
	 *   .command(deploy)
	 *   .run();
	 *
	 * // Explicit values always win:
	 * cli('mycli')
	 *   .packageJson()
	 *   .version('2.0.0-beta')  // wins over package.json
	 *   .run();
	 * ```
	 */
	packageJson(settings?: { readonly inferName?: boolean }): CLIBuilder {
		return new CLIBuilder({
			...this.schema,
			packageJsonSettings: {
				inferName: settings?.inferName ?? false,
			},
		});
	}

	// -- Command registration ------------------------------------------------

	/**
	 * Register a command with the CLI program.
	 *
	 * The command's type parameters are erased for heterogeneous storage.
	 * Type safety is preserved inside the closure that delegates to
	 * `runCommand()`.
	 */
	command<
		F extends Record<string, FlagBuilder<FlagConfig>>,
		A extends Record<string, ArgBuilder<ArgConfig>>,
		C extends Record<string, unknown>,
	>(cmd: CommandBuilder<F, A, C>): CLIBuilder {
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
	 * The command is also registered as a normal subcommand (can be invoked
	 * by name). Only one default command is allowed.
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
	 * ```
	 */
	default<
		F extends Record<string, FlagBuilder<FlagConfig>>,
		A extends Record<string, ArgBuilder<ArgConfig>>,
		C extends Record<string, unknown>,
	>(cmd: CommandBuilder<F, A, C>): CLIBuilder {
		if (this.schema.defaultCommand !== undefined) {
			throw new CLIError('Only one default command is allowed', {
				code: 'DUPLICATE_DEFAULT',
				suggest: 'Call .default() only once when building the CLI',
			});
		}
		if (this.schema.commands.some((c) => c.schema.name === cmd.schema.name)) {
			throw new CLIError(`Command '${cmd.schema.name}' is already registered`, {
				code: 'DUPLICATE_COMMAND',
				suggest: 'Use .default() instead of .command() to register the default command',
			});
		}
		const erased = eraseCommand(cmd);
		return new CLIBuilder({
			...this.schema,
			commands: [...this.schema.commands, erased],
			defaultCommand: erased,
		});
	}

	/**
	 * Register a CLI plugin.
	 *
	 * Plugins run in registration order. At each lifecycle stage, all hooks for
	 * the first plugin run before hooks for the second plugin, and so on.
	 *
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
	 * Register a built-in `completions` subcommand that generates shell
	 * completion scripts.
	 *
	 * The generated command accepts a `--shell` flag (required, enum of
	 * all {@link Shell} values) and writes the completion script to stdout
	 * via `out.log()`. Unsupported shells throw a descriptive `CLIError`
	 * instead of a generic parse error.
	 *
	 * Call this **after** registering all other commands so the completion
	 * script includes the full command set. The captured schema is a
	 * snapshot at call time — commands registered after `.completions()`
	 * will not appear in the generated script.
	 *
	 * @example
	 * ```ts
	 * cli('mycli')
	 *   .version('1.0.0')
	 *   .command(deploy)
	 *   .command(login)
	 *   .completions()
	 *   .run();
	 * ```
	 */
	completions(): CLIBuilder {
		if (this.schema.commands.some((c) => c.schema.name === 'completions')) {
			throw new CLIError('.completions() has already been called', {
				code: 'DUPLICATE_COMMAND',
				suggest: 'Call .completions() only once when building the CLI',
			});
		}

		// Capture current schema — includes all commands registered so far.
		// The completions command itself is deliberately excluded from the
		// generated script (it would be noise in shell completions).
		const cliSchema = this.schema;

		// Supported shells for validation. Keep in sync with completion/index.ts SHELLS.
		const shellSet = new Set<string>(SHELLS as readonly string[]);

		const cmd = command('completions')
			.alias('completion')
			.description('Generate shell completion script')
			.arg(
				'shell',
				arg
					.custom((raw: string): Shell => {
						// Normalize $SHELL paths: /bin/zsh → zsh, /usr/local/bin/bash → bash
						const segments = raw.split('/');
						const name = segments[segments.length - 1] ?? raw;
						if (!shellSet.has(name)) {
							throw new Error(`Unknown shell '${name}'. Valid shells: ${SHELLS.join(', ')}`);
						}
						// Safe: shellSet membership guarantees name is Shell
						return name as Shell;
					})
					.env('SHELL')
					.describe(`Target shell (${SHELLS.join(', ')})`),
			)
			.action(({ args, out }) => {
				const script = generateCompletion(cliSchema, args.shell);
				if (out.jsonMode) {
					out.json({ shell: args.shell, script });
				} else {
					out.log(script);
				}
			});
		return this.command(cmd);
	}

	// -- Execution -----------------------------------------------------------

	/**
	 * Execute the CLI program against explicit argv.
	 *
	 * This is the testable execution path — no process state is touched.
	 * Returns a structured `RunResult` with exit code and captured output.
	 *
	 * @param argv - Raw argv tokens (NOT including the binary/script path,
	 *   i.e. equivalent to `process.argv.slice(2)`).
	 * @param options - Injectable runtime state.
	 * @returns Structured result with exit code and captured output.
	 */
	async execute(argv: readonly string[], options?: CLIRunOptions): Promise<RunResult> {
		// -- Detect --json flag (global, extracted before command dispatch) ------
		const hasJsonFlag = argv.includes('--json');
		const jsonMode = hasJsonFlag || options?.jsonMode === true;
		// Strip --json from argv so commands don't see it as an unknown flag
		const filteredArgv = hasJsonFlag ? argv.filter((a) => a !== '--json') : argv;

		const captureOptions = {
			...(options?.verbosity !== undefined ? { verbosity: options.verbosity } : {}),
			...(jsonMode ? { jsonMode } : {}),
			...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
		};
		const [out, captured] = createCaptureOutput(
			Object.keys(captureOptions).length > 0 ? captureOptions : undefined,
		);

		// Resolve help options — default binName to CLI program name
		const helpOptions: HelpOptions = {
			...options?.help,
			binName: options?.help?.binName ?? this.schema.name,
		};

		// -- Root --version -------------------------------------------------------
		if (filteredArgv.includes('--version') || filteredArgv.includes('-V')) {
			if (this.schema.version !== undefined) {
				out.log(this.schema.version);
			}
			return buildResult(0, captured, undefined);
		}

		// -- Extract first arg for root-level checks --------------------------------
		const firstArg = filteredArgv.length > 0 ? filteredArgv[0] : undefined;

		// -- Root --help (explicit root-level help request) -----------------------
		// Only intercept when --help/-h is the first token — subcommand-level
		// help (e.g. `myapp deploy --help`) flows through dispatch.
		if (firstArg === '--help' || firstArg === '-h') {
			const helpText = formatRootHelp(this.schema, helpOptions);
			out.log(helpText);
			return buildResult(0, captured, undefined);
		}

		// -- `help [command...]` virtual subcommand ------------------------------
		// Rewrite `help <cmd>` → `<cmd> --help` so it flows through normal
		// dispatch and per-command help rendering. Bare `help` → root help.
		// Only activates when the user hasn't registered a real `help` command.
		if (firstArg === 'help') {
			const hasRealHelpCommand = this.schema.commands.some(
				(c) => c.schema.name === 'help' || c.schema.aliases.includes('help'),
			);
			if (!hasRealHelpCommand) {
				const rest = filteredArgv.slice(1);
				if (rest.length === 0) {
					const helpText = formatRootHelp(this.schema, helpOptions);
					out.log(helpText);
					return buildResult(0, captured, undefined);
				}
				// Recurse with rewritten argv: `help deploy --force` → `deploy --force --help`
				// Propagate jsonMode — `--json` was already stripped from filteredArgv above.
				return this.execute([...rest, '--help'], jsonMode ? { ...options, jsonMode } : options);
			}
		}

		// -- Empty argv without a default command → root help ---------------------
		if (firstArg === undefined && this.schema.defaultCommand === undefined) {
			const helpText = formatRootHelp(this.schema, helpOptions);
			out.log(helpText);
			return buildResult(0, captured, undefined);
		}

		// -- No commands registered -----------------------------------------------
		if (this.schema.commands.length === 0) {
			const err = new CLIError('No commands registered', {
				code: 'NO_ACTION',
				suggest: 'Add commands via .command() before calling .run()',
			});
			if (jsonMode) {
				out.json({ error: err.toJSON() });
			} else {
				out.error(err.message);
			}
			return buildResult(1, captured, err);
		}

		// -- Build root command map for dispatch -----------------------------------
		const rootCommands = new Map<string, ErasedCommand>();
		for (const cmd of this.schema.commands) {
			rootCommands.set(cmd.schema.name, cmd);
			for (const alias of cmd.schema.aliases) {
				rootCommands.set(alias, cmd);
			}
		}

		// -- Recursive dispatch ---------------------------------------------------
		const result = dispatch(filteredArgv, rootCommands);

		// -- Resolve default command (if configured) ------------------------------
		const defaultCmd = this.schema.defaultCommand;

		// -- Shared options for command execution ----------------------------------
		const effectiveOptions: CLIRunOptions = {
			...options,
			plugins: this.schema.plugins,
			...(jsonMode ? { jsonMode } : {}),
		};

		switch (result.kind) {
			case 'unknown': {
				if (defaultCmd !== undefined && result.parentPath.length === 0) {
					// Only delegate to the default command for root-level unknowns.
					// Nested unknowns (parentPath non-empty) should surface an error
					// so typo suggestions work correctly within command groups.
					const suggestion =
						result.input !== '' ? findClosestCommand(result.input, result.candidates) : undefined;
					if (suggestion === undefined) {
						const meta = buildMeta(this.schema, helpOptions, defaultCmd.schema.name);
						const commandRunOptions = buildCommandRunOptions(effectiveOptions, helpOptions, meta);
						return defaultCmd._execute(filteredArgv, { ...commandRunOptions });
					}
				}

				if (result.input === '') {
					// Only flags, no command, no default — show root help.
					const helpText = formatRootHelp(this.schema, helpOptions);
					out.log(helpText);
					return buildResult(0, captured, undefined);
				}
				const suggestion = findClosestCommand(result.input, result.candidates);

				// Build scoped help path from ancestor context.
				// e.g. for `myapp db migrat` → parentPath = [dbSchema] → "myapp db --help"
				const scopePath =
					result.parentPath.length > 0
						? `${this.schema.name} ${result.parentPath.map((s) => s.name).join(' ')}`
						: this.schema.name;

				const err = new ParseError(`Unknown command: ${result.input}`, {
					code: 'UNKNOWN_COMMAND',
					suggest:
						suggestion !== undefined
							? `Did you mean '${suggestion}'?`
							: `Run '${scopePath} --help' for available commands`,
				});
				if (jsonMode) {
					out.json({ error: err.toJSON() });
				} else {
					out.error(err.message);
					if (err.suggest !== undefined) {
						out.error(`Suggestion: ${err.suggest}`);
					}
				}
				return buildResult(2, captured, err);
			}

			case 'needs-subcommand': {
				// Group command with no handler — show its help via formatHelp().
				// Build binName from full command path so usage reads "myapp db" not just "db".
				const ancestorNames = result.commandPath.slice(0, -1).map((s) => s.name);
				const groupBinName = [this.schema.name, ...ancestorNames].join(' ');
				const groupHelpOptions: HelpOptions = {
					...helpOptions,
					binName: groupBinName,
				};
				const helpText = formatHelp(result.command.schema, groupHelpOptions);
				out.log(helpText);
				return buildResult(0, captured, undefined);
			}

			case 'match': {
				// Merge propagated flags from ancestor path into target's schema.
				const propagated = collectPropagatedFlags(result.commandPath);
				const hasPropagated = Object.keys(propagated).length > 0;
				const mergedSchema: CommandSchema | undefined = hasPropagated
					? {
							...result.command.schema,
							flags: { ...propagated, ...result.command.schema.flags },
						}
					: undefined;

				const meta = buildMeta(this.schema, helpOptions, result.command.schema.name);
				const commandRunOptions = buildCommandRunOptions(effectiveOptions, helpOptions, meta);
				return result.command._execute(result.remainingArgv, {
					...commandRunOptions,
					...(mergedSchema !== undefined ? { mergedSchema } : {}),
				});
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
	 * Defaults to `createAdapter()` when no adapter is provided,
	 * which auto-detects the runtime (Node.js, Bun) and creates
	 * the appropriate adapter.
	 *
	 * @param options - Optional runtime configuration including adapter.
	 */
	async run(options?: CLIRunOptions): Promise<never> {
		const adapter = options?.adapter ?? createAdapter();

		const rawArgv = adapter.argv.slice(2);

		// Extract --config <path> before command dispatch (requires I/O via adapter)
		const { configPath, filteredArgv } = extractConfigFlag(rawArgv);

		// Detect --json early for error rendering during config loading
		const hasJsonFlag = filteredArgv.includes('--json');

		// Config discovery (only when .config() was called on the builder)
		// Skip for completions subcommand — shell completions don't need config.
		// Resolve the first argv token against registered commands (by name + aliases)
		// so aliases or shadowed names are handled correctly.
		// When no subcommand token is present and a default command exists, check
		// whether the default command is 'completions' (unlikely but correct).
		const firstToken = filteredArgv[0];
		const matchedCommand =
			firstToken !== undefined
				? this.schema.commands.find(
						(c) => c.schema.name === firstToken || c.schema.aliases.includes(firstToken),
					)
				: undefined;
		const effectiveCommandName =
			matchedCommand?.schema.name ?? this.schema.defaultCommand?.schema.name;
		const isCompletions = effectiveCommandName === 'completions';
		let loadedConfig: Readonly<Record<string, unknown>> | undefined;

		if (
			this.schema.configSettings !== undefined &&
			!isCompletions &&
			options?.config === undefined
		) {
			try {
				const result = await discoverConfig(this.schema.configSettings.appName, adapter, {
					...(configPath !== undefined ? { configPath } : {}),
					...(this.schema.configSettings.loaders !== undefined
						? { loaders: this.schema.configSettings.loaders }
						: {}),
				});
				if (result.found) {
					loadedConfig = result.data;
				}
			} catch (err: unknown) {
				// Config errors are fatal — render and exit
				if (err instanceof CLIError) {
					if (hasJsonFlag) {
						adapter.stdout(`${JSON.stringify({ error: err.toJSON() })}\n`);
					} else {
						adapter.stderr(`Error: ${err.message}\n`);
						if (err.suggest !== undefined) {
							adapter.stderr(`Suggestion: ${err.suggest}\n`);
						}
					}
					return adapter.exit(err.exitCode);
				}
				throw err;
			}
		}

		// Package.json discovery (only when .packageJson() was called)
		// Skip for completions subcommand — no metadata needed.
		let effectiveBuilder: CLIBuilder = this;
		if (this.schema.packageJsonSettings !== undefined && !isCompletions) {
			const pkg = await discoverPackageJson(adapter);
			if (pkg !== null) {
				const settings = this.schema.packageJsonSettings;
				const schema = this.schema;
				const inferredName = settings.inferName ? inferCliName(pkg) : undefined;
				effectiveBuilder = new CLIBuilder({
					...schema,
					// Explicit > discovered: only fill in undefined fields
					...(schema.version === undefined && pkg.version !== undefined
						? { version: pkg.version }
						: {}),
					...(schema.description === undefined && pkg.description !== undefined
						? { description: pkg.description }
						: {}),
					...(inferredName !== undefined ? { name: inferredName } : {}),
				});
			}
		}

		// Auto-create terminal prompter when stdin is a TTY and no explicit prompter provided.
		// This is the prompt gating seam: non-interactive environments (CI, piped stdin)
		// get stdinIsTTY=false → no auto-prompter → prompts skipped → falls through to default/required.
		const autoPrompter =
			options?.prompter === undefined && adapter.stdinIsTTY
				? createTerminalPrompter(adapter.stdin, adapter.stderr)
				: undefined;
		const adapterStdinData = await adapter.readStdin();

		// Source env, isTTY, and config from adapter when not explicitly provided in options
		const executeOptions: CLIRunOptions = {
			...options,
			...(options?.env === undefined ? { env: adapter.env } : {}),
			...(options?.isTTY === undefined ? { isTTY: adapter.isTTY } : {}),
			...(options?.stdinData === undefined ? { stdinData: adapterStdinData } : {}),
			...(autoPrompter !== undefined ? { prompter: autoPrompter } : {}),
			...(loadedConfig !== undefined ? { config: loadedConfig } : {}),
		};
		const result = await effectiveBuilder.execute(filteredArgv, executeOptions);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a `RunResult` from parts. */
function buildResult(
	exitCode: number,
	captured: CapturedOutput,
	error: CLIError | undefined,
): RunResult {
	return {
		exitCode,
		stdout: captured.stdout,
		stderr: captured.stderr,
		activity: captured.activity,
		error,
	};
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a new CLI program builder.
 *
 * @param name - The program name (used in help text and usage line).
 *
 * @example
 * ```ts
 * cli('mycli')
 *   .version('1.0.0')
 *   .description('My awesome tool')
 *   .command(deploy)
 *   .command(login)
 *   .run();
 * ```
 */
function cli(name: string): CLIBuilder {
	return new CLIBuilder({
		name,
		version: undefined,
		description: undefined,
		commands: [],
		defaultCommand: undefined,
		configSettings: undefined,
		packageJsonSettings: undefined,
		plugins: [],
	});
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type {
	BeforeParseParams,
	CLIPlugin,
	CLIPluginHooks,
	PluginCommandContext,
	ResolvedCommandParams,
} from './plugin.ts';
export type { CLIRunOptions, CLISchema, ConfigSettings, PackageJsonSettings };
export { CLIBuilder, cli, formatRootHelp, plugin };
