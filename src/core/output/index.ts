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

import type { Out } from '../schema/command.js';

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

	constructor(options: ResolvedOutputOptions) {
		this.options = options;
		this.jsonMode = options.jsonMode;
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a message followed by a newline. */
function writeLine(write: WriteFn, message: string): void {
	write(`${message}\n`);
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
	const captured: CapturedOutput = { stdout: [], stderr: [] };
	const out = createOutput({
		...options,
		stdout: (s) => captured.stdout.push(s),
		stderr: (s) => captured.stderr.push(s),
	});
	return [out, captured];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createCaptureOutput, createOutput, OutputChannel };
export type { CapturedOutput, OutputOptions, ResolvedOutputOptions, Verbosity, WriteFn };
