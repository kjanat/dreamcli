/**
 * Output channel (out object) for command handlers.
 *
 * Provides a structured output abstraction that handlers use instead of
 * raw `console.log`. The channel respects TTY vs piped contexts and
 * supports verbosity levels (quiet mode suppresses `info`).
 *
 * The `Out` interface (the contract handlers depend on) lives in
 * `src/core/schema/command.ts`. This module provides the implementation.
 *
 * @module dreamcli/core/output
 */

import type {
	ActivityEvent,
	Out,
	ProgressHandle,
	ProgressOptions,
	SpinnerHandle,
	SpinnerOptions,
	TableColumn,
} from '../schema/command.js';

// ---------------------------------------------------------------------------
// Writer abstraction — the minimal I/O seam for testability
// ---------------------------------------------------------------------------

/**
 * A function that writes a string somewhere.
 *
 * This is the only I/O primitive the output channel depends on.
 * In production it wraps `process.stdout.write` / `process.stderr.write`;
 * in tests it can be a simple string accumulator.
 */
type WriteFn = (data: string) => void;

// ---------------------------------------------------------------------------
// Verbosity
// ---------------------------------------------------------------------------

/**
 * Controls which messages are emitted.
 *
 * - `'normal'` — all messages
 * - `'quiet'`  — suppresses `info`; keeps `log`, `warn`, `error`
 */
type Verbosity = 'normal' | 'quiet';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Configuration for creating an output channel.
 *
 * Every field is optional — sensible defaults are applied when omitted.
 */
interface OutputOptions {
	/**
	 * Writer for stdout-bound messages (`log`, `info`, `json`).
	 * Defaults to `process.stdout.write` when running in Node/Bun.
	 */
	readonly stdout?: WriteFn;

	/**
	 * Writer for stderr-bound messages (`warn`, `error`).
	 * In JSON mode, `log` and `info` are also redirected here so that
	 * stdout contains only structured JSON output.
	 * Defaults to `process.stderr.write` when running in Node/Bun.
	 */
	readonly stderr?: WriteFn;

	/**
	 * Whether stdout is connected to a TTY.
	 * When `false`, output may omit ANSI codes and decorations.
	 * Defaults to `false` (safe default — non-TTY until proven otherwise).
	 */
	readonly isTTY?: boolean;

	/**
	 * Verbosity level.
	 * - `'normal'` (default) — emit all messages
	 * - `'quiet'` — suppress `info` messages
	 */
	readonly verbosity?: Verbosity;

	/**
	 * Enable JSON output mode.
	 *
	 * When `true`, `log` and `info` messages are redirected to stderr
	 * so that stdout is reserved exclusively for structured `json()` output.
	 * `warn` and `error` continue to write to stderr as normal.
	 *
	 * @default false
	 */
	readonly jsonMode?: boolean;
}

// ---------------------------------------------------------------------------
// Resolved options (all fields required, filled from defaults)
// ---------------------------------------------------------------------------

/** Fully resolved output options with no optional fields. */
interface ResolvedOutputOptions {
	readonly stdout: WriteFn;
	readonly stderr: WriteFn;
	readonly isTTY: boolean;
	readonly verbosity: Verbosity;
	readonly jsonMode: boolean;
}

/**
 * A noop writer used as fallback when no writer is provided and
 * platform defaults aren't available. Silently discards output.
 */
const noopWrite: WriteFn = () => {};

/** Merge user-supplied options with defaults. */
function resolveOptions(options?: OutputOptions): ResolvedOutputOptions {
	return {
		stdout: options?.stdout ?? noopWrite,
		stderr: options?.stderr ?? noopWrite,
		isTTY: options?.isTTY ?? false,
		verbosity: options?.verbosity ?? 'normal',
		jsonMode: options?.jsonMode ?? false,
	};
}

// ---------------------------------------------------------------------------
// OutputChannel — the concrete Out implementation
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of the `Out` interface.
 *
 * Routes messages to the appropriate writer (stdout vs stderr) and
 * respects the configured verbosity level.
 *
 * Handlers interact with this via the `Out` interface — they never see
 * `OutputChannel` directly, which keeps the coupling minimal.
 */
class OutputChannel implements Out {
	/** @internal Resolved configuration. */
	readonly options: ResolvedOutputOptions;

	/** Whether JSON output mode is active. */
	readonly jsonMode: boolean;

	/**
	 * Whether stdout is connected to a TTY.
	 *
	 * When `jsonMode` is active, this reflects the underlying TTY status
	 * but decorative output should still be suppressed (jsonMode takes
	 * precedence).
	 */
	readonly isTTY: boolean;

	constructor(options: ResolvedOutputOptions) {
		this.options = options;
		this.jsonMode = options.jsonMode;
		this.isTTY = options.isTTY;
	}

	/**
	 * Write to stdout (normal output). Always emitted.
	 *
	 * In JSON mode, redirected to stderr so stdout is reserved for
	 * structured `json()` output only.
	 */
	log(message: string): void {
		const writer = this.options.jsonMode ? this.options.stderr : this.options.stdout;
		writeLine(writer, message);
	}

	/**
	 * Informational message to stdout.
	 * Suppressed when verbosity is `'quiet'`.
	 *
	 * In JSON mode, redirected to stderr.
	 */
	info(message: string): void {
		if (this.options.verbosity === 'quiet') return;
		const writer = this.options.jsonMode ? this.options.stderr : this.options.stdout;
		writeLine(writer, message);
	}

	/** Warning to stderr. Always emitted. */
	warn(message: string): void {
		writeLine(this.options.stderr, message);
	}

	/** Error to stderr. Always emitted. */
	error(message: string): void {
		writeLine(this.options.stderr, message);
	}

	/**
	 * Emit a structured JSON value to stdout.
	 *
	 * Serialises `value` with `JSON.stringify` and writes to stdout
	 * regardless of JSON mode — `json()` always targets stdout.
	 */
	json(value: unknown): void {
		writeLine(this.options.stdout, JSON.stringify(value));
	}

	/**
	 * Render tabular data.
	 *
	 * In JSON mode: emits the rows as a JSON array to stdout.
	 * Otherwise: pretty-prints aligned columns with headers to stdout
	 * (via `log()`, which respects JSON-mode redirection).
	 */
	table<T extends Record<string, unknown>>(
		rows: readonly T[],
		columns?: readonly TableColumn<T>[],
	): void {
		if (this.options.jsonMode) {
			this.json(rows);
			return;
		}
		const text = formatTable(rows, columns);
		if (text.length > 0) {
			this.log(text);
		}
	}

	/**
	 * Create a spinner handle.
	 *
	 * Placeholder — returns a noop handle. Real mode dispatch (TTY vs
	 * static vs silent) will be wired in D5 (OutputChannel integration).
	 */
	spinner(_text: string, _options?: SpinnerOptions): SpinnerHandle {
		return noopSpinnerHandle;
	}

	/**
	 * Create a progress handle.
	 *
	 * Placeholder — returns a noop handle. Real mode dispatch (TTY vs
	 * static vs silent) will be wired in D5 (OutputChannel integration).
	 */
	progress(_options: ProgressOptions): ProgressHandle {
		return noopProgressHandle;
	}
}

// ---------------------------------------------------------------------------
// CaptureOutputChannel — testkit subclass that records activity events
// ---------------------------------------------------------------------------

/**
 * Output channel variant that returns capture handles for spinner/progress.
 *
 * Extends `OutputChannel` to override `spinner()` and `progress()`, routing
 * activity events into a shared `ActivityEvent[]` for testkit assertion.
 * Text output (log/info/warn/error) is handled by the parent class.
 *
 * @internal
 */
class CaptureOutputChannel extends OutputChannel {
	constructor(
		options: ResolvedOutputOptions,
		private readonly activity: ActivityEvent[],
	) {
		super(options);
	}

	override spinner(text: string, _options?: SpinnerOptions): SpinnerHandle {
		return new CaptureSpinnerHandle(text, this.activity);
	}

	override progress(opts: ProgressOptions): ProgressHandle {
		return new CaptureProgressHandle(opts, this.activity);
	}
}

// ---------------------------------------------------------------------------
// Noop activity handles — silent mode (non-TTY, fallback='silent')
// ---------------------------------------------------------------------------

/**
 * Noop spinner handle singleton.
 *
 * All methods are no-ops. Used when spinners should produce no output
 * at all — `jsonMode`, or non-TTY with `fallback: 'silent'` (default).
 *
 * @internal
 */
const noopSpinnerHandle: SpinnerHandle = {
	update() {},
	succeed() {},
	fail() {},
	stop() {},
	async wrap<T>(promise: Promise<T>): Promise<T> {
		return promise;
	},
};

/**
 * Noop progress handle singleton.
 *
 * All methods are no-ops. Used when progress bars should produce no
 * output at all — `jsonMode`, or non-TTY with `fallback: 'silent'`.
 *
 * @internal
 */
const noopProgressHandle: ProgressHandle = {
	increment() {},
	update() {},
	done() {},
	fail() {},
};

// ---------------------------------------------------------------------------
// Static activity handles — plain text mode (non-TTY, fallback='static')
// ---------------------------------------------------------------------------

/**
 * I/O writers for static handles.
 *
 * Static handles emit plain text at lifecycle boundaries. They need
 * separate stdout/stderr writers rather than an `Out` reference to
 * avoid circular dependency (Out.spinner() → handle → Out).
 *
 * @internal
 */
interface StaticWriters {
	/** Writer for normal output (success, start). */
	readonly stdout: WriteFn;
	/** Writer for error output (fail). */
	readonly stderr: WriteFn;
}

/**
 * Static spinner handle — emits plain text at lifecycle boundaries.
 *
 * Used in non-TTY environments with `fallback: 'static'`. No animation,
 * no ANSI codes. Emits text on start and terminal events only.
 *
 * Terminal methods are idempotent — calling after stop is a no-op.
 *
 * @internal
 */
class StaticSpinnerHandle implements SpinnerHandle {
	/** Whether the handle has been stopped (terminal state reached). */
	private stopped = false;

	constructor(
		text: string,
		private readonly writers: StaticWriters,
	) {
		writeLine(writers.stdout, text);
	}

	update(_text: string): void {
		// Static mode — no update output (no terminal to overwrite).
	}

	succeed(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		if (text !== undefined) {
			writeLine(this.writers.stdout, text);
		}
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		if (text !== undefined) {
			writeLine(this.writers.stderr, text);
		}
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
	}

	async wrap<T>(
		promise: Promise<T>,
		options?: { readonly succeed?: string; readonly fail?: string },
	): Promise<T> {
		try {
			const value = await promise;
			this.succeed(options?.succeed);
			return value;
		} catch (error: unknown) {
			this.fail(options?.fail);
			throw error;
		}
	}
}

/**
 * Static progress handle — emits plain text at lifecycle boundaries.
 *
 * Used in non-TTY environments with `fallback: 'static'`. No animation,
 * no progress bar rendering. Emits label on start, text on done/fail.
 *
 * Terminal methods are idempotent — calling after stop is a no-op.
 *
 * @internal
 */
class StaticProgressHandle implements ProgressHandle {
	/** Whether the handle has been stopped (terminal state reached). */
	private stopped = false;

	constructor(
		label: string | undefined,
		private readonly writers: StaticWriters,
	) {
		if (label !== undefined) {
			writeLine(writers.stdout, label);
		}
	}

	increment(_n?: number): void {
		// Static mode — no incremental output.
	}

	update(_value: number): void {
		// Static mode — no incremental output.
	}

	done(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		if (text !== undefined) {
			writeLine(this.writers.stdout, text);
		}
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		if (text !== undefined) {
			writeLine(this.writers.stderr, text);
		}
	}
}

// ---------------------------------------------------------------------------
// Capture activity handles — testkit recording mode
// ---------------------------------------------------------------------------

/**
 * Spinner handle that records lifecycle events to a shared `ActivityEvent[]`.
 *
 * Used by `createCaptureOutput()` so testkit can assert on spinner behaviour
 * without polluting stdout/stderr arrays. Terminal methods are idempotent.
 *
 * @internal
 */
class CaptureSpinnerHandle implements SpinnerHandle {
	/** Whether the handle has been stopped (terminal state reached). */
	private stopped = false;

	constructor(
		text: string,
		private readonly events: ActivityEvent[],
	) {
		events.push({ type: 'spinner:start', text });
	}

	update(text: string): void {
		if (this.stopped) return;
		this.events.push({ type: 'spinner:update', text });
	}

	succeed(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.events.push({ type: 'spinner:succeed', text: text ?? '' });
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.events.push({ type: 'spinner:fail', text: text ?? '' });
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.events.push({ type: 'spinner:stop' });
	}

	async wrap<T>(
		promise: Promise<T>,
		options?: { readonly succeed?: string; readonly fail?: string },
	): Promise<T> {
		try {
			const value = await promise;
			this.succeed(options?.succeed);
			return value;
		} catch (error: unknown) {
			this.fail(options?.fail);
			throw error;
		}
	}
}

/**
 * Progress handle that records lifecycle events to a shared `ActivityEvent[]`.
 *
 * Used by `createCaptureOutput()` so testkit can assert on progress behaviour
 * without polluting stdout/stderr arrays. Terminal methods are idempotent.
 *
 * @internal
 */
class CaptureProgressHandle implements ProgressHandle {
	/** Whether the handle has been stopped (terminal state reached). */
	private stopped = false;

	constructor(
		opts: ProgressOptions,
		private readonly events: ActivityEvent[],
	) {
		events.push({ type: 'progress:start', label: opts.label ?? '', total: opts.total });
	}

	increment(n?: number): void {
		if (this.stopped) return;
		// Record as an update with the increment value (1-based convention).
		this.events.push({ type: 'progress:update', value: n ?? 1 });
	}

	update(value: number): void {
		if (this.stopped) return;
		this.events.push({ type: 'progress:update', value });
	}

	done(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.events.push({ type: 'progress:done', text });
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.events.push({ type: 'progress:fail', text });
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a message followed by a newline. */
function writeLine(write: WriteFn, message: string): void {
	write(`${message}\n`);
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

/**
 * Infer column descriptors from the keys of the first row.
 *
 * When no explicit columns are provided, all keys from the first row
 * become columns in insertion order. This is a convenience — callers
 * who need stable ordering should provide explicit columns.
 */
function inferColumns<T extends Record<string, unknown>>(
	rows: readonly T[],
): readonly TableColumn<T>[] {
	const first = rows[0];
	if (first === undefined) return [];
	return Object.keys(first).map((key) => ({ key: key as keyof T & string }));
}

/**
 * Convert a cell value to a display string.
 *
 * - `null` / `undefined` → `''`
 * - Everything else → `String(value)`
 */
function cellToString(value: unknown): string {
	if (value === null || value === undefined) return '';
	return String(value);
}

/**
 * Format rows as an aligned text table.
 *
 * Returns the full table string (without trailing newline — the caller
 * adds that via `writeLine`). Returns `''` when rows is empty.
 *
 * Column widths are computed as the max of header and all cell values.
 * Cells are left-aligned, padded with spaces. Columns are separated by
 * two spaces.
 */
function formatTable<T extends Record<string, unknown>>(
	rows: readonly T[],
	columns?: readonly TableColumn<T>[],
): string {
	if (rows.length === 0) return '';

	const cols = columns ?? inferColumns(rows);
	if (cols.length === 0) return '';

	const SEPARATOR = '  ';

	// Resolve headers
	const headers = cols.map((c) => c.header ?? c.key);

	// Convert all cells to strings
	const cellGrid: string[][] = rows.map((row) => cols.map((c) => cellToString(row[c.key])));

	// Compute column widths
	const widths: number[] = headers.map((h, i) => {
		let max = h.length;
		for (const row of cellGrid) {
			const cell = row[i];
			if (cell !== undefined && cell.length > max) {
				max = cell.length;
			}
		}
		return max;
	});

	// Build header line
	const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join(SEPARATOR);

	// Build separator line (dashes under each column)
	const separatorLine = widths.map((w) => '-'.repeat(w)).join(SEPARATOR);

	// Build data lines
	const dataLines = cellGrid.map((row) =>
		row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join(SEPARATOR),
	);

	return [headerLine, separatorLine, ...dataLines].join('\n');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an output channel.
 *
 * @param options - Optional configuration. When omitted, output is
 *   discarded (useful for silent test runs). Pass `stdout`/`stderr`
 *   writers to direct output somewhere useful.
 *
 * @example
 * ```ts
 * // Production (wired by the runtime adapter)
 * const out = createOutput({
 *   stdout: (s) => process.stdout.write(s),
 *   stderr: (s) => process.stderr.write(s),
 *   isTTY: process.stdout.isTTY === true,
 * });
 *
 * // Test (capture output)
 * const lines: string[] = [];
 * const out = createOutput({
 *   stdout: (s) => lines.push(s),
 *   stderr: (s) => lines.push(s),
 * });
 * ```
 */
function createOutput(options?: OutputOptions): Out {
	return new OutputChannel(resolveOptions(options));
}

// ---------------------------------------------------------------------------
// Test helper — captures output into arrays
// ---------------------------------------------------------------------------

/** Captured output from a `createCaptureOutput` instance. */
interface CapturedOutput {
	/**
	 * Lines written to stdout.
	 *
	 * In normal mode: `log`, `info`, and `json` output.
	 * In JSON mode: only `json` output (log/info redirected to stderr).
	 */
	readonly stdout: string[];
	/**
	 * Lines written to stderr.
	 *
	 * In normal mode: `warn` and `error` output.
	 * In JSON mode: `warn`, `error`, `log`, and `info` output.
	 */
	readonly stderr: string[];
	/**
	 * Activity events from spinner and progress handles.
	 *
	 * Captured separately from stdout/stderr to allow targeted assertions
	 * on activity lifecycle without parsing text output. Events are
	 * recorded in chronological order.
	 */
	readonly activity: ActivityEvent[];
}

/**
 * Create an output channel that captures all output into arrays.
 *
 * Useful in tests to assert on what a handler wrote without touching
 * real I/O.
 *
 * @returns A tuple of `[out, captured]` — the output channel and the
 *   captured buffers.
 *
 * @example
 * ```ts
 * const [out, captured] = createCaptureOutput();
 * out.log('hello');
 * out.warn('danger');
 * expect(captured.stdout).toEqual(['hello\n']);
 * expect(captured.stderr).toEqual(['danger\n']);
 * ```
 */
function createCaptureOutput(
	options?: Omit<OutputOptions, 'stdout' | 'stderr'>,
): [out: Out, captured: CapturedOutput] {
	const captured: CapturedOutput = { stdout: [], stderr: [], activity: [] };
	const resolved = resolveOptions({
		...options,
		stdout: (s) => captured.stdout.push(s),
		stderr: (s) => captured.stderr.push(s),
	});
	const out = new CaptureOutputChannel(resolved, captured.activity);
	return [out, captured];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
	CaptureOutputChannel,
	CaptureProgressHandle,
	CaptureSpinnerHandle,
	createCaptureOutput,
	createOutput,
	noopProgressHandle,
	noopSpinnerHandle,
	OutputChannel,
	StaticProgressHandle,
	StaticSpinnerHandle,
};
export type {
	CapturedOutput,
	OutputOptions,
	ResolvedOutputOptions,
	StaticWriters,
	Verbosity,
	WriteFn,
};
