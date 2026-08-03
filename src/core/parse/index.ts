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
import type { Cardinality, SplitPolicy } from '#internals/core/schema/cardinality.ts';
import {
	argCardinality,
	flagCardinality,
	splitEntryPair,
} from '#internals/core/schema/cardinality.ts';
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
	stringConstraintDetails,
} from '#internals/core/schema/index.ts';
import type { StdinBinding } from '#internals/core/schema/stdin.ts';
import { stdinReadsOnDash } from '#internals/core/schema/stdin.ts';
import type { ValueFailure } from '#internals/core/schema/value.ts';
import { argValueSchema, decodeValue, flagValueSchema } from '#internals/core/schema/value.ts';
import type { Occurrence } from './occurrences.ts';
import {
	INCREMENT_OCCURRENCE,
	NEGATED_OCCURRENCE,
	occurrenceValue,
	projectOccurrences,
	STDIN_OCCURRENCE,
	STDIN_SENTINEL,
} from './occurrences.ts';

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
 * Whether argv asks for help before the `--` end-of-options separator.
 *
 * Help renders ahead of flag validation everywhere: a command short-circuits to
 * its help text before `parse()` runs, and the root does the same before
 * dispatch, so a malformed flag value never hides the text explaining the flags.
 *
 * @param argv - Raw argument strings.
 * @returns `true` if `--help` or `-h` occurs before any `--` separator.
 */
function requestsHelp(argv: readonly string[]): boolean {
	return includesBeforeSeparator(argv, '--help') || includesBeforeSeparator(argv, '-h');
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
	// registered so an explicitly declared counterpart always wins (per-pair auto-optout).
	// The pass inserts into `lookup`, and a live Map iterator would visit those insertions,
	// so it walks a snapshot of the declared spellings instead.
	if (options?.caseParity !== false) {
		const declared = [...lookup];
		for (const [spelling, entry] of declared) {
			const counterpart = counterpartSpelling(spelling);
			if (counterpart !== undefined && !lookup.has(counterpart)) {
				lookup.set(counterpart, { ...entry, parity: true });
			}
		}
	}

	return lookup;
}

// --- Occurrence tracking

/** One CLI occurrence of a logical flag, and what it contributes. */
interface FlagOccurrence {
	/** Whether the flag's duplicate policy governs this occurrence. */
	readonly policed: boolean;
	/** The value a duplicate diagnostic reports for it. */
	readonly reported: unknown;
	/** What the occurrence contributes, in the order it was typed. */
	items: readonly Occurrence[];
}

/** Every CLI occurrence of one logical flag, in the order they were typed. */
interface FlagOccurrences {
	/** The schema the occurrences belong to. */
	readonly schema: FlagSchema;
	/** The occurrences, latest last. */
	readonly occurrences: FlagOccurrence[];
	/** How many of them the duplicate policy governs. */
	counted: number;
}

/**
 * The occurrence list of one logical flag, started on its first occurrence.
 *
 * @param occurrences - Per-parse accumulator keyed by canonical name
 * @param name - Canonical flag name
 * @param schema - Flag schema the occurrences belong to
 * @returns The flag's list
 */
function occurrencesOf(
	occurrences: Map<string, FlagOccurrences>,
	name: string,
	schema: FlagSchema,
): FlagOccurrences {
	const existing = occurrences.get(name);
	if (existing !== undefined) return existing;
	const started: FlagOccurrences = { schema, occurrences: [], counted: 0 };
	occurrences.set(name, started);
	return started;
}

/**
 * Record one CLI occurrence of a logical flag and enforce its duplicate
 * policy.
 *
 * @param occurrences - Per-parse accumulator keyed by canonical name
 * @param name - Canonical flag name
 * @param schema - Flag schema (read for {@link FlagSchema.duplicates})
 * @param reported - The occurrence's raw value (or the boolean it implies)
 * @param displayName - User-facing spelling for error messages
 * @returns The recorded occurrence, ready for its items; `undefined` when the
 *   `'first'` policy suppresses it (the token is still consumed)
 * @throws ParseError `DUPLICATE_FLAG` on a repeat under the `'error'` policy
 */
function recordFlagOccurrence(
	occurrences: Map<string, FlagOccurrences>,
	name: string,
	schema: FlagSchema,
	reported: unknown,
	displayName: string,
): FlagOccurrence | undefined {
	const record = occurrencesOf(occurrences, name, schema);
	const occurrence: FlagOccurrence = { policed: true, reported, items: [] };
	record.occurrences.push(occurrence);
	record.counted += 1;

	if (record.counted === 1) return occurrence;
	if (schema.duplicates === 'error') {
		throw new ParseError(`Flag --${name} may only be specified once`, {
			code: 'DUPLICATE_FLAG',
			details: {
				flag: name,
				input: displayName,
				count: record.counted,
				values: record.occurrences.filter((entry) => entry.policed).map((entry) => entry.reported),
			},
		});
	}
	return schema.duplicates === 'first' ? undefined : occurrence;
}

/**
 * Record one bare occurrence of a count flag.
 *
 * A bare `-v` raises the count rather than supplying a value, and the duplicate
 * policy governs supplied values, so the increment stays outside it.
 *
 * @param occurrences - Per-parse accumulator keyed by canonical name
 * @param name - Canonical flag name
 * @param schema - Flag schema the occurrence belongs to
 */
function recordCountIncrement(
	occurrences: Map<string, FlagOccurrences>,
	name: string,
	schema: FlagSchema,
): void {
	occurrencesOf(occurrences, name, schema).occurrences.push({
		policed: false,
		reported: undefined,
		items: [INCREMENT_OCCURRENCE],
	});
}

/**
 * Project every flag's occurrences onto the values a parse result carries.
 *
 * @param occurrences - Per-parse accumulator keyed by canonical name
 * @returns Flag values keyed by canonical name, in first-occurrence order
 */
function projectFlags(occurrences: ReadonlyMap<string, FlagOccurrences>): Record<string, unknown> {
	const flags: Record<string, unknown> = {};
	for (const [name, record] of occurrences) {
		flags[name] = projectOccurrences(
			flagCardinality(record.schema),
			record.occurrences.flatMap((occurrence) => occurrence.items),
		);
	}
	return flags;
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
 * Whether a token is the stdin sentinel for an input that reads on `-`.
 *
 * The sentinel names the source, not the value, so it passes through the parse
 * boundary untouched and the resolver reads the buffer in its place. Without
 * this a `-` handed to `flag.number().stdin()` would be rejected here as a
 * malformed number before resolution ever saw it.
 *
 * @param raw - Raw token from argv.
 * @param stdin - The input's stdin axis.
 * @returns `true` when the token selects stdin.
 */
function isStdinSentinel(raw: string, stdin: StdinBinding | undefined): boolean {
	return raw === STDIN_SENTINEL && stdin !== undefined && stdinReadsOnDash(stdin);
}

/**
 * Coerce one raw CLI token to what the flag's value axis declares.
 *
 * @param flagName - Canonical flag name (for error messages)
 * @param raw - Raw string value from argv
 * @param schema - {@link FlagSchema} declaring the expected kind
 * @param displayName - Spelling the user typed
 * @returns The coerced token: a value, an element, or a `[key, value]` pair
 * @throws ParseError on type mismatch
 */
function coerceFlagValue(
	flagName: string,
	raw: string,
	schema: FlagSchema,
	displayName = `--${flagName}`,
): unknown {
	return occurrenceValue(flagTokenOccurrence(flagName, raw, schema, displayName));
}

/**
 * Read one raw CLI token of a flag as the occurrence it contributes.
 *
 * The cardinality axis decides what a token IS: one value, one element of a
 * collection, one entry of a record, or an explicit count. The value axis then
 * decides what that token means. A `-` names the stdin source, so it holds its
 * position without being decoded.
 *
 * @param flagName - Canonical flag name (for error messages)
 * @param raw - Raw string value from argv
 * @param schema - {@link FlagSchema} declaring the expected kind
 * @param displayName - Spelling the user typed
 * @returns The occurrence the token contributes
 * @throws ParseError on type mismatch
 */
function flagTokenOccurrence(
	flagName: string,
	raw: string,
	schema: FlagSchema,
	displayName: string,
): Occurrence {
	if (isStdinSentinel(raw, schema.stdin)) return STDIN_OCCURRENCE;

	const cardinality = flagCardinality(schema);
	if (cardinality.kind === 'count') {
		return { kind: 'value', value: coerceCountToken(flagName, raw, displayName) };
	}
	if (cardinality.kind === 'entries') {
		const [key, value] = coerceEntryToken(flagName, raw, schema, displayName);
		return { kind: 'entry', key, value };
	}
	return { kind: 'value', value: coerceElementToken(flagName, raw, schema, displayName) };
}

/** Decode one token through the flag's element value axis. */
function coerceElementToken(
	flagName: string,
	raw: string,
	schema: FlagSchema,
	displayName: string,
): unknown {
	const decoded = decodeValue(flagValueSchema(schema), raw, 'token');
	if (decoded.ok) return decoded.value;
	throw flagValueError(flagName, displayName, raw, decoded.failure);
}

/** Read an explicit count token such as `--verbose=2`. */
function coerceCountToken(flagName: string, raw: string, displayName: string): number {
	// Number('') is 0, which would silently accept `--verbose=`.
	const count = raw.trim() === '' ? Number.NaN : Number(raw);
	if (!Number.isInteger(count) || count < 0) {
		throw new ParseError(
			`Invalid count value '${raw}' for flag ${displayName}. Use a non-negative integer`,
			{
				code: 'INVALID_VALUE',
				details: { flag: flagName, input: displayName, value: raw, expected: 'count' },
			},
		);
	}
	return count;
}

/** Read one `KEY=VALUE` token and decode its value through the element value axis. */
function coerceEntryToken(
	flagName: string,
	raw: string,
	schema: FlagSchema,
	displayName: string,
): readonly [string, unknown] {
	const pair = splitEntryPair(raw);
	if (pair === undefined) {
		throw new ParseError(`Invalid value '${raw}' for flag ${displayName}. Use KEY=VALUE`, {
			code: 'INVALID_VALUE',
			details: { flag: flagName, input: displayName, value: raw, expected: 'key=value' },
		});
	}
	return [pair[0], coerceElementToken(flagName, pair[1], schema, displayName)];
}

/**
 * Name the flag a rejected value belonged to.
 *
 * @param flagName - Canonical flag name.
 * @param displayName - Spelling the user typed.
 * @param raw - Raw string value from argv.
 * @param failure - What the value layer rejected.
 * @returns The error to throw.
 */
function flagValueError(
	flagName: string,
	displayName: string,
	raw: string,
	failure: ValueFailure,
): ParseError {
	const subject = { flag: flagName, input: displayName, value: raw };

	switch (failure.kind) {
		case 'type':
			if (failure.expected === 'number') {
				return new ParseError(`Invalid number value '${raw}' for flag ${displayName}`, {
					code: 'INVALID_VALUE',
					details: { ...subject, expected: 'number' },
				});
			}
			if (failure.expected === 'boolean') {
				return new ParseError(
					`Invalid boolean value '${raw}' for flag ${displayName}. Use true/false or 1/0`,
					{
						code: 'INVALID_VALUE',
						details: { ...subject, expected: 'boolean' },
					},
				);
			}
			return new ParseError(`Invalid value '${raw}' for flag ${displayName}`, {
				code: 'INVALID_VALUE',
				details: { ...subject, expected: 'string' },
			});

		case 'enum': {
			const allowed = failure.enumValues;
			if (allowed === undefined) {
				return new ParseError(
					`Enum flag --${flagName} is misconfigured: no allowed values declared`,
					{
						code: 'INVALID_SCHEMA',
						details: { flag: flagName, kind: 'enum', missing: 'enumValues' },
					},
				);
			}
			return new ParseError(
				`Invalid value '${raw}' for flag ${displayName}. Allowed: ${allowed.join(', ')}`,
				{
					code: 'INVALID_VALUE',
					details: { ...subject, allowed },
				},
			);
		}

		case 'string-constraint':
			return new ParseError(
				`Invalid value '${raw}' for flag ${displayName}: ${describeStringConstraintViolation(failure.violation)}`,
				{
					code: 'INVALID_VALUE',
					details: {
						...subject,
						expected: 'string',
						...stringConstraintDetails(failure.violation),
					},
				},
			);

		case 'number-constraint':
			return new ParseError(
				`Invalid number value '${raw}' for flag ${displayName}: ${describeNumberConstraintViolation(failure.violation)}`,
				{
					code: 'INVALID_VALUE',
					details: {
						...subject,
						expected: 'number',
						constraint: failure.violation.kind,
						...('bound' in failure.violation ? { bound: failure.violation.bound } : {}),
					},
				},
			);

		case 'thrown': {
			if (failure.error instanceof ParseError) return failure.error;
			const message =
				failure.error instanceof Error ? failure.error.message : String(failure.error);
			return new ParseError(`Failed to parse flag ${displayName}: ${message}`, {
				code: 'INVALID_VALUE',
				details: subject,
				cause: failure.error,
			});
		}
	}
}

/**
 * Read one raw positional token as the occurrence it contributes.
 *
 * A `-` names the stdin source, so it holds its position without being decoded.
 *
 * @param argName - Positional arg name (for error messages)
 * @param raw - Raw string value from argv
 * @param schema - {@link ArgSchema} declaring the expected kind
 * @returns The occurrence the token contributes
 * @throws ParseError on type mismatch or custom parse failure
 */
function argTokenOccurrence(argName: string, raw: string, schema: ArgSchema): Occurrence {
	if (isStdinSentinel(raw, schema.stdin)) return STDIN_OCCURRENCE;

	if (schema.kind === 'keyValue') {
		const pair = splitEntryPair(raw);
		if (pair === undefined) {
			throw new ParseError(`Invalid value '${raw}' for argument <${argName}>. Use KEY=VALUE`, {
				code: 'INVALID_VALUE',
				details: { arg: argName, value: raw, expected: 'key=value' },
			});
		}
		return { kind: 'entry', key: pair[0], value: decodeArgToken(argName, pair[1], schema) };
	}

	return { kind: 'value', value: decodeArgToken(argName, raw, schema) };
}

/** Decode one token through the arg's element value axis. */
function decodeArgToken(argName: string, raw: string, schema: ArgSchema): unknown {
	const decoded = decodeValue(argValueSchema(schema), raw, 'token');
	if (decoded.ok) return decoded.value;
	throw argValueError(argName, raw, decoded.failure);
}

/**
 * Name the positional argument a rejected value belonged to.
 *
 * @param argName - Positional arg name.
 * @param raw - Raw string value from argv.
 * @param failure - What the value layer rejected.
 * @returns The error to throw.
 */
function argValueError(argName: string, raw: string, failure: ValueFailure): ParseError {
	const subject = { arg: argName, value: raw };

	switch (failure.kind) {
		case 'type':
			if (failure.expected === 'number') {
				return new ParseError(`Invalid number value '${raw}' for argument <${argName}>`, {
					code: 'INVALID_VALUE',
					details: { ...subject, expected: 'number' },
				});
			}
			if (failure.expected === 'boolean') {
				return new ParseError(
					`Invalid boolean value '${raw}' for argument <${argName}>. Use true/false or 1/0`,
					{
						code: 'INVALID_VALUE',
						details: { ...subject, expected: 'boolean' },
					},
				);
			}
			return new ParseError(`Invalid value '${raw}' for argument <${argName}>`, {
				code: 'INVALID_VALUE',
				details: { ...subject, expected: 'string' },
			});

		case 'enum': {
			const allowed = failure.enumValues;
			if (allowed === undefined) {
				return new ParseError(
					`Enum argument <${argName}> is misconfigured: no allowed values declared`,
					{
						code: 'INVALID_SCHEMA',
						details: { arg: argName, kind: 'enum', missing: 'enumValues' },
					},
				);
			}
			return new ParseError(
				`Invalid value '${raw}' for argument <${argName}>. Allowed: ${allowed.join(', ')}`,
				{
					code: 'INVALID_VALUE',
					details: { ...subject, allowed },
				},
			);
		}

		case 'string-constraint':
			return new ParseError(
				`Invalid value '${raw}' for argument <${argName}>: ${describeStringConstraintViolation(failure.violation)}`,
				{
					code: 'INVALID_VALUE',
					details: {
						...subject,
						expected: 'string',
						...stringConstraintDetails(failure.violation),
					},
				},
			);

		case 'number-constraint':
			return new ParseError(
				`Invalid number value '${raw}' for argument <${argName}>: ${describeNumberConstraintViolation(failure.violation)}`,
				{
					code: 'INVALID_VALUE',
					details: {
						...subject,
						expected: 'number',
						constraint: failure.violation.kind,
						...('bound' in failure.violation ? { bound: failure.violation.bound } : {}),
					},
				},
			);

		case 'thrown': {
			if (failure.error instanceof ParseError) return failure.error;
			const message =
				failure.error instanceof Error ? failure.error.message : String(failure.error);
			return new ParseError(`Failed to parse argument <${argName}>: ${message}`, {
				code: 'INVALID_VALUE',
				details: subject,
				cause: failure.error,
			});
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

	// Mutable accumulators — projected into the result
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
			i = parseLongFlag(token, tokens, i, flagLookup, occurrences);
			continue;
		}

		// token.kind === 'short-flags'
		i = parseShortFlags(token, tokens, i, flagLookup, occurrences);
	}

	// Map positionals to named args
	const args = mapPositionals(schema.args, positionals);

	return { flags: projectFlags(occurrences), args };
}

// --- Long flag parsing

/**
 * Parse a long flag token, consuming a value from the next token if needed.
 *
 * @param token - Long-flag token to process
 * @param tokens - Full token array (for lookahead)
 * @param startIdx - Current index of `token` in the array
 * @param flagLookup - Spelling → {@link FlagLookupEntry} map from {@link buildFlagLookup}
 * @param occurrences - Per-parse occurrence accumulator
 * @returns Next index to continue parsing from
 */
function parseLongFlag(
	token: { readonly kind: 'long-flag'; readonly name: string; readonly value: string | undefined },
	tokens: readonly Token[],
	startIdx: number,
	flagLookup: ReadonlyMap<string, FlagLookupEntry>,
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
		const occurrence = recordFlagOccurrence(
			occurrences,
			canonicalName,
			flagSchema,
			false,
			displayName,
		);
		if (occurrence !== undefined) occurrence.items = [NEGATED_OCCURRENCE];
		return startIdx + 1;
	}

	if (!flagExpectsValue(flagSchema)) {
		// Boolean or count flag — consumes no value token
		if (token.value !== undefined) {
			const item = flagTokenOccurrence(canonicalName, token.value, flagSchema, displayName);
			const occurrence = recordFlagOccurrence(
				occurrences,
				canonicalName,
				flagSchema,
				occurrenceValue(item),
				displayName,
			);
			if (occurrence !== undefined) occurrence.items = [item];
		} else if (flagSchema.kind === 'count') {
			recordCountIncrement(occurrences, canonicalName, flagSchema);
		} else {
			const occurrence = recordFlagOccurrence(
				occurrences,
				canonicalName,
				flagSchema,
				true,
				displayName,
			);
			if (occurrence !== undefined) occurrence.items = [{ kind: 'value', value: true }];
		}
		return startIdx + 1;
	}

	if (token.value !== undefined) {
		// --flag=value (inline)
		const occurrence = recordFlagOccurrence(
			occurrences,
			canonicalName,
			flagSchema,
			token.value,
			displayName,
		);
		if (occurrence !== undefined) {
			occurrence.items = flagTokenOccurrences(canonicalName, flagSchema, token.value);
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
	const occurrence = recordFlagOccurrence(
		occurrences,
		canonicalName,
		flagSchema,
		nextToken.value,
		displayName,
	);
	if (occurrence !== undefined) {
		occurrence.items = flagTokenOccurrences(
			canonicalName,
			flagSchema,
			nextToken.value,
			displayName,
		);
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
 * @param occurrences - Per-parse occurrence accumulator
 * @returns Next index to continue parsing from
 */
function parseShortFlags(
	token: { readonly kind: 'short-flags'; readonly chars: string },
	tokens: readonly Token[],
	startIdx: number,
	flagLookup: ReadonlyMap<string, FlagLookupEntry>,
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
				recordCountIncrement(occurrences, canonicalName, flagSchema);
			} else {
				const occurrence = recordFlagOccurrence(
					occurrences,
					canonicalName,
					flagSchema,
					true,
					displayName,
				);
				if (occurrence !== undefined) occurrence.items = [{ kind: 'value', value: true }];
			}
			continue;
		}

		if (ci < chars.length - 1) {
			// Value-expecting flag in the middle of combined shorts:
			// -oFile → -o with value "File" (rest of chars is the value)
			const inlineValue = chars.slice(ci + 1);
			const occurrence = recordFlagOccurrence(
				occurrences,
				canonicalName,
				flagSchema,
				inlineValue,
				displayName,
			);
			if (occurrence !== undefined) {
				occurrence.items = flagTokenOccurrences(
					canonicalName,
					flagSchema,
					inlineValue,
					displayName,
				);
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
		const occurrence = recordFlagOccurrence(
			occurrences,
			canonicalName,
			flagSchema,
			nextToken.value,
			displayName,
		);
		if (occurrence !== undefined) {
			occurrence.items = flagTokenOccurrences(
				canonicalName,
				flagSchema,
				nextToken.value,
				displayName,
			);
		}
		nextIdx++;
	}

	return nextIdx;
}

// --- Flag value tokens (one occurrence, one or more elements)

/**
 * Read one value token of a flag as the occurrences it contributes.
 *
 * A collection keeps its CLI occurrences in the order they were typed, elements
 * for `many` and `[key, value]` pairs for `entries`. Aggregation happens during
 * resolution, where the stdin buffer an occurrence of `-` stands for is spliced
 * into that order.
 *
 * @param name - Canonical flag name
 * @param schema - {@link FlagSchema} declaring the expected kind
 * @param rawValue - Raw string value from argv
 * @param displayName - Spelling the user typed
 * @returns The occurrences the token contributes, in order
 */
function flagTokenOccurrences(
	name: string,
	schema: FlagSchema,
	rawValue: string,
	displayName = `--${name}`,
): readonly Occurrence[] {
	const cardinality = flagCardinality(schema);
	if (cardinality.kind !== 'many' && cardinality.kind !== 'entries') {
		return [flagTokenOccurrence(name, rawValue, schema, displayName)];
	}

	// One occurrence may carry several elements (--tag a,b); each is coerced
	// individually so errors name the offending element, not the whole token.
	return splitCliToken(cardinality.cliSplit, rawValue, schema).map((part) =>
		flagTokenOccurrence(name, part, schema, displayName),
	);
}

/**
 * Split one CLI token into the elements it carries.
 *
 * The stdin sentinel names a source rather than a value, so it stays one
 * element whatever the split policy says.
 *
 * @param policy - The CLI split policy.
 * @param raw - The raw token.
 * @param schema - The input's schema, read for its stdin axis.
 * @returns The token's elements.
 */
function splitCliToken(
	policy: SplitPolicy,
	raw: string,
	schema: { readonly stdin: StdinBinding | undefined },
): readonly string[] {
	if (isStdinSentinel(raw, schema.stdin)) return [raw];
	if (policy.format === 'delimiter') {
		return raw.split(policy.delimiter).filter((part) => part.length > 0);
	}
	return [raw];
}

/** The CLI policy a single-value positional splits under: none at all. */
const WHOLE_TOKEN: SplitPolicy = { format: 'whole' };

/**
 * The CLI split policy a cardinality carries.
 *
 * A scalar and a count have no elements to split into, so their tokens stay
 * whole.
 *
 * @param cardinality - How the input's values combine.
 * @returns The policy each of its CLI tokens splits under.
 */
function cliSplitOf(cardinality: Cardinality): SplitPolicy {
	return cardinality.kind === 'many' || cardinality.kind === 'entries'
		? cardinality.cliSplit
		: WHOLE_TOKEN;
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
		const cardinality = argCardinality(entry.schema);
		const policy = cliSplitOf(cardinality);
		if (entry.schema.variadic) {
			// Variadic arg consumes all remaining positionals
			const remaining = positionals.slice(posIdx);
			const occurrences = remaining.flatMap((raw) =>
				splitCliToken(policy, raw, { stdin: entry.schema.stdin }).map((part) =>
					argTokenOccurrence(entry.name, part, entry.schema),
				),
			);
			args[entry.name] = projectOccurrences(cardinality, occurrences);
			posIdx = positionals.length;
			break;
		}

		const rawPositional = positionals[posIdx];
		if (rawPositional !== undefined) {
			const occurrences = splitCliToken(policy, rawPositional, {
				stdin: entry.schema.stdin,
			}).map((part) => argTokenOccurrence(entry.name, part, entry.schema));
			args[entry.name] = projectOccurrences(cardinality, occurrences);
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
	coerceFlagValue,
	flagExpectsValue,
	includesBeforeSeparator,
	kebabToCamel,
	parse,
	requestsHelp,
	stripBeforeSeparator,
	tokenize,
};
