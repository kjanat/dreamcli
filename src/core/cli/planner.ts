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

import { CLIError, ParseError } from '#internals/core/errors/index.ts';
import type { HelpOptions } from '#internals/core/help/index.ts';
import type { OutputPolicy } from '#internals/core/output/contracts.ts';
import type { CommandMeta, CommandSchema, ErasedCommand } from '#internals/core/schema/command.ts';
import { dispatch, findClosestCommand } from './dispatch.ts';
import type { CLIPlugin } from './plugin.ts';
import { collectPropagatedFlags } from './propagate.ts';

interface PlannerSchemaLike {
	readonly name: string;
	readonly version: string | undefined;
	readonly commands: readonly ErasedCommand[];
	readonly defaultCommand: ErasedCommand | undefined;
	readonly plugins: readonly CLIPlugin[];
}

/** Root-level help interception outcome. */
interface RootHelpOutcome {
	readonly kind: 'root-help';
	readonly help: HelpOptions;
}

/** Root-level version interception outcome. */
interface RootVersionOutcome {
	readonly kind: 'root-version';
	readonly version: string;
}

/** CLI-level dispatch failure before command execution starts. */
interface DispatchErrorOutcome {
	readonly kind: 'dispatch-error';
	readonly error: CLIError;
}

/** Successful planner handoff to the shared command execution path. */
interface PlannerMatchOutcome {
	readonly kind: 'match';
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
	| DispatchErrorOutcome
	| PlannerMatchOutcome;

/**
 * Concrete execution handoff produced by a successful planner match.
 *
 * `mergedSchema` is the exact command schema the executor sees after
 * propagated ancestor flags are collected and child definitions shadow them.
 */
interface CommandExecutionPlan {
	readonly command: ErasedCommand;
	readonly mergedSchema: CommandSchema;
	readonly argv: readonly string[];
	readonly meta: CommandMeta;
	readonly plugins: readonly CLIPlugin[];
	readonly output: OutputPolicy;
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

interface NeedsSubcommandOutcome {
	readonly kind: 'needs-subcommand';
	readonly command: ErasedCommand;
	readonly commandPath: readonly CommandSchema[];
	readonly help: HelpOptions;
}

type InvocationPlan = DispatchOutcome | NeedsSubcommandOutcome;

interface PlanInvocationOptions {
	readonly schema: PlannerSchemaLike;
	readonly argv: readonly string[];
	readonly help: HelpOptions;
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

function buildRootCommandMap(
	commands: readonly ErasedCommand[],
): ReadonlyMap<string, ErasedCommand> {
	const rootCommands = new Map<string, ErasedCommand>();
	for (const cmd of commands) {
		rootCommands.set(cmd.schema.name, cmd);
		for (const alias of cmd.schema.aliases) {
			rootCommands.set(alias, cmd);
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

function planInvocation(options: PlanInvocationOptions): InvocationPlan {
	const filteredArgv = options.argv.includes('--json')
		? options.argv.filter((arg) => arg !== '--json')
		: options.argv;

	if (
		options.schema.version !== undefined &&
		(filteredArgv.includes('--version') || filteredArgv.includes('-V'))
	) {
		return {
			kind: 'root-version',
			version: options.schema.version,
		};
	}

	const firstArg = filteredArgv[0];
	if (firstArg === '--help' || firstArg === '-h') {
		return {
			kind: 'root-help',
			help: options.help,
		};
	}

	if (firstArg === 'help') {
		const hasRealHelpCommand = options.schema.commands.some(
			(command) => command.schema.name === 'help' || command.schema.aliases.includes('help'),
		);
		if (!hasRealHelpCommand) {
			const rest = filteredArgv.slice(1);
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

	if (firstArg === undefined && options.schema.defaultCommand === undefined) {
		return {
			kind: 'root-help',
			help: options.help,
		};
	}

	if (options.schema.commands.length === 0) {
		return {
			kind: 'dispatch-error',
			error: new CLIError('No commands registered', {
				code: 'NO_ACTION',
				suggest: 'Add commands via .command() before calling .run()',
			}),
		};
	}

	const result = dispatch(filteredArgv, buildRootCommandMap(options.schema.commands));
	const defaultCommand = options.schema.defaultCommand;

	switch (result.kind) {
		case 'unknown': {
			if (defaultCommand !== undefined && result.parentPath.length === 0) {
				const suggestion =
					result.input !== '' ? findClosestCommand(result.input, result.candidates) : undefined;
				if (suggestion === undefined) {
					return buildPlannerMatchOutcome(
						options.schema,
						defaultCommand,
						[defaultCommand.schema],
						filteredArgv,
						options.help,
						options.output,
					);
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
	RootHelpOutcome,
	RootVersionOutcome,
};
export { buildCommandExecutionPlan, buildRootCommandMap, mergeCommandSchema, planInvocation };
