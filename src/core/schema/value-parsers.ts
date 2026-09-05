/**
 * Value-level machinery behind the sugar factories on both `flag` and `arg`
 * (`url()`, `path()`, `date()`, `duration()`, `bytes()`).
 *
 * Each parser converts a raw CLI/env/config/stdin value into a typed value and
 * throws a plain `Error` with a raw-free reason on invalid input. The parse and
 * resolve pipelines own value display and redaction, then add the subject's
 * context. Developer-authored custom parser messages remain verbatim.
 *
 * The option types keep their `Flag` prefix from the release that introduced
 * them on the flag factory alone. They describe the value, not flag syntax,
 * and the arg factory takes the same objects.
 *
 * @module dreamcli/core/schema/value-parsers
 */

/** Options accepted by `flag.url()` and `arg.url()`. */
interface UrlFlagOptions {
	/**
	 * Allowed URL protocols, without the trailing colon (e.g. `['https']`).
	 * @defaultValue `undefined` (any protocol)
	 */
	readonly protocols?: readonly string[];
}

/** Options accepted by `flag.date()` and `arg.date()`. */
interface DateFlagOptions {
	/**
	 * Inclusive earliest allowed date.
	 * @defaultValue `undefined` (no lower bound)
	 */
	readonly min?: Date;
	/**
	 * Inclusive latest allowed date.
	 * @defaultValue `undefined` (no upper bound)
	 */
	readonly max?: Date;
}

/**
 * Strict ISO-8601 shapes accepted by {@link parseDateValue}:
 * `YYYY-MM-DD`, optionally followed by `THH:MM`, `:SS`, `.mmm`, and a
 * `Z` / `±HH:MM` offset. Anything else — including `Date.parse`-lenient
 * inputs like `'0'` or `'March 5'` — is rejected.
 */
const ISO_DATE_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Parse a strict ISO-8601 date string into a `Date`.
 *
 * Rejects non-string input, non-ISO shapes, and calendar-invalid components
 * (`2026-02-31` does not silently roll over to March). Offset-less datetimes
 * are interpreted as UTC so results never depend on the machine's timezone.
 *
 * @param raw - Raw flag value.
 * @param options - Optional inclusive date bounds.
 * @returns The parsed `Date`.
 * @throws Error with a human-readable reason on invalid input.
 */
function parseDateValue(raw: unknown, options?: DateFlagOptions): Date {
	if (raw instanceof Date) {
		return validateDateBounds(raw, options);
	}
	if (typeof raw !== 'string') {
		throw new Error('Invalid date: expected an ISO-8601 string');
	}
	const match = ISO_DATE_PATTERN.exec(raw);
	if (match === null) {
		throw new Error('Invalid date: expected ISO-8601 (e.g. 2026-07-10 or 2026-07-10T14:30:00Z)');
	}
	// Validate calendar components structurally (new Date('2026-02-31')
	// silently rolls over to March 2, and timezone offsets shift the
	// round-tripped UTC components, so the parsed Date cannot be trusted
	// for this check).
	const [, yearPart, monthPart, dayPart, hourPart, minutePart, secondPart] = match;
	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);
	if (month < 1 || month > 12) {
		throw new Error('Invalid date: month must be 01-12');
	}
	if (day < 1 || day > daysInMonth(year, month)) {
		throw new Error('Invalid date: not a real calendar date');
	}
	if (hourPart !== undefined && Number(hourPart) > 23) {
		throw new Error('Invalid date: hours must be 00-23');
	}
	if (minutePart !== undefined && Number(minutePart) > 59) {
		throw new Error('Invalid date: minutes must be 00-59');
	}
	if (secondPart !== undefined && Number(secondPart) > 59) {
		throw new Error('Invalid date: seconds must be 00-59');
	}
	// Offset-less datetimes ('2026-07-10T14:30') are treated as UTC, not
	// local time — otherwise min/max acceptance would depend on the machine's
	// timezone. Date-only strings already parse as UTC midnight per spec.
	const hasTime = match[4] !== undefined;
	const hasOffset = match[8] !== undefined;
	const parsed = new Date(hasTime && !hasOffset ? `${raw}Z` : raw);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error('Invalid date');
	}
	return validateDateBounds(parsed, options);
}

/** Number of days in a month (1-12), accounting for leap years. */
function daysInMonth(year: number, month: number): number {
	// Day 0 of the next month is the last day of this month.
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Enforce inclusive date bounds, throwing a human-readable error on violation. */
function validateDateBounds(value: Date, options?: DateFlagOptions): Date {
	if (Number.isNaN(value.getTime())) {
		throw new Error('Invalid date');
	}
	if (options?.min !== undefined && value.getTime() < options.min.getTime()) {
		throw new Error(`Date is before the earliest allowed ${options.min.toISOString()}`);
	}
	if (options?.max !== undefined && value.getTime() > options.max.getTime()) {
		throw new Error(`Date is after the latest allowed ${options.max.toISOString()}`);
	}
	return value;
}

/**
 * Parse a URL string into a `URL`, optionally restricting protocols.
 *
 * @param raw - Raw flag value.
 * @param options - Optional protocol allowlist.
 * @returns The parsed `URL`.
 * @throws Error with a human-readable reason on invalid input.
 */
function parseUrlValue(raw: unknown, options?: UrlFlagOptions): URL {
	if (typeof raw !== 'string' && !(raw instanceof URL)) {
		throw new Error('Invalid URL: expected a URL string');
	}
	let parsed: URL;
	try {
		parsed = raw instanceof URL ? raw : new URL(raw);
	} catch {
		throw new Error('Invalid URL');
	}
	if (options?.protocols !== undefined) {
		const protocol = parsed.protocol.replace(/:$/, '');
		if (!options.protocols.includes(protocol)) {
			throw new Error(`URL protocol is not allowed. Allowed: ${options.protocols.join(', ')}`);
		}
	}
	return parsed;
}

/** Duration unit suffixes mapped to their length in milliseconds. */
const DURATION_UNITS: Readonly<Record<string, number>> = {
	ms: 1,
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

/**
 * Parse a human duration (`'30s'`, `'5m'`, `'1.5h'`, `'250ms'`, `'2d'`) into
 * milliseconds. A bare number (`'1500'`) is treated as milliseconds. Compound
 * values (`'1h30m'`) are supported.
 *
 * @param raw - Raw flag value.
 * @returns Duration in milliseconds.
 * @throws Error with a human-readable reason on invalid input.
 */
function parseDurationValue(raw: unknown): number {
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 0) {
			throw new Error('Invalid duration: must be a non-negative number');
		}
		return raw;
	}
	if (typeof raw !== 'string' || raw.length === 0) {
		throw new Error('Invalid duration: expected e.g. 30s, 5m, 1h30m, or 250ms');
	}
	if (/^\d+(?:\.\d+)?$/.test(raw)) {
		return Number(raw);
	}
	const segmentPattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/gy;
	let total = 0;
	let consumed = 0;
	for (const segment of raw.matchAll(segmentPattern)) {
		const [text, amount, unit] = segment;
		const scale = unit === undefined ? undefined : DURATION_UNITS[unit];
		if (amount === undefined || scale === undefined) break;
		total += Number(amount) * scale;
		consumed += text.length;
	}
	if (consumed !== raw.length || consumed === 0) {
		throw new Error('Invalid duration: expected e.g. 30s, 5m, 1h30m, or 250ms');
	}
	return total;
}

/** Byte unit suffixes mapped to their size (binary, 1 kb = 1024 bytes). */
const BYTE_UNITS: Readonly<Record<string, number>> = {
	b: 1,
	kb: 1024,
	mb: 1024 ** 2,
	gb: 1024 ** 3,
	tb: 1024 ** 4,
};

/**
 * Parse a human byte size (`'512mb'`, `'1.5gb'`, `'64kb'`, `'100b'`) into a
 * byte count. Units are binary (`1kb` = 1024 bytes) and case-insensitive; a
 * bare number is treated as bytes.
 *
 * @param raw - Raw flag value.
 * @returns Size in bytes.
 * @throws Error with a human-readable reason on invalid input.
 */
function parseBytesValue(raw: unknown): number {
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 0) {
			throw new Error('Invalid size: must be a non-negative number');
		}
		return raw;
	}
	if (typeof raw !== 'string' || raw.length === 0) {
		throw new Error('Invalid size: expected e.g. 512mb, 1.5gb, or 64kb');
	}
	const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(raw);
	if (match === null || match[1] === undefined) {
		throw new Error('Invalid size: expected e.g. 512mb, 1.5gb, or 64kb');
	}
	const unit = (match[2] ?? 'b').toLowerCase();
	const scale = BYTE_UNITS[unit];
	if (scale === undefined) {
		throw new Error('Invalid size: unknown unit');
	}
	return Math.round(Number(match[1]) * scale);
}

/** Options accepted by `flag.path()` and `arg.path()` for any-kind or file paths. */
interface FilePathFlagOptions {
	/**
	 * Reject the value if nothing exists at the path.
	 * @defaultValue `false` (`true` when `type` is set)
	 */
	readonly mustExist?: boolean;
	/**
	 * Require the path to be a file or a directory. Implies existence
	 * unless `mustExist` is explicitly `false`, in which case a missing
	 * path passes and only an existing path is type-checked.
	 * @defaultValue `undefined` (any kind)
	 */
	readonly type?: 'file';
	/** Directory creation is only available with `type: 'directory'`. */
	readonly create?: never;
}

/** Options accepted by `flag.path()` and `arg.path()` for directory paths. */
interface DirectoryPathFlagOptions {
	/**
	 * Reject the value if nothing exists at the path.
	 * @defaultValue `false` (`true` when `type` is set)
	 */
	readonly mustExist?: boolean;
	/**
	 * Require the path to be a directory. Implies existence unless
	 * `mustExist` is explicitly `false`, in which case a missing path
	 * passes and only an existing path is type-checked.
	 */
	readonly type: 'directory';
	/**
	 * Create the directory (recursively) when nothing exists at the path.
	 * An existing non-directory path still fails the type check.
	 * @defaultValue `false`
	 */
	readonly create?: boolean;
}

/** Options accepted by `flag.path()` and `arg.path()`. */
type PathFlagOptions = FilePathFlagOptions | DirectoryPathFlagOptions;

/**
 * Filesystem expectations attached by `flag.path()` and `arg.path()`.
 *
 * Checked after resolution (not during parse) via the runtime adapter, so
 * `src/core` stays free of platform I/O and every resolved value is validated
 * whichever source produced it, defaults included.
 */
interface PathChecks {
	/** Reject the value if nothing exists at the path. */
	readonly mustExist: boolean;
	/**
	 * Require the existing path to be a file or a directory. Implies
	 * existence when set, unless `mustExist` is `false`.
	 */
	readonly type: 'file' | 'directory' | undefined;
	/** Create the directory (recursively) when nothing exists at the path. */
	readonly create: boolean;
}

/**
 * Normalize path factory options into the {@link PathChecks} a schema stores.
 *
 * Options that ask for nothing (absent, `{}`, or `mustExist: false` alone)
 * produce `undefined`, so the schema records no checks and the resolver skips
 * the filesystem entirely.
 *
 * @param options - Options passed to `flag.path()` or `arg.path()`.
 * @returns The checks to store, or `undefined` when none were requested.
 */
function buildPathChecks(options?: PathFlagOptions): PathChecks | undefined {
	if (options === undefined || (options.mustExist !== true && options.type === undefined)) {
		return undefined;
	}
	return {
		mustExist: options.mustExist ?? true,
		type: options.type,
		create: options.type === 'directory' && options.create === true,
	};
}

export type { DateFlagOptions, PathChecks, PathFlagOptions, UrlFlagOptions };
export { buildPathChecks, parseBytesValue, parseDateValue, parseDurationValue, parseUrlValue };
