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

import type { CompletionOptions, Shell } from '#internals/core/completion/index.ts';
import { generateCompletion, SHELLS } from '#internals/core/completion/index.ts';
import type { FormatLoader } from '#internals/core/config/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { buildRunResult, executeCommand } from '#internals/core/execution/index.ts';
import type { HelpOptions } from '#internals/core/help/index.ts';
import { formatHelp } from '#internals/core/help/index.ts';
import type { CapturedOutput, Verbosity } from '#internals/core/output/index.ts';
import { createCaptureOutput, createOutput } from '#internals/core/output/index.ts';
import type { PromptEngine, TestAnswer } from '#internals/core/prompt/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg } from '#internals/core/schema/arg.ts';
import type {
	AnyCommandBuilder,
	CommandBuilder,
	CommandMeta,
	ErasedCommand,
	Out,
} from '#internals/core/schema/command.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import type { RunOptions, RunResult } from '#internals/core/schema/run.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import { createAdapter } from '#internals/runtime/auto.ts';
import type { OutputPolicy } from './planner.ts';
import { planInvocation } from './planner.ts';
import type { CLIPlugin } from './plugin.ts';
import { plugin } from './plugin.ts';
import { formatRootHelp } from './root-help.ts';
import { prepareRuntimePreflight } from './runtime-preflight.ts';

// --- Type-erased command — erasure function (interface now in schema/command.ts)

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
 * Stores the program name, version, description, and registered commands.
 * Built incrementally by `CLIBuilder`.
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
	 * and `{configDir}/{appName}/config.json` where `configDir` is
	 * `$XDG_CONFIG_HOME` / `~/.config` on Unix or `%APPDATA%` /
	 * `%USERPROFILE%\\AppData\\Roaming` on Windows.
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
	 * @defaultValue `false`
	 */
	readonly inferName: boolean;
}

// --- Options for execute/run

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
	 * `run()` populates this from `adapter.readStdin()` only when the selected
	 * invocation needs stdin. `execute()` accepts it directly so tests can
	 * simulate piped input without a runtime adapter.
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
	 * @defaultValue `'normal'`
	 */
	readonly verbosity?: Verbosity;

	/**
	 * Enable JSON output mode.
	 *
	 * When `true`, `log` and `info` messages are redirected to stderr
	 * so that stdout is reserved exclusively for structured `json()` output.
	 * Errors are also rendered as JSON to stderr.
	 *
	 * @defaultValue `false`
	 */
	readonly jsonMode?: boolean;

	/**
	 * Whether stdout is connected to a TTY.
	 *
	 * When provided, propagated to the output channel's `isTTY` field.
	 * In `.run()`, automatically sourced from `adapter.isTTY` when not
	 * explicitly set.
	 *
	 * @defaultValue `false`
	 */
	readonly isTTY?: boolean;

	/**
	 * Output channel override used by `run()` for live terminal rendering.
	 *
	 * @internal — `execute()` remains capture-first by default.
	 */
	readonly out?: Out;

	/**
	 * Capture buffers paired with `out`.
	 *
	 * @internal — `run()` omits this and accepts empty buffers in the returned
	 * `RunResult` because output is already written to the real adapter streams.
	 */
	readonly captured?: CapturedOutput;

	/**
	 * Help formatting options (width, binName).
	 * `binName` defaults to the CLI program name.
	 */
	readonly help?: HelpOptions;
}

// --- Command run options builder

/**
 * Build `RunOptions` from `CLIRunOptions`, conditionally spreading each
 * field to satisfy `exactOptionalPropertyTypes`.
 *
 * @param options - CLI-level run options (may be `undefined` for defaults).
 * @param helpOptions - Help formatting options forwarded to commands.
 * @param meta - Optional command metadata (omitted for root-level dispatch).
 * @returns Options record ready for `ErasedCommand._execute()`.
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
		...(options?.out !== undefined ? { out: options.out } : {}),
		...(options?.captured !== undefined ? { captured: options.captured } : {}),
	};
}

// --- CLIBuilder — immutable builder for the CLI program

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
	 * import { configFormat } from 'dreamcli';
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
	 * import { configFormat } from 'dreamcli';
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
	 *
	 * @param cmd - {@link CommandBuilder} to register.
	 * @returns The builder (for chaining).
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
	 *
	 * @param cmd - {@link CommandBuilder} to register as the default.
	 * @returns The builder (for chaining).
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
	 * will not appear in the generated script. Completion options are also
	 * captured at call time.
	 *
	 * @example
	 * ```ts
	 * cli('mycli')
	 *   .version('1.0.0')
	 *   .command(deploy)
	 *   .command(login)
	 *   .completions({ rootMode: 'surface' })
	 *   .run();
	 * ```
	 */
	completions(options?: CompletionOptions): CLIBuilder {
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
		const completionOptions = options;

		// Supported shells for validation. Keep in sync with completion/index.ts SHELLS.
		const shellMap = new Map<string, Shell>();
		for (const s of SHELLS) shellMap.set(s, s);

		const cmd = command('completions')
			.alias('completion')
			.description('Generate shell completion script')
			.arg(
				'shell',
				arg
					.custom((raw: string): Shell => {
						// Normalize $SHELL paths across Unix/Windows:
						// /bin/zsh → zsh, C:\Program Files\PowerShell\7\pwsh.exe → pwsh
						const segments = raw.split(/[\\/]/);
						const basename = segments[segments.length - 1] ?? raw;
						const name = basename.replace(/\.(?:exe|cmd|bat)$/i, '');
						const shell = shellMap.get(name);
						if (shell === undefined) {
							throw new Error(`Unknown shell '${name}'. Valid shells: ${SHELLS.join(', ')}`);
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

		// Resolve help options — default binName to CLI program name
		const helpOptions: HelpOptions = {
			...options?.help,
			binName: options?.help?.binName ?? this.schema.name,
		};

		// -- Shared options for command execution ----------------------------------
		const effectiveOptions: CLIRunOptions = {
			...options,
			plugins: this.schema.plugins,
			...(jsonMode ? { jsonMode } : {}),
		};
		const output: OutputPolicy = {
			jsonMode,
			isTTY: out.isTTY,
			verbosity: options?.verbosity ?? 'normal',
		};
		const planned = planInvocation({
			schema: this.schema,
			argv: filteredArgv,
			help: helpOptions,
			output,
		});

		switch (planned.kind) {
			case 'root-version':
				out.log(planned.version);
				return buildRunResult({ exitCode: 0, error: undefined }, captured);

			case 'root-help': {
				const helpText = formatRootHelp(this.schema, planned.help);
				out.log(helpText);
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
				const helpText = formatHelp(planned.command.schema, planned.help);
				out.log(helpText);
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
	 * Defaults to `createAdapter()` when no adapter is provided,
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
		const executeOptions: CLIRunOptions = {
			...options,
			...preflight.inputs,
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
	const trimmed = input.replace(/[\\/]+$/g, '');
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
}

/**
 * Create a new CLI program builder.
 *
 * The CLI name is used in help text, usage lines, and generated completion scripts.
 *
 * @param nameOrOptions - Either the explicit CLI name or factory options.
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

function cli(name: string): CLIBuilder;
function cli(options: CLIOptions): CLIBuilder;
function cli(nameOrOptions: string | CLIOptions): CLIBuilder {
	const name = typeof nameOrOptions === 'string' ? nameOrOptions : (nameOrOptions.name ?? 'cli');
	const inheritName = typeof nameOrOptions === 'string' ? false : (nameOrOptions.inherit ?? false);

	return new CLIBuilder({
		name,
		inheritName,
		version: undefined,
		description: undefined,
		commands: [],
		defaultCommand: undefined,
		configSettings: undefined,
		packageJsonSettings: undefined,
		plugins: [],
	});
}

// --- Exports

export type {
	BeforeParseParams,
	CLIPlugin,
	CLIPluginHooks,
	PluginCommandContext,
	ResolvedCommandParams,
} from './plugin.ts';
export type { CLIOptions, CLIRunOptions, CLISchema, ConfigSettings, PackageJsonSettings };
export { CLIBuilder, cli, formatRootHelp, plugin };
