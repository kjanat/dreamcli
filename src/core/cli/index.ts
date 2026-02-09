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

import type { RuntimeAdapter } from '../../runtime/adapter.js';
import { createAdapter } from '../../runtime/auto.js';
import { generateCompletion } from '../completion/index.js';
import { CLIError, ParseError } from '../errors/index.js';
import type { HelpOptions } from '../help/index.js';
import type { CapturedOutput, Verbosity } from '../output/index.js';
import { createCaptureOutput } from '../output/index.js';
import type { PromptEngine, TestAnswer } from '../prompt/index.js';
import { createTerminalPrompter } from '../prompt/index.js';
import type { ArgBuilder, ArgConfig } from '../schema/arg.js';
import type { CommandBuilder, CommandSchema } from '../schema/command.js';
import { command } from '../schema/command.js';
import type { FlagBuilder, FlagConfig } from '../schema/flag.js';
import { flag } from '../schema/flag.js';
import type { RunOptions, RunResult } from '../testkit/index.js';
import { runCommand } from '../testkit/index.js';

// ---------------------------------------------------------------------------
// Type-erased command — existential wrapper for heterogeneous commands
// ---------------------------------------------------------------------------

/**
 * A type-erased command entry stored in the CLI builder.
 *
 * Commands registered via `.command()` have heterogeneous `F` and `A`
 * type parameters. At the CLI dispatch level we only need the runtime
 * schema (for name/alias matching and help) and the ability to delegate
 * to `runCommand()`. This interface captures exactly that contract.
 *
 * The `_execute` function closes over the original typed `CommandBuilder`,
 * preserving full type safety inside the closure while presenting a
 * uniform interface to the dispatcher.
 *
 * @internal
 */
interface ErasedCommand {
	/** Runtime schema for name matching and help rendering. */
	readonly schema: CommandSchema;
	/** Execute this command against argv. Closes over the typed CommandBuilder. */
	readonly _execute: (argv: readonly string[], options?: RunOptions) => Promise<RunResult>;
}

/**
 * Erase a typed CommandBuilder into an ErasedCommand.
 *
 * The closure captures the fully-typed builder, so `runCommand()` receives
 * the original `CommandBuilder<F, A>` — no type assertions needed.
 *
 * @internal
 */
function eraseCommand<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown>,
>(cmd: CommandBuilder<F, A, C>): ErasedCommand {
	return {
		schema: cmd.schema,
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
// Root help formatter
// ---------------------------------------------------------------------------

/**
 * Generate root-level help text for the CLI program.
 *
 * Shows program name, version, description, usage line, available
 * commands (excluding hidden), and a footer hint.
 *
 * Separate from `formatHelp()` which renders per-command help —
 * different concerns, different format.
 *
 * @param schema - The CLI program schema.
 * @param options - Help formatting options.
 * @returns Formatted root help string.
 *
 * @internal
 */
function formatRootHelp(schema: CLISchema, options?: HelpOptions): string {
	const width = options?.width ?? 80;
	const sections: string[] = [];

	// ---- Header: name + version ---------------------------------------------
	const header = schema.version !== undefined ? `${schema.name} v${schema.version}` : schema.name;
	sections.push(header);

	// ---- Description --------------------------------------------------------
	if (schema.description !== undefined) {
		sections.push(schema.description);
	}

	// ---- Usage line ---------------------------------------------------------
	sections.push(`Usage: ${schema.name} <command> [options]`);

	// ---- Commands list (skip hidden) ----------------------------------------
	const visibleCommands = schema.commands.filter((c) => !c.schema.hidden);
	if (visibleCommands.length > 0) {
		const lines: string[] = ['Commands:'];
		const GAP = 2;

		// Compute max command name length for alignment
		let maxNameLen = 0;
		for (const cmd of visibleCommands) {
			if (cmd.schema.name.length > maxNameLen) {
				maxNameLen = cmd.schema.name.length;
			}
		}

		const descCol = 2 + maxNameLen + GAP; // 2 for indent
		for (const cmd of visibleCommands) {
			const padded = padEnd(`  ${cmd.schema.name}`, descCol);
			const desc = cmd.schema.description ?? '';
			if (desc.length === 0) {
				lines.push(padded.trimEnd());
			} else {
				lines.push(`${padded}${wrapText(desc, width, descCol)}`);
			}
		}

		sections.push(lines.join('\n'));
	}

	// ---- Footer hint --------------------------------------------------------
	sections.push(`Run '${schema.name} <command> --help' for more information.`);

	return `${sections.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Text helpers (duplicated from help module to avoid coupling)
// ---------------------------------------------------------------------------

/** Pad `text` to `length` with trailing spaces. */
function padEnd(text: string, length: number): string {
	if (text.length >= length) return text;
	return text + ' '.repeat(length - text.length);
}

/** Wrap text to `width`, preserving leading indent on continuation lines. */
function wrapText(text: string, width: number, indent: number): string {
	if (text.length + indent <= width) return text;

	const maxLen = width - indent;
	if (maxLen <= 0) return text;

	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		if (current.length === 0) {
			current = word;
		} else if (current.length + 1 + word.length <= maxLen) {
			current += ` ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current.length > 0) {
		lines.push(current);
	}

	const pad = ' '.repeat(indent);
	return lines.map((line, i) => (i === 0 ? line : `${pad}${line}`)).join('\n');
}

// ---------------------------------------------------------------------------
// "Did you mean?" suggestion for unknown commands
// ---------------------------------------------------------------------------

/**
 * Levenshtein distance between two strings.
 * @internal
 */
function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		Array.from({ length: n + 1 }, () => 0),
	);

	for (let i = 0; i <= m; i++) {
		const row = dp[i];
		if (row !== undefined) row[0] = i;
	}
	for (let j = 0; j <= n; j++) {
		const row = dp[0];
		if (row !== undefined) row[j] = j;
	}

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
			const prevRow = dp[i - 1];
			const currRow = dp[i];
			if (prevRow !== undefined && currRow !== undefined) {
				const del = prevRow[j];
				const ins = currRow[j - 1];
				const sub = prevRow[j - 1];
				if (del !== undefined && ins !== undefined && sub !== undefined) {
					currRow[j] = Math.min(del + 1, ins + 1, sub + cost);
				}
			}
		}
	}

	const lastRow = dp[m];
	return lastRow !== undefined && lastRow[n] !== undefined ? lastRow[n] : Math.max(m, n);
}

/**
 * Find the closest command name match for a "did you mean?" suggestion.
 *
 * Returns `undefined` if no sufficiently close match exists (threshold: 3).
 *
 * @internal
 */
function findClosestCommand(input: string, commands: readonly ErasedCommand[]): string | undefined {
	const MAX_DISTANCE = 3;
	let bestName: string | undefined;
	let bestDist = MAX_DISTANCE + 1;

	for (const cmd of commands) {
		// Check main name
		const nameDist = levenshtein(input, cmd.schema.name);
		if (nameDist < bestDist) {
			bestDist = nameDist;
			bestName = cmd.schema.name;
		}
		// Check aliases
		for (const alias of cmd.schema.aliases) {
			const aliasDist = levenshtein(input, alias);
			if (aliasDist < bestDist) {
				bestDist = aliasDist;
				bestName = cmd.schema.name; // suggest canonical name
			}
		}
	}

	return bestDist <= MAX_DISTANCE ? bestName : undefined;
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
): RunOptions {
	return {
		help: helpOptions,
		...(options?.env !== undefined ? { env: options.env } : {}),
		...(options?.config !== undefined ? { config: options.config } : {}),
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

	// -- Built-in subcommands ------------------------------------------------

	/**
	 * Register a built-in `completions` subcommand that generates shell
	 * completion scripts.
	 *
	 * The generated command accepts a `--shell` flag (required, enum:
	 * `bash` | `zsh`) and writes the completion script to stdout via
	 * `out.log()`.
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
		// Capture current schema — includes all commands registered so far.
		// The completions command itself is deliberately excluded from the
		// generated script (it would be noise in shell completions).
		const cliSchema = this.schema;
		const cmd = command('completions')
			.description('Generate shell completion script')
			.flag(
				'shell',
				flag
					.enum(['bash', 'zsh'] as const)
					.required()
					.describe('Target shell'),
			)
			.action(({ flags, out }) => {
				const script = generateCompletion(cliSchema, flags.shell);
				out.log(script);
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

		// -- Extract command name --------------------------------------------------
		const firstArg = filteredArgv.length > 0 ? filteredArgv[0] : undefined;

		// -- Root --help (or no command) -------------------------------------------
		if (firstArg === undefined || firstArg === '--help' || firstArg === '-h') {
			const helpText = formatRootHelp(this.schema, helpOptions);
			out.log(helpText);
			return buildResult(0, captured, undefined);
		}

		// -- Check if first arg looks like a flag (no command given) ---------------
		if (firstArg.startsWith('-')) {
			// Unknown root flag — show help
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

		// -- Find matching command (by name or alias) -----------------------------
		const matched = findCommand(firstArg, this.schema.commands);

		if (matched === undefined) {
			const suggestion = findClosestCommand(firstArg, this.schema.commands);
			const err = new ParseError(`Unknown command: ${firstArg}`, {
				code: 'UNKNOWN_COMMAND',
				suggest:
					suggestion !== undefined
						? `Did you mean '${suggestion}'?`
						: `Run '${this.schema.name} --help' for available commands`,
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

		// -- Delegate to command execution ----------------------------------------
		const remainingArgv = filteredArgv.slice(1);
		// Propagate jsonMode to command so it gets the --json context
		const effectiveOptions: CLIRunOptions = {
			...options,
			...(jsonMode ? { jsonMode } : {}),
		};
		const commandRunOptions = buildCommandRunOptions(effectiveOptions, helpOptions);
		return matched._execute(remainingArgv, commandRunOptions);
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

		const argv = adapter.argv.slice(2);
		// Auto-create terminal prompter when stdin is a TTY and no explicit prompter provided.
		// This is the prompt gating seam: non-interactive environments (CI, piped stdin)
		// get stdinIsTTY=false → no auto-prompter → prompts skipped → falls through to default/required.
		const autoPrompter =
			options?.prompter === undefined && adapter.stdinIsTTY
				? createTerminalPrompter(adapter.stdin, adapter.stderr)
				: undefined;

		// Source env and isTTY from adapter when not explicitly provided in options
		const executeOptions: CLIRunOptions = {
			...options,
			...(options?.env === undefined ? { env: adapter.env } : {}),
			...(options?.isTTY === undefined ? { isTTY: adapter.isTTY } : {}),
			...(autoPrompter !== undefined ? { prompter: autoPrompter } : {}),
		};
		const result = await this.execute(argv, executeOptions);

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
// Command lookup
// ---------------------------------------------------------------------------

/**
 * Find a command by name or alias.
 * @internal
 */
function findCommand(name: string, commands: readonly ErasedCommand[]): ErasedCommand | undefined {
	for (const cmd of commands) {
		if (cmd.schema.name === name) return cmd;
		for (const alias of cmd.schema.aliases) {
			if (alias === name) return cmd;
		}
	}
	return undefined;
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
	});
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { cli, CLIBuilder, formatRootHelp };
export type { CLIRunOptions, CLISchema };
