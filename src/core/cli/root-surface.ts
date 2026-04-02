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
	readonly commands: ReadonlyArray<{
		readonly schema: CommandSchema;
	}>;
	readonly defaultCommand: { readonly schema: CommandSchema } | undefined;
}

/**
 * Normalized root shape shared by help and completion logic.
 *
 * @internal
 */
interface RootSurface {
	readonly visibleCommands: readonly CommandSchema[];
	readonly visibleDefaultCommand: CommandSchema | undefined;
	readonly hasSingleVisibleDefault: boolean;
	readonly hasVisibleSiblingCommands: boolean;
}

/**
 * Resolve the visible shape of the CLI root.
 *
 * Hidden commands are excluded from the visible command list. Hidden
 * default commands remain executable, but are not surfaced through
 * help or completions.
 *
 * @internal
 */
function resolveRootSurface(schema: RootSurfaceSchemaLike): RootSurface {
	const visibleCommands = schema.commands
		.map((command) => command.schema)
		.filter((command) => !command.hidden);
	const rawDefaultCommand = schema.defaultCommand?.schema;
	const visibleDefaultCommand =
		rawDefaultCommand !== undefined && !rawDefaultCommand.hidden ? rawDefaultCommand : undefined;
	const hasSingleVisibleDefault =
		visibleDefaultCommand !== undefined &&
		visibleCommands.length === 1 &&
		visibleCommands[0]?.name === visibleDefaultCommand.name;
	const hasVisibleSiblingCommands =
		visibleDefaultCommand !== undefined &&
		visibleCommands.some((command) => command.name !== visibleDefaultCommand.name);

	return {
		visibleCommands,
		visibleDefaultCommand,
		hasSingleVisibleDefault,
		hasVisibleSiblingCommands,
	};
}

export type { RootSurface, RootSurfaceSchemaLike };
export { resolveRootSurface };
