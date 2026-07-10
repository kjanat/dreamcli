/**
 * Argv tokenization and parsing against command schemas.
 *
 * Two-phase design:
 *
 * 1. **Tokenize** — split raw argv into structured tokens (long flags, short
 *    flags, positionals, separator). Schema-agnostic.
 *
 * 2. **Parse** — walk tokens against a {@linkcode CommandSchema} to produce typed raw
 *    values. Emits {@linkcode ParseError} for unknown flags, type mismatches, missing
 *    values.
 *
 * @module dreamcli/core/parse
 */

import { ParseError } from '#internals/core/errors/index.ts';
import { getFlagAliasNames, getFlagNegatedName } from '#internals/core/schema/flag.ts';
import type {
	ArgSchema,
	CommandArgEntry,
	CommandSchema,
	FlagSchema,
} from '#internals/core/schema/index.ts';
import {
	describeNumberConstraintViolation,
	describeStringConstraintViolation,
	validateNumberConstraints,
	validateStringConstraints,
} from '#internals/core/schema/index.ts';

// --- Tokenizer — schema-agnostic argv splitting

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
 * @param argv - Raw argument strings to tokenize
 * @returns Ordered token array ready for {@link parse}
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

/**
 * Whether `token` appears in argv before the `--` end-of-options separator.
 *
 * Everything at or after the first `--` is a literal positional, so root-level
 * flag interception (`--help` / `--version` / `--json`) must use this instead of
 * a naive `Array.includes()` — otherwise a post-separator literal (`-- --json`)
 * is wrongly treated as the flag.
 *
 * @param argv - Raw argument strings.
 * @param token - Exact flag token to look for (e.g. `--version`).
 * @returns `true` if `token` occurs before any `--` separator.
 */
function includesBeforeSeparator(argv: readonly string[], token: string): boolean {
	for (const arg of argv) {
		if (arg === '--') return false;
		if (arg === token) return true;
	}
	return false;
}

/**
 * Remove every occurrence of `token` that appears before the `--` end-of-options
 * separator, leaving post-separator literals untouched.
 *
 * The strip counterpart to {@linkcode includesBeforeSeparator}: root-level flags
 * (`--json`) are stripped before dispatch/parse so the command schema never sees
 * them, but a literal after `--` (`-- --json`) must reach the command unchanged.
 *
 * @param argv - Raw argument strings.
 * @param token - Exact flag token to strip (e.g. `--json`).
 * @returns A new argv with pre-separator occurrences of `token` removed, or the
 *   original reference when `token` does not occur before the separator.
 */
function stripBeforeSeparator(argv: readonly string[], token: string): readonly string[] {
	const separatorIndex = argv.indexOf('--');
	const head = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
	if (!head.includes(token)) return argv;
	const filteredHead = head.filter((arg) => arg !== token);
	return separatorIndex === -1 ? filteredHead : [...filteredHead, ...argv.slice(separatorIndex)];
}

// --- Parse result

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

/** Options accepted by {@link parse} and {@link buildFlagLookup}. */
interface ParseOptions {
	/**
	 * Accept the kebab↔camel counterpart spelling of each flag name/alias
	 * (`--doThis` for a flag named `do-this`, and vice versa). Automatically
	 * disabled per spelling pair when a command explicitly defines both.
	 *
	 * @defaultValue `true`
	 */
	readonly caseParity?: boolean;
}

// --- Flag-name case conversion (kebab↔camel parity)

/** `do-this` → `doThis`. Returns the input unchanged when nothing converts. */
function kebabToCamel(name: string): string {
	return name.replace(/-+([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** `doThis` → `do-this`. Returns the input unchanged when nothing converts. */
function camelToKebab(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * The kebab↔camel counterpart spelling of a flag name, or `undefined` when
 * the name has none (single-char aliases, single lowercase words).
 */
function counterpartSpelling(name: string): string | undefined {
	if (name.length < 2) return undefined;
	if (name.includes('-')) {
		const camel = kebabToCamel(name);
		return camel !== name ? camel : undefined;
	}
	const kebab = camelToKebab(name);
	return kebab !== name ? kebab : undefined;
}

// --- Internal lookup helpers

/** One resolvable spelling in the flag lookup map. */
interface FlagLookupEntry {
	/** Canonical flag name (the key in the command's flag record). */
	readonly name: string;
	/** The flag's schema. */
	readonly schema: FlagSchema;
	/** This spelling is the flag's negated form (`--no-foo`) — parses to `false`. */
	readonly negated: boolean;
	/** This spelling is a case-parity counterpart, not a declared spelling. */
	readonly parity: boolean;
}

/**
 * Build a map from flag spelling → {@link FlagLookupEntry}.
 *
 * Covers canonical names, aliases (long + single-char), negated spellings of
 * `.negatable()` booleans, and — unless `caseParity` is `false` — the
 * kebab↔camel counterpart of every declared spelling. Counterparts never
 * override declared spellings: when a command defines both `do-this` and
 * `doThis` explicitly, each spelling exact-matches its own flag and no
 * parity entries are added for the pair.
 *
 * @param flags - Flag schemas keyed by canonical name
 * @param options - Parity toggle (see {@link ParseOptions})
 * @returns Lookup map covering all resolvable spellings
 */
function buildFlagLookup(
	flags: Readonly<Record<string, FlagSchema>>,
	options?: ParseOptions,
): ReadonlyMap<string, FlagLookupEntry> {
	const lookup = new Map<string, FlagLookupEntry>();

	// Pass 1: declared spellings — canonical names, aliases, negated forms.
	for (const [name, schema] of Object.entries(flags)) {
		lookup.set(name, { name, schema, negated: false, parity: false });
		for (const alias of getFlagAliasNames(schema, { includeHidden: true })) {
			lookup.set(alias, { name, schema, negated: false, parity: false });
		}
		const negatedName = getFlagNegatedName(name, schema);
		if (negatedName !== undefined) {
			lookup.set(negatedName, { name, schema, negated: true, parity: false });
		}
	}

	// Pass 2: case-parity counterparts. Runs after ALL declared spellings are
	// registered so an explicitly declared counterpart always wins (per-pair
	// auto-optout).
	if (options?.caseParity !== false) {
		for (const [spelling, entry] of [...lookup]) {
			const counterpart = counterpartSpelling(spelling);
			if (counterpart !== undefined && !lookup.has(counterpart)) {
				lookup.set(counterpart, { ...entry, parity: true });
			}
		}
	}

	return lookup;
}

// --- Duplicate-occurrence tracking

/** Mutable per-parse record of CLI occurrences for one logical flag. */
interface FlagOccurrences {
	count: number;
	readonly values: unknown[];
}

/**
 * Record one CLI occurrence of a logical flag and enforce its duplicate
 * policy.
 *
 * @param occurrences - Per-parse accumulator keyed by canonical name
 * @param name - Canonical flag name
 * @param schema - Flag schema (read for {@link FlagSchema.duplicates})
 * @param value - The occurrence's raw value (or the boolean it implies)
 * @param displayName - User-facing spelling for error messages
 * @returns `true` when the occurrence should be applied; `false` when the
 *   `'first'` policy suppresses it (the token is still consumed)
 * @throws ParseError `DUPLICATE_FLAG` on a repeat under the `'error'` policy
 */
function recordFlagOccurrence(
	occurrences: Map<string, FlagOccurrences>,
	name: string,
	schema: FlagSchema,
	value: unknown,
	displayName: string,
): boolean {
	const record = occurrences.get(name) ?? { count: 0, values: [] };
	record.count += 1;
	record.values.push(value);
	occurrences.set(name, record);

	if (record.count === 1) return true;
	if (schema.duplicates === 'error') {
		throw new ParseError(`Flag --${name} may only be specified once`, {
			code: 'DUPLICATE_FLAG',
			details: {
				flag: name,
				input: displayName,
				count: record.count,
				values: [...record.values],
			},
		});
	}
	return schema.duplicates !== 'first';
}

/**
 * Whether a flag kind expects a value argument (vs. being a bare boolean).
 *
 * @param schema - Flag schema to check
 * @returns `true` if the flag expects a value token after it
 */
function flagExpectsValue(schema: FlagSchema): boolean {
	return schema.kind !== 'boolean' && schema.kind !== 'count';
}

// --- Value coercion

/**
 * Coerce a raw string to the flag's declared kind.
 *
 * @param flagName - Canonical flag name (for error messages)
 * @param raw - Raw string value from argv
 * @param schema - {@link FlagSchema} declaring the expected kind
 * @returns Coerced value matching the schema's kind
 * @throws ParseError on type mismatch
 */
function coerceFlagValue(
	flagName: string,
	raw: string,
	schema: FlagSchema,
	displayName = `--${flagName}`,
): unknown {
	switch (schema.kind) {
		case 'string': {
			const violation = validateStringConstraints(raw, schema.stringConstraints);
			if (violation !== undefined) {
				const reason = describeStringConstraintViolation(violation);
				throw new ParseError(`Invalid value '${raw}' for flag ${displayName}: ${reason}`, {
					code: 'INVALID_VALUE',
					details: {
						flag: flagName,
						input: displayName,
						value: raw,
						expected: 'string',
						constraint: violation.kind,
						...('bound' in violation ? { bound: violation.bound } : {}),
						...('pattern' in violation ? { pattern: violation.pattern } : {}),
					},
				});
			}
			return raw;
		}

		case 'number': {
			const n = Number(raw);
			if (Number.isNaN(n)) {
				throw new ParseError(`Invalid number value '${raw}' for flag ${displayName}`, {
					code: 'INVALID_VALUE',
					details: { flag: flagName, input: displayName, value: raw, expected: 'number' },
				});
			}
			const violation = validateNumberConstraints(n, schema.numberConstraints);
			if (violation !== undefined) {
				const reason = describeNumberConstraintViolation(violation);
				throw new ParseError(`Invalid number value '${raw}' for flag ${displayName}: ${reason}`, {
					code: 'INVALID_VALUE',
					details: {
						flag: flagName,
						input: displayName,
						value: raw,
						expected: 'number',
						constraint: violation.kind,
						...('bound' in violation ? { bound: violation.bound } : {}),
					},
				});
			}
			return n;
		}

		case 'boolean':
			// Explicit boolean values: --flag=true / --flag=false
			if (raw === 'true' || raw === '1') return true;
			if (raw === 'false' || raw === '0') return false;
			throw new ParseError(
				`Invalid boolean value '${raw}' for flag ${displayName}. Use true/false or 1/0`,
				{
					code: 'INVALID_VALUE',
					details: { flag: flagName, input: displayName, value: raw, expected: 'boolean' },
				},
			);

		case 'enum': {
			const allowed = schema.enumValues;
			if (allowed === undefined) {
				throw new ParseError(
					`Enum flag --${flagName} is misconfigured: no allowed values declared`,
					{
						code: 'INVALID_SCHEMA',
						details: { flag: flagName, kind: 'enum', missing: 'enumValues' },
					},
				);
			}
			if (!allowed.includes(raw)) {
				throw new ParseError(
					`Invalid value '${raw}' for flag ${displayName}. Allowed: ${allowed.join(', ')}`,
					{
						code: 'INVALID_VALUE',
						details: { flag: flagName, input: displayName, value: raw, allowed },
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
				throw new ParseError(`Failed to parse flag ${displayName}: ${message}`, {
					code: 'INVALID_VALUE',
					details: { flag: flagName, input: displayName, value: raw },
					cause: err,
				});
			}
		}

		case 'count': {
			// Explicit count values: --verbose=2. Reject '' explicitly —
			// Number('') is 0, which would silently accept `--verbose=`.
			const n = raw.trim() === '' ? Number.NaN : Number(raw);
			if (!Number.isInteger(n) || n < 0) {
				throw new ParseError(
					`Invalid count value '${raw}' for flag ${displayName}. Use a non-negative integer`,
					{
						code: 'INVALID_VALUE',
						details: { flag: flagName, input: displayName, value: raw, expected: 'count' },
					},
				);
			}
			return n;
		}

		case 'keyValue':
			// Split at the FIRST '=' so values may contain '=' themselves.
			return parseKeyValuePair(flagName, raw, displayName);
	}
}

/**
 * Coerce a raw string to the arg's declared kind.
 *
 * @param argName - Positional arg name (for error messages)
 * @param raw - Raw string value from argv
 * @param schema - {@link ArgSchema} declaring the expected kind
 * @returns Coerced value matching the schema's kind
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
			const violation = validateNumberConstraints(n, schema.numberConstraints);
			if (violation !== undefined) {
				const reason = describeNumberConstraintViolation(violation);
				throw new ParseError(`Invalid number value '${raw}' for argument <${argName}>: ${reason}`, {
					code: 'INVALID_VALUE',
					details: {
						arg: argName,
						value: raw,
						expected: 'number',
						constraint: violation.kind,
						...('bound' in violation ? { bound: violation.bound } : {}),
					},
				});
			}
			return n;
		}

		case 'enum': {
			const allowed = schema.enumValues;
			if (allowed === undefined) {
				throw new ParseError(
					`Enum argument <${argName}> is misconfigured: no allowed values declared`,
					{
						code: 'INVALID_SCHEMA',
						details: { arg: argName, kind: 'enum', missing: 'enumValues' },
					},
				);
			}
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

// --- Parser — schema-aware token interpretation

/**
 * Parse tokenized argv against a command schema.
 *
 * Low-level API: most apps should let `cli()` or `runCommand()` handle parsing
 * automatically. Call `parse()` directly when you need raw parsed values before
 * env/config/default resolution or when writing custom tooling around schemas.
 *
 * @param schema - The command schema to parse against
 * @param argv   - Raw argv strings (NOT including the command name itself)
 * @param options - Parser behavior toggles (see {@link ParseOptions})
 * @returns Parsed flag and arg values
 * @throws ParseError for unknown flags, missing values, type mismatches
 *
 * @example
 * ```ts
 * const parsed = parse(deploy.schema, ['production', '--force']);
 * // => { args: { target: 'production' }, flags: { force: true } }
 * ```
 */
function parse(
	schema: CommandSchema,
	argv: readonly string[],
	options?: ParseOptions,
): ParseResult {
	const tokens = tokenize(argv);
	const flagLookup = buildFlagLookup(schema.flags, options);

	// Mutable accumulators — frozen in the result
	const flags: Record<string, unknown> = {};
	const positionals: string[] = [];
	const occurrences = new Map<string, FlagOccurrences>();

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
			i = parseLongFlag(token, tokens, i, flagLookup, flags, occurrences);
			continue;
		}

		// token.kind === 'short-flags'
		i = parseShortFlags(token, tokens, i, flagLookup, flags, occurrences);
	}

	// Map positionals to named args
	const args = mapPositionals(schema.args, positionals);

	return { flags, args };
}

// --- Long flag parsing

/**
 * Parse a long flag token, consuming a value from the next token if needed.
 *
 * @param token - Long-flag token to process
 * @param tokens - Full token array (for lookahead)
 * @param startIdx - Current index of `token` in the array
 * @param flagLookup - Spelling → {@link FlagLookupEntry} map from {@link buildFlagLookup}
 * @param flags - Mutable accumulator for resolved flag values
 * @param occurrences - Per-parse duplicate-occurrence accumulator
 * @returns Next index to continue parsing from
 */
function parseLongFlag(
	token: { readonly kind: 'long-flag'; readonly name: string; readonly value: string | undefined },
	tokens: readonly Token[],
	startIdx: number,
	flagLookup: ReadonlyMap<string, FlagLookupEntry>,
	flags: Record<string, unknown>,
	occurrences: Map<string, FlagOccurrences>,
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

	const { name: canonicalName, schema: flagSchema, negated } = entry;
	const displayName = `--${token.name}`;

	if (negated) {
		// Negated spelling is presence-only: it always means `false`.
		if (token.value !== undefined) {
			throw new ParseError(`Flag ${displayName} does not take a value`, {
				code: 'INVALID_VALUE',
				details: { flag: canonicalName, input: token.name, value: token.value },
			});
		}
		if (recordFlagOccurrence(occurrences, canonicalName, flagSchema, false, displayName)) {
			flags[canonicalName] = false;
		}
		return startIdx + 1;
	}

	if (!flagExpectsValue(flagSchema)) {
		// Boolean or count flag — consumes no value token
		if (token.value !== undefined) {
			const coerced = coerceFlagValue(canonicalName, token.value, flagSchema, displayName);
			if (recordFlagOccurrence(occurrences, canonicalName, flagSchema, coerced, displayName)) {
				flags[canonicalName] = coerced;
			}
		} else if (flagSchema.kind === 'count') {
			const existing = flags[canonicalName];
			flags[canonicalName] = (typeof existing === 'number' ? existing : 0) + 1;
		} else if (recordFlagOccurrence(occurrences, canonicalName, flagSchema, true, displayName)) {
			flags[canonicalName] = true;
		}
		return startIdx + 1;
	}

	if (token.value !== undefined) {
		// --flag=value (inline)
		if (recordFlagOccurrence(occurrences, canonicalName, flagSchema, token.value, displayName)) {
			setFlagValue(flags, canonicalName, flagSchema, token.value);
		}
		return startIdx + 1;
	}

	// --flag value (next token is the value)
	const nextToken = tokens[startIdx + 1];
	if (nextToken?.kind !== 'positional') {
		throw new ParseError(`Flag ${displayName} requires a value`, {
			code: 'MISSING_VALUE',
			details: { flag: canonicalName, input: token.name, kind: flagSchema.kind },
		});
	}
	if (recordFlagOccurrence(occurrences, canonicalName, flagSchema, nextToken.value, displayName)) {
		setFlagValue(flags, canonicalName, flagSchema, nextToken.value, displayName);
	}
	return startIdx + 2;
}

// --- Short flag parsing

/**
 * Parse combined short flags, expanding -abc into individual flags.
 *
 * @param token - Short-flags token to expand
 * @param tokens - Full token array (for lookahead)
 * @param startIdx - Current index of `token` in the array
 * @param flagLookup - Spelling → {@link FlagLookupEntry} map from {@link buildFlagLookup}
 * @param flags - Mutable accumulator for resolved flag values
 * @param occurrences - Per-parse duplicate-occurrence accumulator
 * @returns Next index to continue parsing from
 */
function parseShortFlags(
	token: { readonly kind: 'short-flags'; readonly chars: string },
	tokens: readonly Token[],
	startIdx: number,
	flagLookup: ReadonlyMap<string, FlagLookupEntry>,
	flags: Record<string, unknown>,
	occurrences: Map<string, FlagOccurrences>,
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

		const { name: canonicalName, schema: flagSchema } = entry;
		const displayName = `-${ch}`;

		if (!flagExpectsValue(flagSchema)) {
			// Boolean or count short flag — consumes no value
			if (flagSchema.kind === 'count') {
				const existing = flags[canonicalName];
				flags[canonicalName] = (typeof existing === 'number' ? existing : 0) + 1;
			} else if (recordFlagOccurrence(occurrences, canonicalName, flagSchema, true, displayName)) {
				flags[canonicalName] = true;
			}
			continue;
		}

		if (ci < chars.length - 1) {
			// Value-expecting flag in the middle of combined shorts:
			// -oFile → -o with value "File" (rest of chars is the value)
			const inlineValue = chars.slice(ci + 1);
			if (recordFlagOccurrence(occurrences, canonicalName, flagSchema, inlineValue, displayName)) {
				setFlagValue(flags, canonicalName, flagSchema, inlineValue, displayName);
			}
			break; // consumed all remaining chars
		}

		// Last char in the group — consume next token as value
		const nextToken = tokens[nextIdx];
		if (nextToken?.kind !== 'positional') {
			throw new ParseError(`Flag -${ch} requires a value`, {
				code: 'MISSING_VALUE',
				details: { flag: canonicalName, input: ch, kind: flagSchema.kind },
			});
		}
		if (
			recordFlagOccurrence(occurrences, canonicalName, flagSchema, nextToken.value, displayName)
		) {
			setFlagValue(flags, canonicalName, flagSchema, nextToken.value, displayName);
		}
		nextIdx++;
	}

	return nextIdx;
}

// --- Flag value setter (handles array accumulation)

/**
 * Set or accumulate a flag value, handling array flags specially.
 *
 * @param flags - Mutable accumulator for resolved flag values
 * @param name - Canonical flag name
 * @param schema - {@link FlagSchema} declaring the expected kind
 * @param rawValue - Raw string value from argv
 */
function setFlagValue(
	flags: Record<string, unknown>,
	name: string,
	schema: FlagSchema,
	rawValue: string,
	displayName = `--${name}`,
): void {
	if (schema.kind === 'array') {
		// With a separator, one occurrence may carry several elements
		// (--tag a,b); each element is coerced individually so errors name
		// the offending element, not the whole token.
		const parts = schema.separator !== undefined ? rawValue.split(schema.separator) : [rawValue];
		const coercedParts = parts
			.filter((part) => schema.separator === undefined || part.length > 0)
			.map((part) => coerceFlagValue(name, part, schema, displayName));
		const existing = flags[name];
		if (Array.isArray(existing)) {
			existing.push(...coercedParts);
		} else {
			flags[name] = coercedParts;
		}
		return;
	}

	if (schema.kind === 'keyValue') {
		const pair = parseKeyValuePair(name, rawValue, displayName);
		const existing = flags[name];
		// Object.fromEntries defines own data properties, so keys like
		// '__proto__' are stored verbatim instead of being silently eaten by
		// the prototype setter.
		flags[name] = Object.fromEntries([
			...(isPlainRecord(existing) ? Object.entries(existing) : []),
			pair,
		]);
		return;
	}

	flags[name] = coerceFlagValue(name, rawValue, schema, displayName);
}

/** Narrow to a mutable string-record accumulator (keyValue flags only ever store these). */
function isPlainRecord(value: unknown): value is Record<string, string> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Split a `KEY=VALUE` token at the first `=`.
 *
 * @throws ParseError when the token has no `=` or an empty key.
 */
function parseKeyValuePair(
	flagName: string,
	raw: string,
	displayName = `--${flagName}`,
): readonly [string, string] {
	const eq = raw.indexOf('=');
	if (eq <= 0) {
		throw new ParseError(`Invalid value '${raw}' for flag ${displayName}. Use KEY=VALUE`, {
			code: 'INVALID_VALUE',
			details: { flag: flagName, input: displayName, value: raw, expected: 'key=value' },
		});
	}
	return [raw.slice(0, eq), raw.slice(eq + 1)];
}

// --- Positional arg mapping

/**
 * Map positional values to named args based on schema ordering.
 *
 * @param argEntries - Ordered arg schemas from the command
 * @param positionals - Positional values collected during tokenization
 * @returns Named arg values keyed by arg name
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

// --- Suggestion helper (Levenshtein-based "did you mean?")

/**
 * Suggest the closest flag name if the edit distance is small enough.
 *
 * @param input - Misspelled flag name from the user
 * @param lookup - Flag lookup map from {@link buildFlagLookup}
 * @returns Closest flag name, or `undefined` if no close match exists
 */
function suggestFlag(
	input: string,
	lookup: ReadonlyMap<string, FlagLookupEntry>,
): string | undefined {
	let bestName: string | undefined;
	let bestDist = Number.POSITIVE_INFINITY;
	const threshold = Math.max(2, Math.floor(input.length / 2));

	for (const [key, entry] of lookup) {
		// Only suggest declared, visible spellings: canonical names, visible
		// long aliases, and visible negated spellings — never single chars or
		// case-parity counterparts (the canonical spelling is the advertised one).
		if (key.length < 2 || entry.parity) continue;
		if (entry.negated && entry.schema.negation?.hidden === true) continue;
		const alias = entry.schema.aliases.find((candidate) => candidate.name === key);
		if (key !== entry.name && !entry.negated && alias?.hidden) continue;

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
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance between `a` and `b`
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
	const row = Array.from({ length: aLen + 1 }, (_, i) => i);

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

// --- Exports

export type { FlagLookupEntry, ParseOptions, ParseResult, Token };
export {
	buildFlagLookup,
	camelToKebab,
	flagExpectsValue,
	includesBeforeSeparator,
	kebabToCamel,
	parse,
	stripBeforeSeparator,
	tokenize,
};
