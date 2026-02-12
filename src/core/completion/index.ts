/**
 * Shell completion script generation from command schemas.
 *
 * Each shell has a dedicated generator that takes a {@link CLISchema} and
 * returns a complete shell-specific completion script as a string.
 * Generators walk the full command tree depth, including propagated flags
 * from ancestor commands at each nesting level.
 *
 * @module dreamcli/core/completion
 */

import type { CLISchema } from '../cli/index.ts';
import { collectPropagatedFlags } from '../cli/propagate.ts';
import { CLIError } from '../errors/index.ts';
import type { CommandSchema, FlagSchema } from '../schema/index.ts';

// ---------------------------------------------------------------------------
// Shell type — supported completion targets
// ---------------------------------------------------------------------------

/**
 * Supported shell targets for completion script generation.
 *
 * `bash` and `zsh` are implemented first; `fish` and `powershell` are
 * declared for forward compatibility but throw on generation.
 */
type Shell = 'bash' | 'zsh' | 'fish' | 'powershell';

/**
 * All shell values as a frozen readonly non-empty tuple (useful for validation + flag.enum()).
 *
 * **Only `bash` and `zsh` are implemented.** `fish` and `powershell` are reserved for future use
 * and will throw a {@link CLIError} with code `UNSUPPORTED_OPERATION` at generation time.
 * Because `flag.enum(SHELLS)` exposes all four values, callers should be aware that selecting
 * an unimplemented shell produces a runtime error, not a validation error.
 *
 * @see {@link Shell} for the union type matching these entries.
 */
const SHELLS: Readonly<readonly ['bash', 'zsh', 'fish', 'powershell']> = Object.freeze([
	'bash',
	'zsh',
	'fish',
	'powershell',
] as const satisfies readonly [Shell, ...Shell[]]);

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
// Generator function signatures
// ---------------------------------------------------------------------------

/**
 * Generates a completion script for the given shell.
 *
 * @param schema - The CLI schema describing commands, flags, and args.
 * @param shell - Target shell.
 * @param options - Optional generator configuration.
 * @returns A complete shell completion script as a string.
 * @throws {CLIError} If the shell is not yet supported.
 */
function generateCompletion(schema: CLISchema, shell: Shell, options?: CompletionOptions): string {
	switch (shell) {
		case 'bash':
			return generateBashCompletion(schema, options);
		case 'zsh':
			return generateZshCompletion(schema, options);
		case 'fish':
		case 'powershell':
			throw new CLIError(`Shell completion for '${shell}' is not yet supported`, {
				code: 'UNSUPPORTED_OPERATION',
				suggest: 'Supported shells: bash, zsh',
			});
	}
}

/**
 * Generates a bash completion script for the CLI.
 *
 * Produces a self-contained bash script with:
 * - A main `_<name>_completions` function using `COMP_WORDS`/`COMP_CWORD`
 * - Multi-level subcommand path detection via progressive COMP_WORDS scanning
 * - Per-command case branches with flag and subcommand completions
 * - Propagated flags from ancestor commands at each nesting level
 * - Enum value completions for `--flag=<value>` patterns
 * - A `complete -F` registration line
 *
 * **Requires** the `bash-completion` package (`_init_completion`).
 * Users must install it before sourcing the generated script.
 *
 * @param schema - The CLI schema.
 * @param options - Optional generator configuration.
 * @returns A complete bash completion script.
 */
function generateBashCompletion(schema: CLISchema, options?: CompletionOptions): string {
	const prefix = options?.functionPrefix ?? schema.name;
	const funcName = `_${sanitizeShellIdentifier(prefix)}_completions`;
	const visibleCommands = schema.commands.map((c) => c.schema).filter((s) => !s.hidden);
	const nodes = walkCommandTree(visibleCommands);
	const maxDepth = nodes.reduce((max, n) => Math.max(max, n.path.length), 0);

	const lines: string[] = [];

	lines.push('#!/usr/bin/env bash');
	lines.push(`# Bash completion for ${schema.name}`);
	lines.push(`# Generated by dreamcli`);
	lines.push('#');
	lines.push(`# Usage:  source <(${schema.name} completions bash)`);
	lines.push('#');
	lines.push('# Install permanently:');
	lines.push(
		`#   ${schema.name} completions bash > /etc/bash_completion.d/${schema.name}    # Linux`,
	);
	lines.push(
		`#   ${schema.name} completions bash > $(brew --prefix)/etc/bash_completion.d/${schema.name}  # macOS`,
	);
	lines.push('#');
	lines.push('# Requires: bash-completion (provides _init_completion)');
	lines.push('');
	lines.push(`${funcName}() {`);
	lines.push(`\tlocal cur prev words cword`);
	lines.push(`\t_init_completion || return`);
	lines.push('');

	// --- Subcommand dispatch ---
	if (visibleCommands.length > 0) {
		const groupNodes = nodes.filter((n) => n.children.length > 0);

		// Build subcommand path by scanning COMP_WORDS at each depth level.
		// At depth 0 we look for top-level command names, at depth 1 we look
		// for children of the matched depth-0 command, etc.
		lines.push('\t# Build subcommand path by scanning COMP_WORDS');
		lines.push('\tlocal subcmd_path=""');
		lines.push('\tlocal i');
		lines.push('\tfor ((i = 1; i < cword; i++)); do');
		// biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax, not JS template
		lines.push('\t\tcase "${words[i]}" in');
		lines.push('\t\t\t-*) continue ;;');
		lines.push('\t\tesac');

		// Emit progressive path-building cases
		emitBashPathDetection(lines, visibleCommands, groupNodes, maxDepth);

		lines.push('\tdone');
		lines.push('');

		// Per-path completions: one case branch per node
		lines.push('\t# Complete flags and subcommands for the active path');
		lines.push('\tcase "$subcmd_path" in');

		for (const node of nodes) {
			const pathKey = node.path.join(' ');
			const allNames = [node.schema.name, ...node.schema.aliases];
			const mergedFlags = node.mergedFlags;
			const enumCases = collectEnumCasesFromFlags(mergedFlags);
			const flagWords = collectFlagWords(mergedFlags);
			const childNames = node.children.map((c) => escapeForSingleQuote(c.name)).join(' ');
			const escapedFlagWords = flagWords
				.split(' ')
				.filter(Boolean)
				.map(escapeForSingleQuote)
				.join(' ');
			const completionWords =
				childNames.length > 0 ? `${childNames} ${escapedFlagWords}` : escapedFlagWords;

			// Use both name and aliases as case patterns via pathKey variations
			if (node.path.length === 1) {
				lines.push(`\t\t${allNames.join('|')})`);
			} else {
				// For nested paths, the path key always uses the canonical name
				lines.push(`\t\t${quoteShellCasePattern(pathKey)})`);
			}

			if (enumCases.length > 0) {
				lines.push('\t\t\tcase "$prev" in');
				for (const ec of enumCases) {
					lines.push(`\t\t\t\t${ec.flags})`);
					lines.push(formatBashEnumCompletion(ec.values, '\t\t\t\t\t'));
					lines.push('\t\t\t\t\treturn');
					lines.push('\t\t\t\t\t;;');
				}
				lines.push('\t\t\t\t*)');
				lines.push('\t\t\t\t\t;;');
				lines.push('\t\t\tesac');
			}

			lines.push(`\t\t\tCOMPREPLY=($(compgen -W '${completionWords.trim()}' -- "$cur"))`);
			lines.push('\t\t\treturn');
			lines.push('\t\t\t;;');
		}

		lines.push('\t\t*)');
		lines.push('\t\t\t;;');
		lines.push('\tesac');
		lines.push('');

		// --- Root-level: subcommands + global flags ---
		const rootFlags = schema.version !== undefined ? '--help --version' : '--help';
		const subNames = visibleCommands.map((s) => escapeForSingleQuote(s.name)).join(' ');
		lines.push(`\t# Root-level completions: subcommands and global flags`);
		lines.push(`\tCOMPREPLY=($(compgen -W '${subNames} ${rootFlags}' -- "$cur"))`);
	} else {
		const globalFlags = schema.version !== undefined ? '--help --version' : '--help';
		lines.push(`\tCOMPREPLY=($(compgen -W '${globalFlags}' -- "$cur"))`);
	}

	lines.push('}');
	lines.push('');
	lines.push(`complete -F ${funcName} ${quoteShellArg(schema.name)}`);
	lines.push('');

	return lines.join('\n');
}

/**
 * Emit bash case branches for progressive subcommand path detection.
 *
 * For each nesting depth, generates a `case "$subcmd_path"` that matches
 * the current accumulated path and extends it when a matching child command
 * name is found in COMP_WORDS.
 *
 * @internal
 */
function emitBashPathDetection(
	lines: string[],
	visibleCommands: readonly CommandSchema[],
	groupNodes: readonly CommandNode[],
	maxDepth: number,
): void {
	// Depth 0: match top-level command names
	const topLevelPatterns = visibleCommands.flatMap((s) => [s.name, ...s.aliases]);
	lines.push(`\t\tcase "$subcmd_path" in`);
	lines.push(`\t\t\t'')`);
	lines.push(`\t\t\t\tcase "\${words[i]}" in`);
	lines.push(`\t\t\t\t\t${topLevelPatterns.join('|')})`);
	lines.push(`\t\t\t\t\t\tsubcmd_path="\${words[i]}"`);
	lines.push(`\t\t\t\t\t\t;;`);
	lines.push(`\t\t\t\tesac`);
	lines.push(`\t\t\t\t;;`);

	// Deeper levels: for each group that has children, match its path and extend
	if (maxDepth > 1) {
		for (const node of groupNodes) {
			const pathKey = node.path.join(' ');
			const childPatterns = node.children.flatMap((c) => [c.name, ...c.aliases]);

			lines.push(`\t\t\t${quoteShellCasePattern(pathKey)})`);
			lines.push(`\t\t\t\tcase "\${words[i]}" in`);
			lines.push(`\t\t\t\t\t${childPatterns.join('|')})`);
			lines.push(`\t\t\t\t\t\tsubcmd_path="$subcmd_path \${words[i]}"`);
			lines.push(`\t\t\t\t\t\t;;`);
			lines.push(`\t\t\t\tesac`);
			lines.push(`\t\t\t\t;;`);
		}
	}

	lines.push(`\t\tesac`);
}

/**
 * Quote a string for use as a bash `case` pattern. Patterns containing
 * spaces need quoting to match as a single string.
 *
 * @internal
 */
function quoteShellCasePattern(pattern: string): string {
	if (!pattern.includes(' ')) return pattern;
	return `"${pattern}"`;
}

// ---------------------------------------------------------------------------
// Shared helpers — internal
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

/**
 * Escape a string for safe embedding inside an existing single-quoted
 * shell literal (e.g. inside `compgen -W '...'`).
 *
 * Uses the `'\''` idiom: close quote, escaped literal quote, reopen
 * quote. Returns the input unchanged when it consists only of shell-safe
 * characters, which covers the vast majority of flag/command names.
 *
 * @internal
 */
function escapeForSingleQuote(value: string): string {
	if (/^[a-zA-Z0-9_\-.]+$/.test(value)) return value;
	return value.replace(/'/g, "'\\''");
}

// ---------------------------------------------------------------------------
// Bash helpers — internal
// ---------------------------------------------------------------------------

/**
 * Format a COMPREPLY line for bash enum value completion.
 *
 * When all values are simple (no whitespace or special chars), emits a
 * standard `compgen -W 'v1 v2' -- "$cur"` line.
 *
 * When any value contains whitespace, single quotes, or backslashes,
 * uses `IFS=$'\n'` with `$'...'` quoting to split on newlines
 * instead of spaces, handling all special characters correctly.
 *
 * @internal
 */
function formatBashEnumCompletion(values: readonly string[], indent: string): string {
	const needsDollarQuoting = values.some((v) => !/^[a-zA-Z0-9_\-.]+$/.test(v));
	if (needsDollarQuoting) {
		const escaped = values.map(escapeBashDollarQuote);
		const joined = escaped.join('\\n');
		return `${indent}local IFS=$'\\n'\n${indent}COMPREPLY=($(compgen -W $'${joined}' -- "$cur"))`;
	}
	return `${indent}COMPREPLY=($(compgen -W '${values.join(' ')}' -- "$cur"))`;
}

/**
 * Escape a single enum value for use inside a bash `$'...'` string.
 *
 * In `$'...'` context:
 * - `\\` → literal backslash
 * - `\'` → literal single quote
 * - `\n` → newline (used as IFS delimiter, so must be escaped in values)
 *
 * Values that are simple identifiers pass through unescaped.
 *
 * @internal
 */
function escapeBashDollarQuote(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/**
 * Collect all `--flag` words (long + short aliases) for a flag record.
 *
 * @internal
 */
function collectFlagWords(flags: Readonly<Record<string, FlagSchema>>): string {
	const words: string[] = [];
	for (const [name, schema] of Object.entries(flags)) {
		words.push(`--${name}`);
		for (const alias of schema.aliases) {
			words.push(alias.length === 1 ? `-${alias}` : `--${alias}`);
		}
	}
	return words.join(' ');
}

/**
 * A consolidated enum-value case: the flag forms that trigger it and the values.
 *
 * @internal
 */
interface EnumCase {
	readonly flags: string;
	readonly values: readonly string[];
}

/**
 * Collect enum flag cases from a merged flag record.
 *
 * Each enum flag produces one case entry with its long/short flag forms
 * as the pattern and enum values as the completions.
 *
 * @internal
 */
function collectEnumCasesFromFlags(
	flags: Readonly<Record<string, FlagSchema>>,
): readonly EnumCase[] {
	const cases: EnumCase[] = [];
	for (const [name, schema] of Object.entries(flags)) {
		if (schema.kind !== 'enum' || schema.enumValues === undefined) continue;
		const flagForms = [
			`--${name}`,
			...schema.aliases.map((a) => (a.length === 1 ? `-${a}` : `--${a}`)),
		];
		cases.push({ flags: flagForms.join('|'), values: schema.enumValues });
	}
	return cases;
}

// ---------------------------------------------------------------------------
// Zsh completion generator
// ---------------------------------------------------------------------------

/**
 * Generates a zsh completion script for the CLI.
 *
 * Produces a self-contained zsh script with:
 * - A `#compdef` directive for auto-loading
 * - A main `_<name>` function with subcommand dispatch
 * - Per-group helper functions (`_<name>_<cmd>`) with recursive dispatch
 * - `_arguments` calls for flags with descriptions (including propagated flags)
 * - `_describe` for subcommand lists at each nesting level
 * - Enum value completions via `->state` dispatch
 *
 * @param schema - The CLI schema.
 * @param options - Optional generator configuration.
 * @returns A complete zsh completion script.
 */
function generateZshCompletion(schema: CLISchema, options?: CompletionOptions): string {
	const prefix = options?.functionPrefix ?? schema.name;
	const funcName = `_${sanitizeShellIdentifier(prefix)}`;
	const visibleCommands = schema.commands.map((c) => c.schema).filter((s) => !s.hidden);
	const nodes = walkCommandTree(visibleCommands);

	const lines: string[] = [];

	lines.push(`#compdef ${quoteShellArg(schema.name)}`);
	lines.push(`# Zsh completion for ${schema.name}`);
	lines.push(`# Generated by dreamcli`);
	lines.push('#');
	lines.push(`# Usage:  source <(${schema.name} completions zsh)`);
	lines.push('#');
	lines.push('# Install permanently:');
	lines.push(`#   ${schema.name} completions zsh > "\${fpath[1]}/_${schema.name}"`);
	lines.push('#   # Then restart your shell');
	lines.push('');

	// --- Generate helper functions for group commands (bottom-up) ---
	// Process deepest nodes first so all helpers exist before they're called.
	const groupNodes = nodes.filter((n) => n.children.length > 0);
	const leafNodes = nodes.filter((n) => n.children.length === 0);

	// Emit leaf helper functions
	for (const node of leafNodes) {
		if (node.path.length < 2) continue; // Top-level leaves handled inline
		const helperName = `${funcName}_${node.path.map(sanitizeShellIdentifier).join('_')}`;
		emitZshLeafFunction(lines, helperName, node);
	}

	// Emit group helper functions (deepest first)
	const sortedGroups = [...groupNodes].sort((a, b) => b.path.length - a.path.length);
	for (const node of sortedGroups) {
		const helperName = `${funcName}_${node.path.map(sanitizeShellIdentifier).join('_')}`;
		emitZshGroupFunction(lines, helperName, funcName, node);
	}

	// --- Main function ---
	lines.push(`${funcName}() {`);

	if (visibleCommands.length > 0) {
		lines.push('\tlocal -a subcmds');
		lines.push('\tlocal line state');
		lines.push('');

		// --- Root-level: global flags + subcommand argument ---
		lines.push('\t_arguments -C \\');
		lines.push("\t\t'--help[Show help text]' \\");
		if (schema.version !== undefined) {
			lines.push("\t\t'--version[Show version]' \\");
		}
		lines.push("\t\t'1: :->subcmd' \\");
		lines.push("\t\t'*::arg:->args'");
		lines.push('');

		// --- Subcommand list ---
		lines.push('\tcase "$state" in');
		lines.push('\t\tsubcmd)');
		lines.push('\t\t\tsubcmds=(');
		for (const cmd of visibleCommands) {
			const desc = escapeZshDescription(cmd.description ?? cmd.name);
			lines.push(`\t\t\t\t'${cmd.name}:${desc}'`);
		}
		lines.push('\t\t\t)');
		lines.push("\t\t\t_describe 'command' subcmds");
		lines.push('\t\t\t;;');

		// --- Per-command arguments ---
		lines.push('\t\targs)');
		lines.push('\t\t\tcase "$line[1]" in');
		for (const cmd of visibleCommands) {
			const allNames = [cmd.name, ...cmd.aliases];
			const childCommands = cmd.commands.filter((c) => !c.hidden);
			lines.push(`\t\t\t\t${allNames.join('|')})`);

			if (childCommands.length > 0) {
				// Group command — delegate to helper function
				const helperName = `${funcName}_${sanitizeShellIdentifier(cmd.name)}`;
				lines.push(`\t\t\t\t\t${helperName}`);
			} else {
				// Leaf command — emit flags inline
				const node = nodes.find((n) => n.path.length === 1 && n.schema.name === cmd.name);
				const flagSpecs = node
					? buildZshFlagSpecsFromFlags(node.mergedFlags)
					: buildZshFlagSpecs(cmd);

				if (flagSpecs.length > 0) {
					lines.push('\t\t\t\t\t_arguments \\');
					for (let i = 0; i < flagSpecs.length; i++) {
						const trailing = i < flagSpecs.length - 1 ? ' \\' : '';
						lines.push(`\t\t\t\t\t\t${flagSpecs[i]}${trailing}`);
					}
				}
			}
			lines.push('\t\t\t\t\t;;');
		}
		lines.push('\t\t\tesac');
		lines.push('\t\t\t;;');
		lines.push('\tesac');
	} else {
		// --- No subcommands: just global flags ---
		const globalFlags: string[] = ["'--help[Show help text]'"];
		if (schema.version !== undefined) {
			globalFlags.push("'--version[Show version]'");
		}
		lines.push('\t_arguments \\');
		for (let i = 0; i < globalFlags.length; i++) {
			const trailing = i < globalFlags.length - 1 ? ' \\' : '';
			lines.push(`\t\t${globalFlags[i]}${trailing}`);
		}
	}

	lines.push('}');
	lines.push('');
	lines.push(`${funcName} "$@"`);
	lines.push('');

	return lines.join('\n');
}

/**
 * Emit a zsh helper function for a group command (has subcommands).
 *
 * Uses `_arguments -C` for its own flags plus subcommand dispatch.
 *
 * @internal
 */
function emitZshGroupFunction(
	lines: string[],
	helperName: string,
	rootFuncName: string,
	node: CommandNode,
): void {
	lines.push(`${helperName}() {`);
	lines.push('\tlocal -a subcmds');
	lines.push('\tlocal line state');
	lines.push('');

	// Flags for this group (including propagated)
	const flagSpecs = buildZshFlagSpecsFromFlags(node.mergedFlags);

	lines.push('\t_arguments -C \\');
	for (const spec of flagSpecs) {
		lines.push(`\t\t${spec} \\`);
	}
	lines.push("\t\t'1: :->subcmd' \\");
	lines.push("\t\t'*::arg:->args'");
	lines.push('');

	lines.push('\tcase "$state" in');
	lines.push('\t\tsubcmd)');
	lines.push('\t\t\tsubcmds=(');
	for (const child of node.children) {
		const desc = escapeZshDescription(child.description ?? child.name);
		lines.push(`\t\t\t\t'${child.name}:${desc}'`);
	}
	lines.push('\t\t\t)');
	lines.push("\t\t\t_describe 'command' subcmds");
	lines.push('\t\t\t;;');

	lines.push('\t\targs)');
	lines.push('\t\t\tcase "$line[1]" in');
	for (const child of node.children) {
		const allNames = [child.name, ...child.aliases];
		const childPath = [...node.path, child.name];
		const childFuncName = `${rootFuncName}_${childPath.map(sanitizeShellIdentifier).join('_')}`;
		lines.push(`\t\t\t\t${allNames.join('|')})`);
		lines.push(`\t\t\t\t\t${childFuncName}`);
		lines.push('\t\t\t\t\t;;');
	}
	lines.push('\t\t\tesac');
	lines.push('\t\t\t;;');
	lines.push('\tesac');

	lines.push('}');
	lines.push('');
}

/**
 * Emit a zsh helper function for a leaf command (no subcommands).
 *
 * Uses plain `_arguments` with the command's own flags plus propagated flags.
 *
 * @internal
 */
function emitZshLeafFunction(lines: string[], helperName: string, node: CommandNode): void {
	const flagSpecs = buildZshFlagSpecsFromFlags(node.mergedFlags);

	lines.push(`${helperName}() {`);
	if (flagSpecs.length > 0) {
		lines.push('\t_arguments \\');
		for (let i = 0; i < flagSpecs.length; i++) {
			const trailing = i < flagSpecs.length - 1 ? ' \\' : '';
			lines.push(`\t\t${flagSpecs[i]}${trailing}`);
		}
	}
	lines.push('}');
	lines.push('');
}

// ---------------------------------------------------------------------------
// Zsh helpers — internal
// ---------------------------------------------------------------------------

/**
 * Escape single quotes and colons in descriptions for zsh `_describe` format.
 * Zsh uses `'name:description'` syntax — colons in descriptions must be escaped
 * with backslash, and single quotes must be handled.
 *
 * @internal
 */
function escapeZshDescription(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

/**
 * Escape a single enum value for use inside a zsh `(v1 v2)` value list.
 *
 * Simple identifier-like values (matching `[a-zA-Z0-9_\-.]`) pass through
 * unescaped. Values containing spaces, quotes, backslashes, or parentheses
 * are escaped with backslash prefixes for each special character, which
 * is the standard mechanism within zsh parenthesized completion lists.
 *
 * @internal
 */
function escapeZshEnumValue(value: string): string {
	if (/^[a-zA-Z0-9_\-.]+$/.test(value)) return value;
	return value
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/ /g, '\\ ')
		.replace(/\(/g, '\\(')
		.replace(/\)/g, '\\)');
}

/**
 * Build `_arguments` flag spec strings from a merged flag record.
 *
 * Each flag produces one or more spec strings in zsh `_arguments` format:
 * - `'--name[description]'` for simple flags
 * - `'--name[description]:value:(v1 v2 v3)'` for enum flags
 * - `'(-s --name)'{-s,--name}'[description]'` for flags with short aliases
 *
 * @internal
 */
function buildZshFlagSpecsFromFlags(
	flags: Readonly<Record<string, FlagSchema>>,
): readonly string[] {
	const specs: string[] = [];
	for (const [name, schema] of Object.entries(flags)) {
		const desc = escapeZshDescription(schema.description ?? name);
		const longFlag = `--${name}`;
		const shortFlags = schema.aliases.filter((a) => a.length === 1).map((a) => `-${a}`);

		let valuePart = '';
		if (schema.kind === 'boolean') {
			// Boolean flags take no argument value
		} else if (schema.kind === 'enum' && schema.enumValues !== undefined) {
			const escapedValues = schema.enumValues.map(escapeZshEnumValue);
			valuePart = `:value:(${escapedValues.join(' ')})`;
		} else {
			valuePart = ':value:';
		}

		if (shortFlags.length > 0) {
			// Mutual exclusion group with ALL short aliases + long flag
			// Format: '(-v -V --verbose)'{-v,-V,--verbose}'[desc]:value'
			const allForms = [...shortFlags, longFlag];
			const excl = `(${allForms.join(' ')})`;
			specs.push(`'${excl}'{${allForms.join(',')}}'[${desc}]${valuePart}'`);
		} else {
			specs.push(`'${longFlag}[${desc}]${valuePart}'`);
		}
	}
	return specs;
}

/**
 * Build `_arguments` flag spec strings for a command.
 *
 * Delegates to {@link buildZshFlagSpecsFromFlags} using the command's own flags.
 *
 * @internal
 */
function buildZshFlagSpecs(cmd: CommandSchema): readonly string[] {
	return buildZshFlagSpecsFromFlags(cmd.flags);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { generateBashCompletion, generateCompletion, generateZshCompletion, SHELLS };
export type { CompletionOptions, Shell };
