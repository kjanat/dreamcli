/**
 * Shared root-surface analysis for help and completion rendering.
 *
 * Answers structural questions about what the CLI root looks like:
 * which top-level commands are visible, whether the default command is
 * visible, and whether the root is effectively a single visible default.
 *
 * @module dreamcli/core/cli/root-surface
 * @internal
 */

import type { CommandSchema } from '#internals/core/schema/command.ts';

/**
 * Structural CLI shape needed for root-surface analysis.
 *
 * Uses structural typing to avoid importing the full `CLISchema` and
 * creating unnecessary cross-module coupling.
 *
 * @internal
 */
interface RootSurfaceSchemaLike {
	readonly commands: readonly CommandSchema[];
	readonly defaultCommand: CommandSchema | undefined;
	/**
	 * Whether the default command is also exposed as a named route
	 * (`.default(cmd, { route: true })`). Optional so hand-built schema-like
	 * objects default to the surface-only behavior.
	 */
	readonly defaultCommandRouted?: boolean | undefined;
}

/**
 * Normalized root shape shared by help and completion logic.
 *
 * Since v0.3 the default command is a distinct root *surface* rather than a
 * named subcommand: `.default()` no longer registers it under
 * {@link RootSurfaceSchemaLike.commands}. To stay robust against callers that
 * still place the default in the command list (e.g. hand-built test schemas),
 * {@link resolveRootSurface} always derives {@link RootSurface.visibleSubcommands}
 * by excluding the default command from the visible command list.
 *
 * @internal
 */
interface RootSurface {
	/** All visible top-level commands as declared in `schema.commands`. */
	readonly visibleCommands: readonly CommandSchema[];
	/** Visible real subcommands — `visibleCommands` minus the default command. */
	readonly visibleSubcommands: readonly CommandSchema[];
	/** The visible default command, or `undefined` when none exists or it is hidden. */
	readonly visibleDefaultCommand: CommandSchema | undefined;
	/** Whether a visible default command exists. */
	readonly hasVisibleDefault: boolean;
	/** Whether any visible real subcommands exist (the default does not count). */
	readonly hasVisibleSubcommands: boolean;
	/**
	 * Whether the visible default is also a named route (`.default(cmd, { route:
	 * true })`), meaning it should be listed in `Commands:` beside its siblings
	 * in addition to being rendered as the root surface.
	 */
	readonly defaultRouted: boolean;
}

/**
 * Resolve the visible shape of the CLI root.
 *
 * Hidden commands are excluded from the visible command list. Hidden
 * default commands remain executable, but are not surfaced through
 * help or completions. The default command is reported separately from the
 * real subcommands so help and completion can render it as the root surface
 * instead of echoing it as a pseudo-subcommand.
 *
 * @internal
 */
function resolveRootSurface(schema: RootSurfaceSchemaLike): RootSurface {
	const visibleCommands = schema.commands.filter((command) => !command.hidden);
	const rawDefaultCommand = schema.defaultCommand;
	const visibleDefaultCommand =
		rawDefaultCommand !== undefined && !rawDefaultCommand.hidden ? rawDefaultCommand : undefined;
	const visibleSubcommands =
		visibleDefaultCommand !== undefined
			? visibleCommands.filter((command) => command.name !== visibleDefaultCommand.name)
			: visibleCommands;

	return {
		visibleCommands,
		visibleSubcommands,
		visibleDefaultCommand,
		hasVisibleDefault: visibleDefaultCommand !== undefined,
		hasVisibleSubcommands: visibleSubcommands.length > 0,
		defaultRouted: visibleDefaultCommand !== undefined && schema.defaultCommandRouted === true,
	};
}

export type { RootSurface, RootSurfaceSchemaLike };
export { resolveRootSurface };
