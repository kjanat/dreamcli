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
	ProgressHandle,
	ProgressOptions,
	SpinnerHandle,
	SpinnerOptions,
	TableColumn,
	TableOptions,
} from '#internals/core/schema/activity.ts';
import type { Out } from '#internals/core/schema/command.ts';
import {
	CaptureProgressHandle,
	CaptureSpinnerHandle,
	noopProgressHandle,
	noopSpinnerHandle,
	StaticProgressHandle,
	StaticSpinnerHandle,
	TTYProgressHandle,
	TTYSpinnerHandle,
} from './activity.ts';
import { formatDisplayValue } from './display-value.ts';
import type { WriteFn } from './writer.ts';
import { writeLine } from './writer.ts';

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
 * Prefer {@link createOutput} unless you are extending the output layer.
 *
 * @internal
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
	 * Default behavior matches the current output mode:
	 * - normal mode → text table to stdout
	 * - jsonMode → JSON array to stdout
	 *
	 * Per-call options can force text/json rendering and route text tables to
	 * stdout or stderr.
	 */
	table<T extends Record<string, unknown>>(rows: readonly T[], options: TableOptions): void;
	table<T extends Record<string, unknown>>(
		rows: readonly T[],
		columns?: readonly TableColumn<T>[],
		options?: TableOptions,
	): void;
	table<T extends Record<string, unknown>>(
		rows: readonly T[],
		columnsOrOptions?: readonly TableColumn<T>[] | TableOptions,
		options?: TableOptions,
	): void {
		const { columns, options: tableOptions } = resolveTableArgs(columnsOrOptions, options);
		const format = resolveTableFormat(this.options.jsonMode, tableOptions);

		if (format === 'json') {
			this.json(rows);
			return;
		}

		const text = formatTable(rows, columns);
		if (text.length === 0) return;

		writeLine(resolveTextTableWriter(this.options, format, tableOptions), text);
	}

	// ----- Active handle tracking -----
	//
	// At most one spinner or progress handle may be active at a time. When a
	// new one is created while another is running, the previous one is
	// implicitly stopped to avoid garbled terminal output.

	/**
	 * Cleanup callback for the currently active spinner/progress handle.
	 *
	 * Set to `undefined` when no handle is active. The callback calls the
	 * appropriate terminal method (`.stop()` for spinners, `.done()` for
	 * progress) on the previous handle.
	 *
	 * @internal
	 */
	private activeCleanup: (() => void) | undefined;

	/**
	 * Stop the currently active spinner/progress handle (if any).
	 *
	 * Called internally before creating a new handle to prevent overlap,
	 * and externally after handler execution to clean up leaked timers.
	 * Idempotent (safe to call when no handle is active).
	 */
	stopActive(): void {
		if (this.activeCleanup !== undefined) {
			this.activeCleanup();
			this.activeCleanup = undefined;
		}
	}

	/**
	 * Create a spinner handle.
	 *
	 * Mode dispatch:
	 * - `jsonMode` → noop (structured output only, spinners suppressed)
	 * - `isTTY` → animated TTY spinner (braille frames, ANSI overwrite)
	 * - `!isTTY && fallback: 'static'` → plain text at lifecycle boundaries
	 * - `!isTTY && fallback: 'silent'` (default) → noop
	 *
	 * All activity output (transient frames, terminal messages) routes to
	 * stderr so stdout remains clean for structured data and piping.
	 *
	 * If another spinner or progress handle is active, it is implicitly
	 * stopped before the new one starts.
	 */
	spinner(text: string, options?: SpinnerOptions): SpinnerHandle {
		const fallback = options?.fallback ?? 'silent';

		// JSON mode: always suppress activity indicators.
		if (this.options.jsonMode) {
			return noopSpinnerHandle;
		}

		// Non-TTY, silent fallback: noop.
		if (!this.options.isTTY && fallback === 'silent') {
			return noopSpinnerHandle;
		}

		// Stop any active handle before creating a new one.
		this.stopActive();

		if (this.options.isTTY) {
			const handle = new TTYSpinnerHandle(text, this.options.stderr);
			this.activeCleanup = () => handle.stop();
			return handle;
		}

		// Non-TTY, static fallback.
		const handle = new StaticSpinnerHandle(text, this.options.stderr);
		this.activeCleanup = () => handle.stop();
		return handle;
	}

	/**
	 * Create a progress handle.
	 *
	 * Mode dispatch:
	 * - `jsonMode` → noop (structured output only, progress suppressed)
	 * - `isTTY` → animated TTY progress bar (determinate or indeterminate)
	 * - `!isTTY && fallback: 'static'` → plain text at lifecycle boundaries
	 * - `!isTTY && fallback: 'silent'` (default) → noop
	 *
	 * All activity output (transient frames, terminal messages) routes to
	 * stderr so stdout remains clean for structured data and piping.
	 *
	 * If another spinner or progress handle is active, it is implicitly
	 * stopped before the new one starts.
	 */
	progress(opts: ProgressOptions): ProgressHandle {
		const fallback = opts.fallback ?? 'silent';

		// JSON mode: always suppress activity indicators.
		if (this.options.jsonMode) {
			return noopProgressHandle;
		}

		// Non-TTY, silent fallback: noop.
		if (!this.options.isTTY && fallback === 'silent') {
			return noopProgressHandle;
		}

		// Stop any active handle before creating a new one.
		this.stopActive();

		if (this.options.isTTY) {
			const handle = new TTYProgressHandle(opts, this.options.stderr);
			this.activeCleanup = () => handle.done();
			return handle;
		}

		// Non-TTY, static fallback.
		const handle = new StaticProgressHandle(opts.label, this.options.stderr);
		this.activeCleanup = () => handle.done();
		return handle;
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

function isTableColumns<T extends Record<string, unknown>>(
	value: readonly TableColumn<T>[] | TableOptions | undefined,
): value is readonly TableColumn<T>[] {
	return Array.isArray(value);
}

function resolveTableArgs<T extends Record<string, unknown>>(
	columnsOrOptions?: readonly TableColumn<T>[] | TableOptions,
	options?: TableOptions,
): {
	readonly columns: readonly TableColumn<T>[] | undefined;
	readonly options: TableOptions | undefined;
} {
	if (options !== undefined) {
		return {
			columns: isTableColumns(columnsOrOptions) ? columnsOrOptions : undefined,
			options,
		};
	}

	if (isTableColumns(columnsOrOptions)) {
		return { columns: columnsOrOptions, options };
	}

	return { columns: undefined, options: columnsOrOptions };
}

function resolveTableFormat(jsonMode: boolean, options?: TableOptions): 'text' | 'json' {
	switch (options?.format) {
		case 'json':
			return 'json';
		case 'text':
			return 'text';
		case 'auto':
		case undefined:
			return jsonMode ? 'json' : 'text';
	}
}

function resolveTextTableWriter(
	options: ResolvedOutputOptions,
	format: 'text' | 'json',
	tableOptions?: TableOptions,
): WriteFn {
	if (
		format === 'text' &&
		tableOptions !== undefined &&
		'stream' in tableOptions &&
		tableOptions.stream !== undefined
	) {
		return tableOptions.stream === 'stderr' ? options.stderr : options.stdout;
	}

	return options.jsonMode ? options.stderr : options.stdout;
}

/**
 * Convert a cell value to a display string.
 *
 * - `null` / `undefined` → `''`
 * - Primitives → `String(value)`
 * - Objects / arrays → JSON
 */
function cellToString(value: unknown): string {
	return formatDisplayValue(value);
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
 * Low-level factory: action handlers already receive `out` automatically from
 * `cli()`, `.execute()`, and `runCommand()`. Call `createOutput()` when you
 * are embedding DreamCLI primitives into a custom runtime or need a standalone
 * output implementation outside the normal command pipeline.
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

export type { CapturedOutput, OutputOptions, ResolvedOutputOptions, Verbosity, WriteFn };
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
	TTYProgressHandle,
	TTYSpinnerHandle,
	writeLine,
};
