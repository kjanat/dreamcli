/**
 * Propagated flag collection for nested command dispatch.
 *
 * Walks a command path (root ancestor to target) and collects flags marked
 * `propagate: true`. Child commands that define a flag with the same name
 * as a propagated ancestor flag "shadow" the ancestor's flag — the child's
 * definition wins.
 *
 * @module dreamcli/core/cli/propagate
 */

import type { CommandSchema, FlagSchema } from '../schema/index.js';

// ---------------------------------------------------------------------------
// Propagated flag collection
// ---------------------------------------------------------------------------

/**
 * Collect propagated flags from a command path.
 *
 * The command path is an ordered array of `CommandSchema` from the root
 * ancestor to the target command that will actually execute. Each ancestor's
 * flags marked `propagate: true` are accumulated. If a descendant (including
 * the target) defines a flag with the same name — regardless of whether the
 * descendant's flag has `propagate: true` — it shadows the ancestor's flag.
 *
 * The target command's own flags are **not** included in the result. This
 * function returns only the *inherited* propagated flags that should be merged
 * into the target command's flag set before resolution.
 *
 * @param commandPath - Ordered schemas from root ancestor to target (inclusive).
 *   Must contain at least one element (the target itself). When the path has
 *   only one element, no ancestors exist and the result is empty.
 *
 * @returns A record of propagated flag schemas keyed by flag name. Empty when
 *   the path has no ancestors or no ancestor flags have `propagate: true`.
 *
 * @example
 * ```ts
 * // Given: root (--verbose [propagate]) → db → migrate
 * // Where migrate does NOT define --verbose
 * const inherited = collectPropagatedFlags([rootSchema, dbSchema, migrateSchema]);
 * // inherited = { verbose: <FlagSchema from root> }
 *
 * // If db also defines --verbose (shadowing root):
 * const inherited2 = collectPropagatedFlags([rootSchema, dbSchemaWithVerbose, migrateSchema]);
 * // inherited2 = { verbose: <FlagSchema from db> }
 * ```
 */
function collectPropagatedFlags(
	commandPath: readonly CommandSchema[],
): Readonly<Record<string, FlagSchema>> {
	if (commandPath.length <= 1) return {};

	// Ancestors = all elements except the last (target).
	// Walk root → ... → parent, accumulating propagated flags.
	// Later ancestors shadow earlier ones (natural overwrite order).
	const accumulated: Record<string, FlagSchema> = {};

	for (let i = 0; i < commandPath.length - 1; i++) {
		const ancestor = commandPath[i];
		if (ancestor === undefined) continue;

		for (const [name, flagSchema] of Object.entries(ancestor.flags)) {
			if (flagSchema.propagate) {
				accumulated[name] = flagSchema;
			}
		}
	}

	// Remove any flag names that the target command defines directly.
	// A target's own flag — propagated or not — shadows inherited flags.
	const target = commandPath[commandPath.length - 1];
	if (target !== undefined) {
		for (const name of Object.keys(target.flags)) {
			delete accumulated[name];
		}
	}

	return accumulated;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { collectPropagatedFlags };
