/**
 * Argv tokenization and parsing against command schemas.
 *
 * Two-phase design:
 *
 * 1. **Tokenize** — split raw argv into structured tokens (long flags, short
 *    flags, positionals, separator). Schema-agnostic.
 *
 * 2. **Parse** — walk tokens against a `CommandSchema` to produce typed raw
 *    values. Emits `ParseError` for unknown flags, type mismatches, missing
 *    values.
 *
 * @module dreamcli/core/parse
 */

import { ParseError } from '../errors/index.ts';
import type { ArgSchema, CommandArgEntry, CommandSchema, FlagSchema } from '../schema/index.ts';

// ---------------------------------------------------------------------------
// Tokenizer — schema-agnostic argv splitting
// ---------------------------------------------------------------------------

/**
 * Token discriminated union.
 *
 * The tokenizer produces these from raw argv strings. The parser then
 * interprets them against a command schema.
 */
type Token =
	| { readonly kind: 'long-flag'; readonly name: string; readonly value: string | undefined }
	| { readonly kind: 'short-flags'; readonly chars: string }
	| { readonly kind: 'positional'; readonly value: string }
	| { readonly kind: 'separator' };

/**
 * Tokenize raw argv into structured tokens.
 *
 * Low-level utility: most apps should use {@link parse}, `cli().run()`, or
 * `runCommand()` instead of tokenizing manually. Reach for `tokenize()` when
 * building custom tooling such as debuggers, inspectors, or parser tests.
 *
 * Rules:
 * - `--`        → separator (everything after is positional)
 * - `--flag`    → long flag, no inline value
 * - `--flag=v`  → long flag with inline value
 * - `-abc`      → short flags (expanded individually by parser)
 * - `-`         → positional (convention: stdin placeholder)
 * - everything else → positional
 *
 * @example
 * ```ts
 * tokenize(['deploy', '--force', '--region=eu', '-v']);
 * ```
 */
function tokenize(argv: readonly string[]): readonly Token[] {
	const tokens: Token[] = [];
	let pastSeparator = false;

	for (const raw of argv) {
		if (pastSeparator) {
			tokens.push({ kind: 'positional', value: raw });
			continue;
		}

		if (raw === '--') {
			tokens.push({ kind: 'separator' });
			pastSeparator = true;
			continue;
		}

		if (raw.startsWith('--')) {
			const eqIdx = raw.indexOf('=');
			if (eqIdx !== -1) {
				tokens.push({
					kind: 'long-flag',
					name: raw.slice(2, eqIdx),
					value: raw.slice(eqIdx + 1),
				});
			} else {
				tokens.push({ kind: 'long-flag', name: raw.slice(2), value: undefined });
			}
			continue;
		}

		// Single `-` is a positional (stdin convention), not a flag
		if (raw.startsWith('-') && raw.length > 1) {
			tokens.push({ kind: 'short-flags', chars: raw.slice(1) });
			continue;
		}

		tokens.push({ kind: 'positional', value: raw });
	}

	return tokens;
}

// ---------------------------------------------------------------------------
// Parse result
// ---------------------------------------------------------------------------

/**
 * Raw parsed values before resolution (defaults, env, config, etc.).
 *
 * Flag values are `unknown` because type coercion happens here but the
 * generic type info lives in the schema builders, not at runtime.
 */
interface ParseResult {
	/** Flag values keyed by canonical flag name. */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Positional arg values keyed by arg name. */
	readonly args: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Internal lookup helpers
// ---------------------------------------------------------------------------

/**
 * Build a map from flag name/alias → [canonicalName, FlagSchema].
 *
 * Supports both long names and single-char aliases for short flag expansion.
 */
function buildFlagLookup(
	flags: Readonly<Record<string, FlagSchema>>,
): ReadonlyMap<string, readonly [name: string, schema: FlagSchema]> {
	const lookup = new Map<string, readonly [string, FlagSchema]>();
	for (const [name, schema] of Object.entries(flags)) {
		lookup.set(name, [name, schema]);
		for (const alias of schema.aliases) {
			lookup.set(alias, [name, schema]);
		}
	}
	return lookup;
}

/** Whether a flag kind expects a value argument (vs. being a bare boolean). */
function flagExpectsValue(schema: FlagSchema): boolean {
	return schema.kind !== 'boolean';
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/**
 * Coerce a raw string to the flag's declared kind.
 *
 * @throws ParseError on type mismatch
 */
function coerceFlagValue(flagName: string, raw: string, schema: FlagSchema): unknown {
	switch (schema.kind) {
		case 'string':
			return raw;

		case 'number': {
			const n = Number(raw);
			if (Number.isNaN(n)) {
				throw new ParseError(`Invalid number value '${raw}' for flag --${flagName}`, {
					code: 'INVALID_VALUE',
					details: { flag: flagName, value: raw, expected: 'number' },
				});
			}
			return n;
		}

		case 'boolean':
			// Explicit boolean values: --flag=true / --flag=false
			if (raw === 'true' || raw === '1') return true;
			if (raw === 'false' || raw === '0') return false;
			throw new ParseError(
				`Invalid boolean value '${raw}' for flag --${flagName}. Use true/false or 1/0`,
				{
					code: 'INVALID_VALUE',
					details: { flag: flagName, value: raw, expected: 'boolean' },
				},
			);

		case 'enum': {
			const allowed = schema.enumValues ?? [];
			if (!allowed.includes(raw)) {
				throw new ParseError(
					`Invalid value '${raw}' for flag --${flagName}. Allowed: ${allowed.join(', ')}`,
					{
						code: 'INVALID_VALUE',
						details: { flag: flagName, value: raw, allowed },
					},
				);
			}
			return raw;
		}

		case 'array':
			// Array element — coerce via element schema if present
			if (schema.elementSchema) {
				return coerceFlagValue(flagName, raw, schema.elementSchema);
			}
			return raw;

		case 'custom': {
			if (!schema.parseFn) {
				return raw;
			}
			try {
				return schema.parseFn(raw);
			} catch (err) {
				if (err instanceof ParseError) throw err;
				const message = err instanceof Error ? err.message : String(err);
				throw new ParseError(`Failed to parse flag --${flagName}: ${message}`, {
					code: 'INVALID_VALUE',
					details: { flag: flagName, value: raw },
					cause: err,
				});
			}
		}
	}
}

/**
 * Coerce a raw string to the arg's declared kind.
 *
 * @throws ParseError on type mismatch or custom parse failure
 */
function coerceArgValue(argName: string, raw: string, schema: ArgSchema): unknown {
	switch (schema.kind) {
		case 'string':
			return raw;

		case 'number': {
			const n = Number(raw);
			if (Number.isNaN(n)) {
				throw new ParseError(`Invalid number value '${raw}' for argument <${argName}>`, {
					code: 'INVALID_VALUE',
					details: { arg: argName, value: raw, expected: 'number' },
				});
			}
			return n;
		}

		case 'enum': {
			const allowed = schema.enumValues ?? [];
			if (!allowed.includes(raw)) {
				throw new ParseError(
					`Invalid value '${raw}' for argument <${argName}>. Allowed: ${allowed.join(', ')}`,
					{
						code: 'INVALID_VALUE',
						details: { arg: argName, value: raw, allowed },
					},
				);
			}
			return raw;
		}

		case 'custom': {
			if (!schema.parseFn) {
				return raw;
			}
			try {
				return schema.parseFn(raw);
			} catch (err) {
				if (err instanceof ParseError) throw err;
				const message = err instanceof Error ? err.message : String(err);
				throw new ParseError(`Failed to parse argument <${argName}>: ${message}`, {
					code: 'INVALID_VALUE',
					details: { arg: argName, value: raw },
					cause: err,
				});
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Parser — schema-aware token interpretation
// ---------------------------------------------------------------------------

/**
 * Parse tokenized argv against a command schema.
 *
 * Low-level API: most apps should let `cli()` or `runCommand()` handle parsing
 * automatically. Call `parse()` directly when you need raw parsed values before
 * env/config/default resolution or when writing custom tooling around schemas.
 *
 * @param schema - The command schema to parse against
 * @param argv   - Raw argv strings (NOT including the command name itself)
 * @returns Parsed flag and arg values
 * @throws ParseError for unknown flags, missing values, type mismatches
 *
 * @example
 * ```ts
 * const parsed = parse(deploy.schema, ['production', '--force']);
 * // => { args: { target: 'production' }, flags: { force: true } }
 * ```
 */
function parse(schema: CommandSchema, argv: readonly string[]): ParseResult {
	const tokens = tokenize(argv);
	const flagLookup = buildFlagLookup(schema.flags);

	// Mutable accumulators — frozen in the result
	const flags: Record<string, unknown> = {};
	const positionals: string[] = [];

	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i];
		if (token === undefined) break; // unreachable — loop guard ensures i < length

		if (token.kind === 'separator') {
			i++;
			continue;
		}

		if (token.kind === 'positional') {
			positionals.push(token.value);
			i++;
			continue;
		}

		if (token.kind === 'long-flag') {
			i = parseLongFlag(token, tokens, i, flagLookup, flags);
			continue;
		}

		// token.kind === 'short-flags'
		i = parseShortFlags(token, tokens, i, flagLookup, flags);
	}

	// Map positionals to named args
	const args = mapPositionals(schema.args, positionals);

	return { flags, args };
}

// ---------------------------------------------------------------------------
// Long flag parsing
// ---------------------------------------------------------------------------

/** Parse a long flag token, consuming a value from the next token if needed. */
function parseLongFlag(
	token: { readonly kind: 'long-flag'; readonly name: string; readonly value: string | undefined },
	tokens: readonly Token[],
	startIdx: number,
	flagLookup: ReadonlyMap<string, readonly [string, FlagSchema]>,
	flags: Record<string, unknown>,
): number {
	const entry = flagLookup.get(token.name);
	if (!entry) {
		const suggestion = suggestFlag(token.name, flagLookup);
		throw new ParseError(
			`Unknown flag --${token.name}${suggestion ? `. Did you mean --${suggestion}?` : ''}`,
			{
				code: 'UNKNOWN_FLAG',
				details: { flag: token.name, ...(suggestion ? { suggestion } : {}) },
				...(suggestion ? { suggest: `--${suggestion}` } : {}),
			},
		);
	}

	const [canonicalName, flagSchema] = entry;

	if (!flagExpectsValue(flagSchema)) {
		// Boolean flag
		if (token.value !== undefined) {
			flags[canonicalName] = coerceFlagValue(canonicalName, token.value, flagSchema);
		} else {
			flags[canonicalName] = true;
		}
		return startIdx + 1;
	}

	if (token.value !== undefined) {
		// --flag=value (inline)
		setFlagValue(flags, canonicalName, flagSchema, token.value);
		return startIdx + 1;
	}

	// --flag value (next token is the value)
	const nextToken = tokens[startIdx + 1];
	if (!nextToken || nextToken.kind !== 'positional') {
		throw new ParseError(`Flag --${canonicalName} requires a value`, {
			code: 'MISSING_VALUE',
			details: { flag: canonicalName, kind: flagSchema.kind },
		});
	}
	setFlagValue(flags, canonicalName, flagSchema, nextToken.value);
	return startIdx + 2;
}

// ---------------------------------------------------------------------------
// Short flag parsing
// ---------------------------------------------------------------------------

/** Parse combined short flags, expanding -abc into individual flags. */
function parseShortFlags(
	token: { readonly kind: 'short-flags'; readonly chars: string },
	tokens: readonly Token[],
	startIdx: number,
	flagLookup: ReadonlyMap<string, readonly [string, FlagSchema]>,
	flags: Record<string, unknown>,
): number {
	const { chars } = token;
	let nextIdx = startIdx + 1;

	for (let ci = 0; ci < chars.length; ci++) {
		const ch = chars.charAt(ci);
		const entry = flagLookup.get(ch);
		if (!entry) {
			throw new ParseError(`Unknown flag -${ch}`, {
				code: 'UNKNOWN_FLAG',
				details: { flag: ch },
			});
		}

		const [canonicalName, flagSchema] = entry;

		if (!flagExpectsValue(flagSchema)) {
			// Boolean short flag
			flags[canonicalName] = true;
			continue;
		}

		if (ci < chars.length - 1) {
			// Value-expecting flag in the middle of combined shorts:
			// -oFile → -o with value "File" (rest of chars is the value)
			const inlineValue = chars.slice(ci + 1);
			setFlagValue(flags, canonicalName, flagSchema, inlineValue);
			break; // consumed all remaining chars
		}

		// Last char in the group — consume next token as value
		const nextToken = tokens[nextIdx];
		if (!nextToken || nextToken.kind !== 'positional') {
			throw new ParseError(`Flag -${ch} requires a value`, {
				code: 'MISSING_VALUE',
				details: { flag: ch, canonical: canonicalName, kind: flagSchema.kind },
			});
		}
		setFlagValue(flags, canonicalName, flagSchema, nextToken.value);
		nextIdx++;
	}

	return nextIdx;
}

// ---------------------------------------------------------------------------
// Flag value setter (handles array accumulation)
// ---------------------------------------------------------------------------

/** Set or accumulate a flag value, handling array flags specially. */
function setFlagValue(
	flags: Record<string, unknown>,
	name: string,
	schema: FlagSchema,
	rawValue: string,
): void {
	const coerced = coerceFlagValue(name, rawValue, schema);

	if (schema.kind === 'array') {
		const existing = flags[name];
		if (Array.isArray(existing)) {
			existing.push(coerced);
		} else {
			flags[name] = [coerced];
		}
	} else {
		flags[name] = coerced;
	}
}

// ---------------------------------------------------------------------------
// Positional arg mapping
// ---------------------------------------------------------------------------

/**
 * Map positional values to named args based on schema ordering.
 *
 * @throws ParseError if too many positionals and no variadic arg absorbs them
 */
function mapPositionals(
	argEntries: readonly CommandArgEntry[],
	positionals: readonly string[],
): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	let posIdx = 0;

	for (const entry of argEntries) {
		if (entry.schema.variadic) {
			// Variadic arg consumes all remaining positionals
			const remaining = positionals.slice(posIdx);
			args[entry.name] = remaining.map((raw) => coerceArgValue(entry.name, raw, entry.schema));
			posIdx = positionals.length;
			break;
		}

		const rawPositional = positionals[posIdx];
		if (rawPositional !== undefined) {
			args[entry.name] = coerceArgValue(entry.name, rawPositional, entry.schema);
			posIdx++;
		}
		// If no positional available, leave absent (resolution/validation handles defaults/required)
	}

	// Check for excess positionals
	if (posIdx < positionals.length) {
		const excess = positionals.slice(posIdx);
		throw new ParseError(
			`Unexpected positional argument${excess.length > 1 ? 's' : ''}: ${excess.join(', ')}`,
			{
				code: 'UNEXPECTED_POSITIONAL',
				details: { excess, expected: argEntries.length },
			},
		);
	}

	return args;
}

// ---------------------------------------------------------------------------
// Suggestion helper (Levenshtein-based "did you mean?")
// ---------------------------------------------------------------------------

/**
 * Suggest the closest flag name if the edit distance is small enough.
 *
 * Returns `undefined` if no close match exists.
 */
function suggestFlag(
	input: string,
	lookup: ReadonlyMap<string, readonly [string, FlagSchema]>,
): string | undefined {
	let bestName: string | undefined;
	let bestDist = Number.POSITIVE_INFINITY;
	const threshold = Math.max(2, Math.floor(input.length / 2));

	for (const key of lookup.keys()) {
		// Only suggest long names (not single-char aliases)
		if (key.length < 2) continue;

		const dist = levenshtein(input, key);
		if (dist < bestDist && dist <= threshold) {
			bestDist = dist;
			bestName = key;
		}
	}

	return bestName;
}

/**
 * Classic Levenshtein distance using a single-row DP approach.
 */
function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	// Ensure `short` is the shorter string for the single-row optimisation
	const short = a.length <= b.length ? a : b;
	const long = a.length <= b.length ? b : a;

	const aLen = short.length;
	const bLen = long.length;

	// Previous row of distances
	const row = new Array<number>(aLen + 1);
	for (let i = 0; i <= aLen; i++) row[i] = i;

	for (let j = 1; j <= bLen; j++) {
		let prev = row[0] ?? 0;
		row[0] = j;
		for (let k = 1; k <= aLen; k++) {
			const cost = short.charAt(k - 1) === long.charAt(j - 1) ? 0 : 1;
			const current = Math.min(
				(row[k] ?? 0) + 1, // deletion
				(row[k - 1] ?? 0) + 1, // insertion
				prev + cost, // substitution
			);
			prev = row[k] ?? 0;
			row[k] = current;
		}
	}

	return row[aLen] ?? 0;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { ParseResult, Token };
export { parse, tokenize };
