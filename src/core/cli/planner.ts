/**
 * Internal planner contract for CLI dispatch outcomes.
 *
 * Captures the stable seam between CLI-facing invocation planning and the
 * lower-level execution pipeline. This module is now the explicit invocation
 * planner seam: it owns root interception, command dispatch, default-command
 * fallback, propagated-flag merging, and match handoff shaping.
 *
 * @module dreamcli/core/cli/planner
 * @internal
 */

import type { CompletionOptions, Shell } from '#internals/core/completion/index.ts';
import { normalizeShell } from '#internals/core/completion/index.ts';
import { CLIError, ParseError } from '#internals/core/errors/index.ts';
import type { HelpOptions } from '#internals/core/help/index.ts';
import type { OutputPolicy } from '#internals/core/output/contracts.ts';
import type { ParseOptions } from '#internals/core/parse/index.ts';
import {
	buildFlagLookup,
	flagExpectsValue,
	includesBeforeSeparator,
} from '#internals/core/parse/index.ts';
import type { CommandMeta, CommandSchema, ErasedCommand } from '#internals/core/schema/command.ts';
import { dispatch, findClosestCommand } from './dispatch.ts';
import type { CLIPlugin } from './plugin.ts';
import { collectPropagatedFlags } from './propagate.ts';

/**
 * Structural subset of CLISchema used by the planner.
 *
 * Decouples invocation planning from the full CLIBuilder surface so the
 * planner can be tested and reasoned about without constructing a real CLI.
 * @internal
 */
interface PlannerSchemaLike {
	/** CLI program name used in help text and error messages. */
	readonly name: string;
	/** Declared version string; `undefined` disables `--version` interception. */
	readonly version: string | undefined;
	/** Registered top-level commands available for dispatch. */
	readonly commands: readonly ErasedCommand[];
	/** Fallback command when no subcommand token matches. */
	readonly defaultCommand: ErasedCommand | undefined;
	/** Whether the default command is also exposed as a named top-level route. */
	readonly defaultCommandRouted: boolean;
	/**
	 * Eager `--completions <shell>` flag configuration, when `.completions()`
	 * was registered with `{ as: 'flag' }`. `undefined` disables interception.
	 */
	readonly completionsFlag:
		| { readonly shells: readonly Shell[]; readonly options: CompletionOptions | undefined }
		| undefined;
	/** Flag-parsing behavior settings (case parity) applied to flag lookups. */
	readonly flagSettings?: ParseOptions | undefined;
	/** Plugins forwarded into every matched execution plan. */
	readonly plugins: readonly CLIPlugin[];
}

/** Root-level help interception outcome. */
interface RootHelpOutcome {
	/** Discriminant — argv matched `--help` / `-h` before any command. */
	readonly kind: 'root-help';
	/** Help options to render root-level usage. */
	readonly help: HelpOptions;
}

/** Root-level version interception outcome. */
interface RootVersionOutcome {
	/** Discriminant — argv matched `--version` / `-V` and schema declares a version. */
	readonly kind: 'root-version';
	/** Resolved version string to render. */
	readonly version: string;
}

/** Root-level `--completions [shell]` interception outcome. */
interface RootCompletionsOutcome {
	/** Discriminant — argv matched the eager `--completions [shell]` flag. */
	readonly kind: 'root-completions';
	/**
	 * Resolved, validated target shell, or `undefined` when the flag was given
	 * without a value and the shell should be auto-detected from the environment.
	 */
	readonly shell: Shell | undefined;
	/** Generator options captured at build time. */
	readonly options: CompletionOptions | undefined;
}

/** CLI-level dispatch failure before command execution starts. */
interface DispatchErrorOutcome {
	/** Discriminant — dispatch could not resolve a command from argv. */
	readonly kind: 'dispatch-error';
	/** Structured error with suggestion text for the caller to render. */
	readonly error: CLIError;
}

/** Successful planner handoff to the shared command execution path. */
interface PlannerMatchOutcome {
	/** Discriminant — dispatch found a matching command for argv. */
	readonly kind: 'match';
	/** Fully resolved execution plan ready for the executor pipeline. */
	readonly plan: CommandExecutionPlan;
}

/**
 * Stable planner result union for the re-foundation workstream.
 *
 * `CLIBuilder.execute()` still renders and executes these outcomes, but
 * planning itself is intentionally bounded to this union.
 */
type DispatchOutcome =
	| RootHelpOutcome
	| RootVersionOutcome
	| RootCompletionsOutcome
	| DispatchErrorOutcome
	| PlannerMatchOutcome;

/**
 * Concrete execution handoff produced by a successful planner match.
 *
 * `mergedSchema` is the exact command schema the executor sees after
 * propagated ancestor flags are collected and child definitions shadow them.
 */
interface CommandExecutionPlan {
	/** Type-erased command instance that owns the handler. */
	readonly command: ErasedCommand;
	/** Command schema with propagated ancestor flags merged in. */
	readonly mergedSchema: CommandSchema;
	/** Remaining argv tokens after command dispatch consumed the command path. */
	readonly argv: readonly string[];
	/** CLI-level metadata (program name, bin, version) for the handler context. */
	readonly meta: CommandMeta;
	/** Plugins to run through the execution lifecycle. */
	readonly plugins: readonly CLIPlugin[];
	/** Output policy (json mode, TTY, verbosity) governing handler rendering. */
	readonly output: OutputPolicy;
	/** Help options for rendering per-command help; `undefined` when unavailable. */
	readonly help: HelpOptions | undefined;
}

interface BuildCommandExecutionPlanOptions {
	readonly command: ErasedCommand;
	readonly commandPath: readonly CommandSchema[];
	readonly argv: readonly string[];
	readonly meta: CommandMeta;
	readonly plugins: readonly CLIPlugin[];
	readonly output: OutputPolicy;
	readonly help: HelpOptions | undefined;
}

/**
 * Dispatch resolved a group command that requires a subcommand selection.
 *
 * The caller should render subcommand-level help for the matched group.
 * @internal
 */
interface NeedsSubcommandOutcome {
	/** Discriminant — group command matched but no leaf subcommand was selected. */
	readonly kind: 'needs-subcommand';
	/** The group command that was matched. */
	readonly command: ErasedCommand;
	/** Full ancestor path from root to this group, used for propagated flag collection. */
	readonly commandPath: readonly CommandSchema[];
	/** Help options scoped to the group command's bin path. */
	readonly help: HelpOptions;
}

/** Full planner result including the `needs-subcommand` variant used by CLIBuilder. @internal */
type InvocationPlan = DispatchOutcome | NeedsSubcommandOutcome;

/** Options bag for {@linkcode planInvocation}. @internal */
interface PlanInvocationOptions {
	/** CLI schema subset driving dispatch decisions. */
	readonly schema: PlannerSchemaLike;
	/** Raw argv tokens (typically `adapter.argv.slice(2)`). */
	readonly argv: readonly string[];
	/** Root-level help configuration for rendering. */
	readonly help: HelpOptions;
	/** Output policy propagated into matched execution plans. */
	readonly output: OutputPolicy;
}

function buildMeta(
	schema: PlannerSchemaLike,
	helpOptions: HelpOptions,
	commandName: string,
): CommandMeta {
	return {
		name: schema.name,
		bin: helpOptions.binName ?? schema.name,
		version: schema.version,
		command: commandName,
	};
}

/** Build a name+alias lookup map for top-level commands. @internal */
function buildRootCommandMap(
	commands: readonly ErasedCommand[],
): ReadonlyMap<string, ErasedCommand> {
	const rootCommands = new Map<string, ErasedCommand>();

	const addRoute = (route: string, command: ErasedCommand): void => {
		const existing = rootCommands.get(route);
		if (existing !== undefined) {
			throw new CLIError(
				`Duplicate root command route '${route}' (${existing.schema.name} and ${command.schema.name})`,
				{
					code: 'DUPLICATE_COMMAND',
					suggest: 'Ensure root command names and aliases are unique',
				},
			);
		}

		rootCommands.set(route, command);
	};

	for (const cmd of commands) {
		addRoute(cmd.schema.name, cmd);
		for (const alias of cmd.schema.aliases) {
			addRoute(alias, cmd);
		}
	}
	return rootCommands;
}

/**
 * Merge propagated ancestor flags into the matched command schema.
 *
 * Child flag definitions win when names collide, matching current CLI
 * dispatch semantics and the future planner contract.
 */
function mergeCommandSchema(
	command: ErasedCommand,
	commandPath: readonly CommandSchema[],
): CommandSchema {
	const propagated = collectPropagatedFlags(commandPath);
	if (Object.keys(propagated).length === 0) {
		return command.schema;
	}

	return {
		...command.schema,
		flags: { ...propagated, ...command.schema.flags },
	};
}

/** Build the planner handoff for a matched command invocation. */
function buildCommandExecutionPlan(
	options: BuildCommandExecutionPlanOptions,
): CommandExecutionPlan {
	return {
		command: options.command,
		mergedSchema: mergeCommandSchema(options.command, options.commandPath),
		argv: options.argv,
		meta: options.meta,
		plugins: options.plugins,
		output: options.output,
		help: options.help,
	};
}

function buildPlannerMatchOutcome(
	schema: PlannerSchemaLike,
	command: ErasedCommand,
	commandPath: readonly CommandSchema[],
	argv: readonly string[],
	help: HelpOptions,
	output: OutputPolicy,
): PlannerMatchOutcome {
	return {
		kind: 'match',
		plan: buildCommandExecutionPlan({
			command,
			commandPath,
			argv,
			meta: buildMeta(schema, help, command.schema.name),
			plugins: schema.plugins,
			output,
			help,
		}),
	};
}

function canDelegateUnknownRootToDefault(command: ErasedCommand, input: string): boolean {
	return input === '' || command.schema.args.length > 0;
}

function findUnknownFlagBeforePositional(
	argv: readonly string[],
	flags: CommandSchema['flags'],
	parseOptions?: ParseOptions,
): string | undefined {
	const lookup = buildFlagLookup(flags, parseOptions);

	for (let index = 0; index < argv.length; index++) {
		const token = argv[index];
		if (token === undefined || token === '--') return undefined;
		if (token === '-' || !token.startsWith('-')) return undefined;

		if (token.startsWith('--')) {
			const equalsIndex = token.indexOf('=');
			const name = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
			const entry = lookup.get(name);
			if (entry === undefined) return equalsIndex === -1 ? token : `--${name}`;
			if (equalsIndex === -1 && flagExpectsValue(entry.schema)) index++;
			continue;
		}

		const chars = token.slice(1);
		for (let charIndex = 0; charIndex < chars.length; charIndex++) {
			const char = chars.charAt(charIndex);
			const entry = lookup.get(char);
			if (entry === undefined) return `-${char}`;
			if (!flagExpectsValue(entry.schema)) continue;
			if (charIndex === chars.length - 1) index++;
			break;
		}
	}

	return undefined;
}

/**
 * Result of scanning the pre-`--`, `--json`-stripped head for root interception.
 * @internal
 */
interface RootHeadScan {
	/**
	 * `--help` / `-h` appeared in the head before any command-dispatch token.
	 *
	 * Mirrors the global reach of `--version` (#29): a help flag preceded only by
	 * flags (no subcommand token) is a *root* help request. A help flag that
	 * follows a subcommand token is left to that command's executor, so
	 * `app sub --help` still renders the subcommand's help.
	 */
	readonly helpBeforeCommand: boolean;
	/** First command-dispatch (positional) token, or `undefined` when the head is all flags. */
	readonly firstCommandToken: string | undefined;
	/** Index of {@linkcode firstCommandToken} in the head, or `-1` when absent. */
	readonly commandTokenIndex: number;
}

/**
 * Scan the pre-`--`, `--json`-stripped head to locate the first command-dispatch
 * token and detect a root-level `--help` / `-h` ahead of it.
 *
 * Value-flag arity is honoured (via `valueFlags`) so a flag value that happens
 * to look like a command name is not mistaken for one — matching how
 * {@linkcode dispatch} reads the same argv.
 *
 * @internal
 */
function scanRootHead(
	head: readonly string[],
	valueFlags: ReturnType<typeof buildFlagLookup> | undefined,
): RootHeadScan {
	for (let index = 0; index < head.length; index++) {
		const token = head[index];
		if (token === undefined) continue;

		if (token === '--help' || token === '-h') {
			return { helpBeforeCommand: true, firstCommandToken: undefined, commandTokenIndex: -1 };
		}

		// Positional (command-dispatch) token: `-` alone or anything not flag-shaped.
		if (token === '-' || !token.startsWith('-')) {
			return { helpBeforeCommand: false, firstCommandToken: token, commandTokenIndex: index };
		}

		if (token.startsWith('--')) {
			const equalsIndex = token.indexOf('=');
			const name = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
			const entry = valueFlags?.get(name);
			if (entry !== undefined && equalsIndex === -1 && flagExpectsValue(entry.schema)) index++;
			continue;
		}

		// Short-flag cluster: consume a trailing value-expecting flag's argument.
		const chars = token.slice(1);
		for (let charIndex = 0; charIndex < chars.length; charIndex++) {
			const entry = valueFlags?.get(chars.charAt(charIndex));
			if (entry === undefined || !flagExpectsValue(entry.schema)) continue;
			if (charIndex === chars.length - 1) index++;
			break;
		}
	}

	return { helpBeforeCommand: false, firstCommandToken: undefined, commandTokenIndex: -1 };
}

/**
 * Detect and resolve the eager `--completions [shell]` flag before dispatch.
 *
 * Accepts `--completions <shell>` and `--completions=<shell>`. When no value is
 * given (`--completions` alone, or followed by another flag), the shell is left
 * `undefined` so the caller can auto-detect it from the environment. Scans only
 * before a `--` separator so a literal positional survives.
 *
 * Returns `undefined` when the flag is absent, a `root-completions` outcome
 * otherwise, or a `dispatch-error` when an explicit value names an unknown shell.
 *
 * @internal
 */
function planCompletionsFlag(
	argv: readonly string[],
	config: { readonly shells: readonly Shell[]; readonly options: CompletionOptions | undefined },
): RootCompletionsOutcome | DispatchErrorOutcome | undefined {
	const separatorIndex = argv.indexOf('--');
	const scanEnd = separatorIndex === -1 ? argv.length : separatorIndex;

	for (let index = 0; index < scanEnd; index++) {
		const token = argv[index];
		if (token === undefined) continue;

		let rawShell: string | undefined;
		if (token === '--completions') {
			const next = index + 1 < scanEnd ? argv[index + 1] : undefined;
			rawShell = next !== undefined && !next.startsWith('-') ? next : undefined;
		} else if (token.startsWith('--completions=')) {
			rawShell = token.slice('--completions='.length);
		} else {
			continue;
		}

		// No explicit value → defer to environment auto-detection.
		if (rawShell === undefined || rawShell === '') {
			return { kind: 'root-completions', shell: undefined, options: config.options };
		}

		const shell = normalizeShell(rawShell);
		if (shell === undefined || !config.shells.includes(shell)) {
			return {
				kind: 'dispatch-error',
				error: new ParseError(`Unknown shell '${rawShell}'`, {
					code: 'INVALID_VALUE',
					suggest: `Valid shells: ${config.shells.join(', ')}`,
				}),
			};
		}

		return { kind: 'root-completions', shell, options: config.options };
	}

	return undefined;
}

/**
 * Decide what to do with an argv invocation before any command executes.
 *
 * Handles root interception (`--help`, `--version`, `--completions <shell>`,
 * bare `help` token), dispatches into the command tree, falls back to the
 * default command, and produces structured errors for unknown commands/flags.
 * @internal
 */
function planInvocation(options: PlanInvocationOptions): InvocationPlan {
	// `--json` is a root-level flag, not part of any command schema, so it is
	// stripped before dispatch/parse — but only before the `--` separator, so a
	// literal `--json` positional (after `--`) survives and reaches the command
	// (#28). The `--json` *output mode* is detected separately in `.execute()`.
	const separatorIndex = options.argv.indexOf('--');
	const head = separatorIndex === -1 ? options.argv : options.argv.slice(0, separatorIndex);
	const tail = separatorIndex === -1 ? [] : options.argv.slice(separatorIndex);
	const filteredHead = head.includes('--json') ? head.filter((arg) => arg !== '--json') : head;
	const filteredArgv = separatorIndex === -1 ? filteredHead : [...filteredHead, ...tail];

	const defaultCommand = options.schema.defaultCommand;
	// At the root, a default command's flags govern value-flag arity so a
	// space-separated value (`mycli --region eu`) is not misread as a command
	// name — both for root interception below and dispatch (see #25).
	const rootValueFlags =
		defaultCommand !== undefined
			? buildFlagLookup(defaultCommand.schema.flags, options.schema.flagSettings)
			: undefined;

	if (
		options.schema.version !== undefined &&
		(includesBeforeSeparator(options.argv, '--version') ||
			includesBeforeSeparator(options.argv, '-V'))
	) {
		return {
			kind: 'root-version',
			version: options.schema.version,
		};
	}

	if (options.schema.completionsFlag !== undefined) {
		const completionsOutcome = planCompletionsFlag(options.argv, options.schema.completionsFlag);
		if (completionsOutcome !== undefined) {
			return completionsOutcome;
		}
	}

	// `--help` / `-h` is intercepted at the root with the same positional reach as
	// `--version` (#29): a help flag preceded only by flags (no subcommand token)
	// is a root request, so `app --verbose --help` mirrors `app --verbose --version`.
	// A help flag *after* a subcommand token is left to that command's executor,
	// keeping `app sub --help` scoped to the subcommand (version stays global by
	// design — there is no per-command version).
	const headScan = scanRootHead(filteredHead, rootValueFlags);
	if (headScan.helpBeforeCommand) {
		return {
			kind: 'root-help',
			help: options.help,
		};
	}

	// Bare `help` token: a root help request (or `<command> --help` forwarding)
	// when it is the first command token and no real `help` command is registered.
	if (headScan.firstCommandToken === 'help') {
		const hasRealHelpCommand = options.schema.commands.some(
			(command) => command.schema.name === 'help' || command.schema.aliases.includes('help'),
		);
		if (!hasRealHelpCommand) {
			const rest = filteredArgv.slice(headScan.commandTokenIndex + 1);
			if (rest.length === 0) {
				return {
					kind: 'root-help',
					help: options.help,
				};
			}

			return planInvocation({
				...options,
				argv: [...rest, '--help'],
			});
		}
	}

	// A CLI with no commands and no default is misconfigured: report NO_ACTION
	// even for a bare invocation, rather than masking it with empty root help.
	if (options.schema.commands.length === 0 && defaultCommand === undefined) {
		return {
			kind: 'dispatch-error',
			error: new CLIError('No commands registered', {
				code: 'NO_ACTION',
				suggest: 'Add commands via .command() or .default() before calling .run()',
			}),
		};
	}

	if (filteredArgv.length === 0 && defaultCommand === undefined) {
		return {
			kind: 'root-help',
			help: options.help,
		};
	}

	// A routed default command (`.default(cmd, { route: true })`) is dispatchable
	// by its own name in addition to the bare/flags-only root surface. It lives
	// only in `defaultCommand` (kept disjoint from `commands`), so add it to the
	// root route map here rather than duplicating it into `commands`.
	const rootCommands =
		defaultCommand !== undefined && options.schema.defaultCommandRouted
			? [...options.schema.commands, defaultCommand]
			: options.schema.commands;

	const result = dispatch(
		filteredArgv,
		buildRootCommandMap(rootCommands),
		[],
		rootValueFlags,
		options.schema.flagSettings,
	);

	switch (result.kind) {
		case 'unknown': {
			if (defaultCommand !== undefined && result.parentPath.length === 0) {
				const suggestion =
					result.input !== '' ? findClosestCommand(result.input, result.candidates) : undefined;
				if (
					suggestion === undefined &&
					canDelegateUnknownRootToDefault(defaultCommand, result.input)
				) {
					return buildPlannerMatchOutcome(
						options.schema,
						defaultCommand,
						[defaultCommand.schema],
						filteredArgv,
						options.help,
						options.output,
					);
				}

				const unknownFlag = findUnknownFlagBeforePositional(
					filteredArgv,
					defaultCommand.schema.flags,
					options.schema.flagSettings,
				);
				if (unknownFlag !== undefined) {
					return {
						kind: 'dispatch-error',
						error: new ParseError(`Unknown flag ${unknownFlag}`, {
							code: 'UNKNOWN_FLAG',
							suggest: `Run '${options.schema.name} --help' for available commands`,
						}),
					};
				}
			}

			if (result.input === '') {
				const unknownFlag = filteredArgv.find((token) => token.startsWith('-'));
				if (unknownFlag === undefined) {
					return {
						kind: 'root-help',
						help: options.help,
					};
				}

				return {
					kind: 'dispatch-error',
					error: new ParseError(`Unknown flag ${unknownFlag}`, {
						code: 'UNKNOWN_FLAG',
						suggest: `Run '${options.schema.name} --help' for available commands`,
					}),
				};
			}

			const suggestion = findClosestCommand(result.input, result.candidates);
			const scopePath =
				result.parentPath.length > 0
					? `${options.schema.name} ${result.parentPath.map((schema) => schema.name).join(' ')}`
					: options.schema.name;

			return {
				kind: 'dispatch-error',
				error: new ParseError(`Unknown command: ${result.input}`, {
					code: 'UNKNOWN_COMMAND',
					suggest:
						suggestion !== undefined
							? `Did you mean '${suggestion}'?`
							: `Run '${scopePath} --help' for available commands`,
				}),
			};
		}

		case 'needs-subcommand': {
			const ancestorNames = result.commandPath.slice(0, -1).map((schema) => schema.name);
			return {
				kind: 'needs-subcommand',
				command: result.command,
				commandPath: result.commandPath,
				help: {
					...options.help,
					binName: [options.schema.name, ...ancestorNames].join(' '),
				},
			};
		}

		case 'match':
			return buildPlannerMatchOutcome(
				options.schema,
				result.command,
				result.commandPath,
				result.remainingArgv,
				options.help,
				options.output,
			);
	}
}

export type {
	CommandExecutionPlan,
	DispatchErrorOutcome,
	DispatchOutcome,
	InvocationPlan,
	NeedsSubcommandOutcome,
	OutputPolicy,
	PlanInvocationOptions,
	PlannerMatchOutcome,
	PlannerSchemaLike,
	RootCompletionsOutcome,
	RootHelpOutcome,
	RootVersionOutcome,
};
export { buildCommandExecutionPlan, buildRootCommandMap, mergeCommandSchema, planInvocation };
