/**
 * Shared infrastructure for shell completion generators.
 *
 * Provides the command tree walker, shell escaping utilities, and
 * the version tag used in generated script headers. Consumed by
 * the per-shell generators in sibling files.
 *
 * @module dreamcli/core/completion/shells/shared
 * @internal
 */

import { DREAMCLI_REVISION, DREAMCLI_VERSION } from '../../../version.ts';
import { collectPropagatedFlags } from '../../cli/propagate.ts';
import type { CommandSchema, FlagSchema } from '../../schema/index.ts';

// ---------------------------------------------------------------------------
// Version tag for generated script headers
// ---------------------------------------------------------------------------

/**
 * Format a version tag for generated completion script headers.
 *
 * Produces e.g. `"dreamcli v0.9.1 (f9b5f1a)"` when built, or
 * `"dreamcli"` when running unbundled in development.
 *
 * @internal
 */
function versionTag(): string {
	if (DREAMCLI_VERSION === 'dev') return 'dreamcli';
	const rev = DREAMCLI_REVISION !== 'dev' ? ` (${DREAMCLI_REVISION})` : '';
	return `dreamcli v${DREAMCLI_VERSION}${rev}`;
}

// ---------------------------------------------------------------------------
// CompletionOptions — generator configuration
// ---------------------------------------------------------------------------

/**
 * Options for completion script generation.
 *
 * Passed to individual shell generators alongside the CLI schema.
 * Currently a placeholder — future options may include custom function
 * name prefixes, output style tweaks, etc.
 */
interface CompletionOptions {
	/**
	 * Override the function name prefix in generated scripts.
	 * Defaults to the CLI name from the schema.
	 */
	readonly functionPrefix?: string;
}

// ---------------------------------------------------------------------------
// Command tree walking — shared infrastructure
// ---------------------------------------------------------------------------

/**
 * A flattened node from the command tree, carrying its ancestry context.
 *
 * Used by both bash and zsh generators to produce completions at every
 * nesting level with correct propagated flag inheritance.
 *
 * @internal
 */
interface CommandNode {
	/** Name path from root: `['db', 'migrate']` */
	readonly path: readonly string[];
	/** The command schema at this node */
	readonly schema: CommandSchema;
	/** Propagated flags inherited from ancestors (excludes own flags) */
	readonly propagatedFlags: Readonly<Record<string, FlagSchema>>;
	/** Merged flags: propagated + own (own shadows propagated) */
	readonly mergedFlags: Readonly<Record<string, FlagSchema>>;
	/** Visible child command schemas (for subcommand completion) */
	readonly children: readonly CommandSchema[];
}

/**
 * Walk the command tree depth-first, producing a flat list of
 * {@link CommandNode}s with propagated flag context.
 *
 * @param topLevel - Top-level visible command schemas.
 * @param ancestorSchemas - Schema path from root (for propagation calculation).
 * @returns Flat list of all visible nodes in the tree.
 *
 * @internal
 */
function walkCommandTree(
	topLevel: readonly CommandSchema[],
	ancestorSchemas: readonly CommandSchema[] = [],
): readonly CommandNode[] {
	const nodes: CommandNode[] = [];

	for (const schema of topLevel) {
		if (schema.hidden) continue;

		const fullPath = [...ancestorSchemas, schema];
		const propagatedFlags = collectPropagatedFlags(fullPath);
		const mergedFlags: Record<string, FlagSchema> = { ...propagatedFlags, ...schema.flags };
		const children = schema.commands.filter((c) => !c.hidden);

		nodes.push({
			path: fullPath.map((s) => s.name),
			schema,
			propagatedFlags,
			mergedFlags,
			children,
		});

		// Recurse into visible children only (hidden subtrees skipped entirely)
		if (children.length > 0) {
			nodes.push(...walkCommandTree(children, fullPath));
		}
	}

	return nodes;
}

// ---------------------------------------------------------------------------
// Shell escaping utilities
// ---------------------------------------------------------------------------

/**
 * Sanitize a string for use as a shell function identifier.
 * Replaces non-alphanumeric/underscore characters with underscores.
 * Used by both bash and zsh generators.
 *
 * @internal
 */
function sanitizeShellIdentifier(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Quote a string for safe interpolation into a shell script.
 *
 * Uses single-quote wrapping with the standard `'\''` idiom for
 * embedded single quotes. This prevents shell injection from CLI
 * names containing spaces, semicolons, backticks, or other
 * special characters.
 *
 * Returns the input unquoted if it consists only of shell-safe
 * characters (`[a-zA-Z0-9_\-.]`), avoiding unnecessary noise
 * in generated scripts for common CLI names like `my-cli` or `app.v2`.
 *
 * @internal
 */
function quoteShellArg(value: string): string {
	if (/^[a-zA-Z0-9_\-.]+$/.test(value)) return value;
	return `'${value.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { CommandNode, CompletionOptions };
export { quoteShellArg, sanitizeShellIdentifier, versionTag, walkCommandTree };
