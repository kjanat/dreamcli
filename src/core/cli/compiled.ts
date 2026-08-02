/**
 * Compiled execution graph behind a CLI program.
 *
 * {@linkcode CLISchema} describes the program; the compiled graph carries the
 * executable half — action handlers, execution steps, and the route-indexed
 * subcommand tree — and is reachable only through the module-private state in
 * `cli/index.ts`.
 *
 * @module dreamcli/core/cli/compiled
 * @internal
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import type {
	CommandBuilder,
	CommandSchema,
	ErasedActionHandler,
	ExecutionStep,
} from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import type { CLIPlugin } from './plugin.ts';

/**
 * Executable form of one registered command.
 *
 * @internal
 */
interface CompiledCommand {
	/** The very {@linkcode CommandSchema} object the public schema tree holds. */
	readonly schema: CommandSchema;
	/** Action handler, `undefined` for commands that only group subcommands. */
	readonly handler: ErasedActionHandler | undefined;
	/** Derive and middleware steps in registration order. */
	readonly steps: readonly ExecutionStep[];
	/** Nested subcommands, keyed by name and by every alias. */
	readonly subcommands: ReadonlyMap<string, CompiledCommand>;
}

/**
 * Executable state of a CLI program.
 *
 * @internal
 */
interface CompiledCLI {
	/** Top-level commands in registration order. */
	readonly commands: readonly CompiledCommand[];
	/** The default command, `undefined` when none is registered. */
	readonly defaultCommand: CompiledCommand | undefined;
	/** Plugins in registration order. */
	readonly plugins: readonly CLIPlugin[];
}

/**
 * The routes a command answers to: its name followed by its aliases.
 *
 * @param schema - Command schema to read the name and aliases from.
 * @returns Route tokens in declaration order.
 *
 * @internal
 */
function commandRoutes(schema: CommandSchema): readonly string[] {
	return [schema.name, ...schema.aliases];
}

/**
 * Reject a route already claimed by a sibling command, then record its owner.
 *
 * @param parentCommandName - Name of the command the siblings live under.
 * @param routeOwners - Route to owning command name, mutated with `route`.
 * @param route - Name or alias being registered.
 * @param commandName - Command claiming the route.
 *
 * @internal
 */
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

/**
 * Compile a command builder into its executable graph node.
 *
 * Extracts the handler and execution steps, then recurses into
 * `_subcommands` to index each child by name and alias. The builder itself is
 * not retained; `schema` is the builder's own schema object, so the compiled
 * node and the public schema tree share command schema identity.
 *
 * @param cmd - Command builder to compile.
 * @returns The compiled command node.
 * @throws {@linkcode CLIError} `DUPLICATE_COMMAND` when two siblings claim the same route.
 *
 * @internal
 */
function compileCommand<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown>,
>(cmd: CommandBuilder<F, A, C>): CompiledCommand {
	const subcommands = new Map<string, CompiledCommand>();
	const routeOwners = new Map<string, string>();
	for (const sub of cmd._subcommands) {
		const routes = commandRoutes(sub.schema);
		for (const route of routes) {
			assertNoSiblingRouteConflict(cmd.schema.name, routeOwners, route, sub.schema.name);
		}

		const compiled = compileCommand(sub);
		for (const route of routes) {
			subcommands.set(route, compiled);
		}
	}

	return {
		schema: cmd.schema,
		handler: cmd.handler,
		steps: cmd._executionSteps,
		subcommands,
	};
}

export type { CompiledCLI, CompiledCommand };
export { assertNoSiblingRouteConflict, commandRoutes, compileCommand };
