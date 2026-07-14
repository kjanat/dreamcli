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

import type { FlagLookupEntry, ParseOptions } from '#internals/core/parse/index.ts';
import { buildFlagLookup, flagExpectsValue } from '#internals/core/parse/index.ts';
import type { CommandSchema, ErasedCommand } from '#internals/core/schema/command.ts';

/**
 * Flag lookup (spelling → {@link FlagLookupEntry}) used to make the
 * command-name scan aware of value-flag arity. Built from the flags valid at
 * the current dispatch level via {@link buildFlagLookup}.
 *
 * @internal
 */
type ValueFlagLookup = ReadonlyMap<string, FlagLookupEntry>;

// --- Dispatch result types (discriminated union)

/** Successful dispatch — target command found with argv path. */
interface DispatchMatch {
	/** Discriminant — a command name in argv matched a registered command. */
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
	/** Discriminant — command group reached without a subcommand or handler. */
	readonly kind: 'needs-subcommand';
	/** The group command that needs a subcommand. */
	readonly command: ErasedCommand;
	/** Root → group (inclusive). */
	readonly commandPath: readonly CommandSchema[];
}

/** Unknown command name at this dispatch level. */
interface DispatchUnknown {
	/** Discriminant — no registered command matched the input token. */
	readonly kind: 'unknown';
	/** The unrecognised input token. Empty string when no token present. */
	readonly input: string;
	/** Commands available at the level where matching failed. */
	readonly candidates: readonly ErasedCommand[];
	/** Ancestor path up to (but not including) the unknown level. */
	readonly parentPath: readonly CommandSchema[];
}

/** Discriminated result of recursive command dispatch. */
type DispatchResult = DispatchMatch | DispatchNeedsSubcommand | DispatchUnknown;

// --- Recursive dispatch

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
 * @param valueFlags - Lookup of flags valid at this level, used so a
 *   space-separated value-flag's value (`--region eu`) is not mistaken for a
 *   command name. Empty by default (arity-unaware, legacy behaviour).
 * @param parseOptions - Parser toggles (case parity) applied to descent-level
 *   flag lookups built inside dispatch.
 * @returns Discriminated dispatch result.
 *
 * @internal
 */
function dispatch(
	argv: readonly string[],
	commands: ReadonlyMap<string, ErasedCommand>,
	ancestorPath: readonly CommandSchema[] = [],
	valueFlags: ValueFlagLookup = new Map(),
	parseOptions?: ParseOptions,
): DispatchResult {
	// Find first non-flag token (potential command name).
	// Flags may appear before the command name (e.g. `--verbose db migrate`).
	// `--` terminates flag scanning — the next token is treated as a command name.
	// Value-flags in space-separated form (`--region eu`, `-r eu`) consume the
	// following token as their value, so it must be skipped rather than matched
	// as a command name (see #25).
	let cmdIdx = -1;
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === undefined) continue;
		if (token === '--') {
			// End-of-flags marker: next token (if any) is the command name.
			if (i + 1 < argv.length) cmdIdx = i + 1;
			break;
		}
		if (token.startsWith('-')) {
			if (consumesFollowingToken(token, valueFlags)) i++; // skip the flag's value
			continue;
		}
		cmdIdx = i;
		break;
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

	// If command has subcommands, try to descend. The matched command's own
	// flags govern arity at the child level (e.g. `db --config x migrate`).
	if (matched.subcommands.size > 0) {
		const subResult = dispatch(
			remaining,
			matched.subcommands,
			currentPath,
			buildFlagLookup(matched.schema.flags, parseOptions),
			parseOptions,
		);

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

			default: {
				// Exhaustiveness guard — ensures all DispatchResult variants are handled.
				const _exhaustive: never = subResult;
				return _exhaustive;
			}
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

// --- Flag-arity awareness

/**
 * Whether a flag token consumes the following argv token as its value.
 *
 * Mirrors the parser's value-consumption rules (`parseLongFlag` /
 * `parseShortFlags`) so the command-name scan skips exactly the tokens the
 * parser would treat as flag values:
 * - `--flag value` → consumes when `--flag` is a known value-flag.
 * - `--flag=value` → self-contained, consumes nothing.
 * - `-abc value`   → consumes only when the trailing short flag is a value-flag;
 *   an earlier value-flag char takes the rest of the group as an inline value.
 *
 * Unknown flags conservatively consume nothing (the parser reports them later).
 *
 * @internal
 */
function consumesFollowingToken(token: string, valueFlags: ValueFlagLookup): boolean {
	if (token.startsWith('--')) {
		if (token.includes('=')) return false;
		const entry = valueFlags.get(token.slice(2));
		return entry !== undefined && flagExpectsValue(entry.schema);
	}

	// Short flag group (`-abc`). A value attaches to the trailing flag only; an
	// earlier value-flag char swallows the remaining chars as an inline value.
	const chars = token.slice(1);
	for (let i = 0; i < chars.length; i++) {
		const entry = valueFlags.get(chars.charAt(i));
		if (entry === undefined) return false;
		if (!flagExpectsValue(entry.schema)) continue;
		return i === chars.length - 1;
	}
	return false;
}

// --- "Did you mean?" suggestion

/**
 * Levenshtein distance between two strings.
 * @internal
 */
function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;

	// Flat (m+1)×(n+1) matrix — fully initialised, no sparse access.
	// Two-row rolling buffer: only the previous and current rows are needed.
	const w = n + 1;
	let prev = new Uint16Array(w);
	let curr = new Uint16Array(w);

	// Base row: distance from empty string to b[0..j]
	for (let j = 0; j <= n; j++) prev[j] = j;

	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
			// All indices are in-bounds: j ∈ [1,n], j-1 ∈ [0,n-1], both < w.
			// prev/curr are dense Uint16Arrays of length w — no holes.
			const del = prev[j] ?? 0;
			const ins = curr[j - 1] ?? 0;
			const sub = prev[j - 1] ?? 0;
			curr[j] = Math.min(del + 1, ins + 1, sub + cost);
		}
		[prev, curr] = [curr, prev];
	}

	// After the loop, `prev` holds the last computed row (swapped at loop end).
	return prev[n] ?? Math.max(m, n);
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

// --- Helpers

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

// --- Exports

export type {
	DispatchMatch,
	DispatchNeedsSubcommand,
	DispatchResult,
	DispatchUnknown,
	ValueFlagLookup,
};
export { consumesFollowingToken, dispatch, findClosestCommand, levenshtein, uniqueCommands };
