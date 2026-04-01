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

import { collectPropagatedFlags } from '#internals/core/cli/propagate.ts';
import { resolveRootSurface } from '#internals/core/cli/root-surface.ts';
import type { CommandSchema, FlagSchema } from '#internals/core/schema/index.ts';
import { DREAMCLI_REVISION, DREAMCLI_VERSION } from '#internals/version.ts';

// --- Version tag for generated script headers

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

// --- CompletionOptions — generator configuration

/**
 * Options for completion script generation.
 *
 * Passed to individual shell generators alongside the CLI schema.
 *
 * These options affect the generated script text, not runtime completion
 * behavior after installation.
 */
interface CompletionOptions {
	/**
	 * Override the generated shell function name prefix.
	 *
	 * Defaults to the CLI name from the schema. This is mainly useful when
	 * embedding multiple generated scripts in the same environment and you want
	 * deterministic, collision-free helper names.
	 *
	 * @example
	 * ```ts
	 * generateCompletion(schema, 'bash', { functionPrefix: 'acme' });
	 * ```
	 */
	readonly functionPrefix?: string;
	/**
	 * Controls which root-level surface shell completion exposes when a
	 * default command exists.
	 *
	 * - `'subcommands'` keeps hybrid CLIs command-centric at the root while
	 *   still exposing default-command flags for a single visible default
	 *   command.
	 * - `'surface'` exposes the default command's root-usable flags at the
	 *   root whenever a visible default command exists.
	 *
	 * @default 'subcommands'
	 */
	readonly rootMode?: 'subcommands' | 'surface';
}

// --- Root completion surface — shared policy resolver

/**
 * Normalized root completion surface consumed by shell generators.
 *
 * @internal
 */
interface RootCompletionSurface {
	readonly visibleCommands: readonly CommandSchema[];
	readonly visibleDefaultCommand: CommandSchema | undefined;
	readonly rootFlags: Readonly<Record<string, FlagSchema>>;
	readonly defaultFlags: Readonly<Record<string, FlagSchema>>;
	readonly includeDefaultFlags: boolean;
}

/**
 * Schema shape needed to compute the root completion surface.
 *
 * @internal
 */
interface RootCompletionSchemaLike {
	readonly commands: ReadonlyArray<{
		readonly schema: CommandSchema;
	}>;
	readonly defaultCommand: { readonly schema: CommandSchema } | undefined;
	readonly version: string | undefined;
}

/**
 * Resolve the root-level completion surface from the CLI schema and policy.
 *
 * @internal
 */
function resolveRootCompletionSurface(
	schema: RootCompletionSchemaLike,
	rootMode: CompletionOptions['rootMode'] = 'subcommands',
): RootCompletionSurface {
	const rootSurface = resolveRootSurface(schema);
	const rootFlags = createRootFlags(schema.version !== undefined);
	const defaultFlags = rootSurface.visibleDefaultCommand?.flags ?? {};
	const includeDefaultFlags =
		rootMode === 'surface'
			? rootSurface.visibleDefaultCommand !== undefined
			: rootSurface.hasSingleVisibleDefault;

	return {
		visibleCommands: rootSurface.visibleCommands,
		visibleDefaultCommand: rootSurface.visibleDefaultCommand,
		rootFlags,
		defaultFlags,
		includeDefaultFlags,
	};
}

function createRootFlags(hasVersion: boolean): Readonly<Record<string, FlagSchema>> {
	return {
		help: createSyntheticRootFlag('Show help text'),
		...(hasVersion ? { version: createSyntheticRootFlag('Show version') } : {}),
	};
}

function createSyntheticRootFlag(description: string): FlagSchema {
	return {
		kind: 'boolean',
		presence: 'optional',
		defaultValue: undefined,
		aliases: [],
		envVar: undefined,
		configPath: undefined,
		description,
		enumValues: undefined,
		elementSchema: undefined,
		prompt: undefined,
		parseFn: undefined,
		deprecated: undefined,
		propagate: false,
	};
}

// --- Command tree walking — shared infrastructure

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

// --- Shell escaping utilities

/**
 * Sanitize a string for use as a shell function identifier.
 * Replaces non-alphanumeric/underscore characters with underscores.
 * When sanitization changes the name, appends a short stable hash suffix so
 * distinct originals cannot collide on the same helper identifier.
 * Used by both bash and zsh generators.
 *
 * @internal
 */
function sanitizeShellIdentifier(name: string): string {
	const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
	if (sanitized === name) {
		return sanitized;
	}

	let hash = 2166136261;
	for (let i = 0; i < name.length; i += 1) {
		hash ^= name.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}

	return `${sanitized}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
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

// --- Exports

export {
	quoteShellArg,
	resolveRootCompletionSurface,
	sanitizeShellIdentifier,
	versionTag,
	walkCommandTree,
};
export type { CommandNode, CompletionOptions, RootCompletionSurface };
