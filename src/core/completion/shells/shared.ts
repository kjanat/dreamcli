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

import type { BuiltinsConfig } from '#internals/core/cli/builtins.ts';
import { builtinEnabled } from '#internals/core/cli/builtins.ts';
import { collectPropagatedFlags } from '#internals/core/cli/propagate.ts';
import { resolveRootSurface } from '#internals/core/cli/root-surface.ts';
import { createFlagSchema, getFlagNegatedName } from '#internals/core/schema/flag.ts';
import type { CommandSchema, FlagSchema } from '#internals/core/schema/index.ts';
import { DREAMCLI_REVISION, DREAMCLI_VERSION } from '#internals/version.ts';

// --- Version tag for generated script headers

/**
 * Format a version tag for generated completion script headers.
 *
 * Produces e.g. `"@kjanat/dreamcli v0.9.1 (f9b5f1a)"` when built, or
 * `"@kjanat/dreamcli"` when running unbundled in development.
 *
 * @internal
 */
function versionTag(): string {
	if (DREAMCLI_VERSION === 'dev') return '@kjanat/dreamcli';
	const rev = DREAMCLI_REVISION !== 'dev' ? ` (${DREAMCLI_REVISION})` : '';
	return `@kjanat/dreamcli v${DREAMCLI_VERSION}${rev}`;
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
	 * Where the built-in shell completion is exposed.
	 *
	 * - `'command'` registers a `completions` subcommand (the default).
	 * - `'flag'` exposes an eager `--completions <shell>` flag on the CLI root
	 *   instead, keeping the root free of a `completions` subcommand.
	 *
	 * @defaultValue `'command'`
	 */
	readonly as?: 'command' | 'flag';
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
	 * @defaultValue `'subcommands'`
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
	readonly commands: readonly CommandSchema[];
	readonly defaultCommand: CommandSchema | undefined;
	readonly defaultCommandRouted?: boolean | undefined;
	readonly version: string | undefined;
	/**
	 * Built-in flag state. `help: 'off'` drops the synthetic root `--help` so a
	 * command's own `help` flag is the only one completed. Optional so
	 * hand-built schema-like objects keep every built-in.
	 */
	readonly builtins?: BuiltinsConfig | undefined;
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
	const rootFlags = createRootFlags(
		builtinEnabled(schema.builtins, 'help'),
		schema.version !== undefined,
	);
	const defaultFlags = rootSurface.visibleDefaultCommand?.flags ?? {};
	// Default flags surface at the root either always (`surface`) or only when
	// the default is the sole surface (`subcommands`).
	const includeDefaultFlags =
		rootMode === 'surface'
			? rootSurface.hasVisibleDefault
			: rootSurface.hasVisibleDefault && !rootSurface.hasVisibleSubcommands;

	// A surface-only default is invoked at the root and is not a named route, so
	// completion must not advertise its name as a subcommand. A routed default is
	// re-added because `.default(cmd, { route: true })` keeps the command identity
	// in `defaultCommand` rather than duplicating it in `commands`.
	const defaultCommand = rootSurface.visibleDefaultCommand;
	const alreadyListed =
		defaultCommand !== undefined &&
		rootSurface.visibleCommands.some((c) => c.name === defaultCommand.name);
	const visibleCommands =
		rootSurface.defaultRouted && defaultCommand !== undefined && !alreadyListed
			? [defaultCommand, ...rootSurface.visibleCommands]
			: rootSurface.defaultRouted
				? rootSurface.visibleCommands
				: rootSurface.visibleSubcommands;

	return {
		visibleCommands,
		visibleDefaultCommand: rootSurface.visibleDefaultCommand,
		rootFlags,
		defaultFlags,
		includeDefaultFlags,
	};
}

/**
 * Build the synthetic root-level flags (`--help`, optionally `--version`).
 *
 * @param hasHelp - Whether the root still owns `--help`.
 * @param hasVersion - Whether to include a `--version` flag.
 * @returns A record of root flag schemas.
 * @internal
 */
function createRootFlags(
	hasHelp: boolean,
	hasVersion: boolean,
): Readonly<Record<string, FlagSchema>> {
	return {
		...(hasHelp ? { help: createSyntheticRootFlag('Show help text') } : {}),
		...(hasVersion ? { version: createSyntheticRootFlag('Show version') } : {}),
	};
}

/**
 * Create a minimal boolean {@link FlagSchema} for a synthetic root flag.
 *
 * @param description - Help text for the flag.
 * @returns A complete flag schema with all optional fields defaulted.
 * @internal
 */
function createSyntheticRootFlag(description: string): FlagSchema {
	return createFlagSchema('boolean', { description });
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

// --- Negation — shared visibility filter

/**
 * Effective negated long-form spelling for user-facing suggestion lists.
 *
 * Returns the negated spelling without the `--` prefix (e.g. `no-verbose`)
 * when the flag is negatable and the negation is not hidden; `undefined`
 * otherwise. Negated spellings are long-only and take no value, so they only
 * belong in suggestion lists — never in value-flag (operand-skip) patterns.
 *
 * @internal
 */
function getVisibleNegatedName(name: string, schema: FlagSchema): string | undefined {
	if (schema.negation === undefined || schema.negation.hidden) return undefined;
	return getFlagNegatedName(name, schema);
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

export type { CommandNode, CompletionOptions, RootCompletionSurface };
export {
	getVisibleNegatedName,
	quoteShellArg,
	resolveRootCompletionSurface,
	sanitizeShellIdentifier,
	versionTag,
	walkCommandTree,
};
