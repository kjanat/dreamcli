/**
 * Internal planner contract for CLI dispatch outcomes.
 *
 * Captures the stable seam between CLI-facing invocation planning and the
 * lower-level execution pipeline. This module documents the current contract
 * in code before the planner is extracted into its own execution stage.
 *
 * @module dreamcli/core/cli/planner
 * @internal
 */

import type { CLIError } from '#internals/core/errors/index.ts';
import type { HelpOptions } from '#internals/core/help/index.ts';
import type { Verbosity } from '#internals/core/output/index.ts';
import type { CommandMeta, CommandSchema, ErasedCommand } from '#internals/core/schema/command.ts';
import type { CLIPlugin } from './plugin.ts';
import { collectPropagatedFlags } from './propagate.ts';

/**
 * Output mode facts chosen before command execution starts.
 *
 * This is intentionally narrower than `OutputOptions`: planner code only
 * needs stable semantic facts, not concrete writers or renderer details.
 */
interface OutputPolicy {
	readonly jsonMode: boolean;
	readonly isTTY: boolean;
	readonly verbosity: Verbosity;
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
 * The current CLI still handles some branches inline, but these are the
 * bounded outcomes the extracted planner will eventually own.
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

export type {
	CommandExecutionPlan,
	DispatchErrorOutcome,
	DispatchOutcome,
	OutputPolicy,
	PlannerMatchOutcome,
	RootHelpOutcome,
	RootVersionOutcome,
};
export { buildCommandExecutionPlan, mergeCommandSchema };
