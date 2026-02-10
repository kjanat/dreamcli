/**
 * Recursive command dispatch for nested command trees.
 *
 * Walks argv segments, matching command names at each level of the tree.
 * Returns a discriminated union describing the dispatch outcome: a matched
 * command with its ancestor path, a group that needs a subcommand, or an
 * unknown command with suggestion candidates.
 *
 * @module dreamcli/core/cli/dispatch
 * @internal
 */

import type { CommandSchema, ErasedCommand } from '../schema/command.js';

// ---------------------------------------------------------------------------
// Dispatch result types (discriminated union)
// ---------------------------------------------------------------------------

/** Successful dispatch — target command found with argv path. */
interface DispatchMatch {
	readonly kind: 'match';
	/** The matched (target) command. */
	readonly command: ErasedCommand;
	/** Root → target (inclusive). Used for `collectPropagatedFlags()`. */
	readonly commandPath: readonly CommandSchema[];
	/** argv after consuming command name segments. */
	readonly remainingArgv: readonly string[];
}

/** Target has subcommands but no handler and no subcommand was specified/matched. */
interface DispatchNeedsSubcommand {
	readonly kind: 'needs-subcommand';
	/** The group command that needs a subcommand. */
	readonly command: ErasedCommand;
	/** Root → group (inclusive). */
	readonly commandPath: readonly CommandSchema[];
}

/** Unknown command name at this dispatch level. */
interface DispatchUnknown {
	readonly kind: 'unknown';
	/** The unrecognised input token. Empty string when no token present. */
	readonly input: string;
	/** Commands available at the level where matching failed. */
	readonly candidates: readonly ErasedCommand[];
	/** Ancestor path up to (but not including) the unknown level. */
	readonly parentPath: readonly CommandSchema[];
}

type DispatchResult = DispatchMatch | DispatchNeedsSubcommand | DispatchUnknown;

// ---------------------------------------------------------------------------
// Recursive dispatch
// ---------------------------------------------------------------------------

/**
 * Recursively walk argv, consuming command name segments from the front.
 *
 * At each level, the first non-flag token is tested as a command name
 * against the provided command map. If matched and the matched command
 * has subcommands, dispatch recurses into the child level with the
 * remaining argv.
 *
 * Ambiguity resolution for commands that have both an action handler AND
 * subcommands (e.g. `git remote` lists remotes, `git remote add` dispatches):
 * - If the next token matches a subcommand → descend
 * - If the next token is unknown and the command has a handler → match here
 * - If the next token is unknown and no handler → propagate unknown error
 * - If no next token and command has a handler → match here
 * - If no next token and no handler → needs-subcommand
 *
 * @param argv - Remaining argv tokens (command names + flags + args).
 * @param commands - Command map at the current tree level.
 * @param ancestorPath - Schema path from root to current level (exclusive).
 * @returns Discriminated dispatch result.
 *
 * @internal
 */
function dispatch(
	argv: readonly string[],
	commands: ReadonlyMap<string, ErasedCommand>,
	ancestorPath: readonly CommandSchema[] = [],
): DispatchResult {
	// Find first non-flag token (potential command name).
	// Flags may appear before the command name (e.g. `--verbose db migrate`).
	// `--` terminates flag scanning — the next token is treated as a command name.
	let cmdIdx = -1;
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === '--') {
			// End-of-flags marker: next token (if any) is the command name.
			if (i + 1 < argv.length) cmdIdx = i + 1;
			break;
		}
		if (token !== undefined && !token.startsWith('-')) {
			cmdIdx = i;
			break;
		}
	}

	if (cmdIdx === -1) {
		// No command name token found — only flags or empty argv.
		return {
			kind: 'unknown',
			input: '',
			candidates: uniqueCommands(commands),
			parentPath: ancestorPath,
		};
	}

	const cmdName = argv[cmdIdx];
	if (cmdName === undefined) {
		return {
			kind: 'unknown',
			input: '',
			candidates: uniqueCommands(commands),
			parentPath: ancestorPath,
		};
	}

	const matched = commands.get(cmdName);
	if (matched === undefined) {
		return {
			kind: 'unknown',
			input: cmdName,
			candidates: uniqueCommands(commands),
			parentPath: ancestorPath,
		};
	}

	// Remove command name token from argv, preserving order.
	const remaining = [...argv.slice(0, cmdIdx), ...argv.slice(cmdIdx + 1)];
	const currentPath = [...ancestorPath, matched.schema];

	// If command has subcommands, try to descend.
	if (matched.subcommands.size > 0) {
		const subResult = dispatch(remaining, matched.subcommands, currentPath);

		switch (subResult.kind) {
			case 'match':
				// Successfully found deeper target.
				return subResult;

			case 'unknown':
				if (subResult.input === '') {
					// No subcommand specified.
					if (matched.schema.hasAction) {
						return {
							kind: 'match',
							command: matched,
							commandPath: currentPath,
							remainingArgv: remaining,
						};
					}
					return { kind: 'needs-subcommand', command: matched, commandPath: currentPath };
				}

				// Unknown token — might be a positional arg for this command.
				if (matched.schema.hasAction) {
					return {
						kind: 'match',
						command: matched,
						commandPath: currentPath,
						remainingArgv: remaining,
					};
				}
				// No handler — propagate the unknown error.
				return subResult;

			case 'needs-subcommand':
				// Propagate from deeper level.
				return subResult;
		}
	}

	// Leaf command (no subcommands).
	return {
		kind: 'match',
		command: matched,
		commandPath: currentPath,
		remainingArgv: remaining,
	};
}

// ---------------------------------------------------------------------------
// "Did you mean?" suggestion
// ---------------------------------------------------------------------------

/**
 * Levenshtein distance between two strings.
 * @internal
 */
function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		Array.from({ length: n + 1 }, () => 0),
	);

	for (let i = 0; i <= m; i++) {
		const row = dp[i];
		if (row !== undefined) row[0] = i;
	}
	for (let j = 0; j <= n; j++) {
		const row = dp[0];
		if (row !== undefined) row[j] = j;
	}

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
			const prevRow = dp[i - 1];
			const currRow = dp[i];
			if (prevRow !== undefined && currRow !== undefined) {
				const del = prevRow[j];
				const ins = currRow[j - 1];
				const sub = prevRow[j - 1];
				if (del !== undefined && ins !== undefined && sub !== undefined) {
					currRow[j] = Math.min(del + 1, ins + 1, sub + cost);
				}
			}
		}
	}

	const lastRow = dp[m];
	return lastRow !== undefined && lastRow[n] !== undefined ? lastRow[n] : Math.max(m, n);
}

/**
 * Find the closest command name match for a "did you mean?" suggestion.
 *
 * Searches command names and aliases. Returns `undefined` if no
 * sufficiently close match exists (threshold: 3).
 *
 * @internal
 */
function findClosestCommand(input: string, commands: readonly ErasedCommand[]): string | undefined {
	const MAX_DISTANCE = 3;
	let bestName: string | undefined;
	let bestDist = MAX_DISTANCE + 1;

	for (const cmd of commands) {
		// Check main name
		const nameDist = levenshtein(input, cmd.schema.name);
		if (nameDist < bestDist) {
			bestDist = nameDist;
			bestName = cmd.schema.name;
		}
		// Check aliases
		for (const alias of cmd.schema.aliases) {
			const aliasDist = levenshtein(input, alias);
			if (aliasDist < bestDist) {
				bestDist = aliasDist;
				bestName = cmd.schema.name; // suggest canonical name
			}
		}
	}

	return bestDist <= MAX_DISTANCE ? bestName : undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicate commands from a name+alias map.
 *
 * A map keyed by name *and* alias contains duplicate entries for aliased
 * commands. This returns unique commands (by schema identity).
 *
 * @internal
 */
function uniqueCommands(commands: ReadonlyMap<string, ErasedCommand>): readonly ErasedCommand[] {
	const seen = new Set<ErasedCommand>();
	const result: ErasedCommand[] = [];
	for (const cmd of commands.values()) {
		if (!seen.has(cmd)) {
			seen.add(cmd);
			result.push(cmd);
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { dispatch, findClosestCommand, levenshtein, uniqueCommands };
export type { DispatchMatch, DispatchNeedsSubcommand, DispatchResult, DispatchUnknown };
