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

import {
	adjacentArgvValue,
	isHyphenOperand,
	removeArgvToken,
} from '#internals/core/parse/argv-boundaries.ts';
import type { FlagLookupEntry, ParseOptions } from '#internals/core/parse/index.ts';
import {
	buildFlagLookup,
	consumesSeparateBoolean,
	flagExpectsValue,
	followingValueFlag,
	variadicLongValueCount,
} from '#internals/core/parse/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import type { CompiledCommand } from './compiled.ts';
import { collectPropagatedFlagEntries } from './propagate.ts';

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
	readonly command: CompiledCommand;
	/** Root → target (inclusive). Used for `collectPropagatedFlags()`. */
	readonly commandPath: readonly CommandSchema[];
	/** argv after consuming command name segments. */
	readonly remainingArgv: readonly string[];
}

/** Target has subcommands but no handler and no subcommand was specified/matched. */
interface DispatchNeedsSubcommand {
	/** Arguments after removing the matched command names. */
	readonly remainingArgv: readonly string[];
	/** Discriminant — command group reached without a subcommand or handler. */
	readonly kind: 'needs-subcommand';
	/** The group command that needs a subcommand. */
	readonly command: CompiledCommand;
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
	readonly candidates: readonly CompiledCommand[];
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
	commands: ReadonlyMap<string, CompiledCommand>,
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
		if (token === undefined || isHyphenOperand(argv, i)) continue;
		if (token === '--') {
			// End-of-flags marker: next token (if any) is the command name.
			if (i + 1 < argv.length) cmdIdx = i + 1;
			break;
		}
		if (token.startsWith('-')) {
			i += followingDispatchValueCount(argv, i, token, valueFlags);
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
	const remaining = removeArgvToken(argv, cmdIdx);
	const currentPath = [...ancestorPath, matched.schema];

	// At the child level, arity follows the group's effective flags.
	if (matched.subcommands.size > 0) {
		const inherited = collectPropagatedFlagEntries(currentPath);
		const flags =
			inherited.size === 0
				? matched.schema.flags
				: { ...Object.fromEntries(inherited), ...matched.schema.flags };
		const subResult = dispatch(
			remaining,
			matched.subcommands,
			currentPath,
			buildFlagLookup(flags, parseOptions),
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
					return {
						kind: 'needs-subcommand',
						command: matched,
						commandPath: currentPath,
						remainingArgv: remaining,
					};
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
function consumesFollowingToken(
	token: string,
	valueFlags: ValueFlagLookup,
	next?: string,
): boolean {
	const entry = followingValueFlag(token, valueFlags);
	return (
		entry !== undefined && (flagExpectsValue(entry.schema) || consumesSeparateBoolean(entry, next))
	);
}

/** Count operands that can affect which positional token dispatch sees next. */
function followingDispatchValueCount(
	argv: readonly string[],
	index: number,
	token: string,
	valueFlags: ValueFlagLookup | undefined,
): number {
	if (valueFlags === undefined) return 0;
	if (token.startsWith('--')) {
		const equals = token.indexOf('=');
		const name = token.slice(2, equals === -1 ? undefined : equals);
		if (valueFlags.get(name)?.schema.variadic === true) {
			if (isHyphenOperand(argv, index + 1)) {
				return 1 + variadicLongValueCount(argv, index + 1, valueFlags, true);
			}
			return variadicLongValueCount(argv, index, valueFlags, equals !== -1);
		}
	}
	return consumesFollowingToken(token, valueFlags, adjacentArgvValue(argv, index)) ? 1 : 0;
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
function findClosestCommand(
	input: string,
	commands: readonly CompiledCommand[],
): string | undefined {
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
function uniqueCommands(
	commands: ReadonlyMap<string, CompiledCommand>,
): readonly CompiledCommand[] {
	const seen = new Set<CompiledCommand>();
	const result: CompiledCommand[] = [];
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
export {
	consumesFollowingToken,
	dispatch,
	findClosestCommand,
	followingDispatchValueCount,
	levenshtein,
	uniqueCommands,
};
