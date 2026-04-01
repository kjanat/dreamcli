/**
 * Activity types — spinner and progress bar handles, options, events.
 *
 * These types define the contract for `Out.spinner()` and `Out.progress()`
 * lifecycle management. Implementations live in `core/output/activity.ts`.
 *
 * @module dreamcli/core/schema/activity
 */

// ---------------------------------------------------------------------------
// Fallback strategy
// ---------------------------------------------------------------------------

/**
 * Non-TTY fallback strategy for spinners and progress bars.
 *
 * - `'silent'` — no output at all (default). Ideal for CI where decorative
 *   output is noise.
 * - `'static'` — emit plain text via `out.log()` / `out.error()` at
 *   lifecycle boundaries (start, succeed, fail). No animation.
 */
type Fallback = 'silent' | 'static';

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

/** Options for {@link Out.spinner}. */
interface SpinnerOptions {
	/** Fallback strategy when `!isTTY` or `jsonMode`. Defaults to `'silent'`. */
	readonly fallback?: Fallback;
}

/**
 * Handle returned by {@link Out.spinner} for lifecycle control.
 *
 * Terminal methods (`succeed`, `fail`, `stop`) are idempotent — calling any
 * of them after the handle is already stopped is a no-op, not an error.
 */
interface SpinnerHandle {
	/** Update the spinner text (no-op if stopped). */
	update(text: string): void;
	/** Stop with a success symbol and optional final text. */
	succeed(text?: string): void;
	/** Stop with a failure symbol and optional final text. */
	fail(text?: string): void;
	/** Stop the spinner without a status symbol. */
	stop(): void;
	/**
	 * Wrap a promise: auto-succeed on resolve, auto-fail on reject.
	 *
	 * @returns The resolved value of the wrapped promise.
	 */
	wrap<T>(
		promise: Promise<T>,
		options?: {
			readonly succeed?: string;
			readonly fail?: string;
		},
	): Promise<T>;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Options for {@link Out.progress}. */
interface ProgressOptions {
	/**
	 * Total units of work. When provided, the bar shows a determinate
	 * percentage. When omitted, the bar pulses in indeterminate mode.
	 */
	readonly total?: number;
	/** Label displayed alongside the progress bar. */
	readonly label?: string;
	/** Fallback strategy when `!isTTY` or `jsonMode`. Defaults to `'silent'`. */
	readonly fallback?: Fallback;
}

/**
 * Handle returned by {@link Out.progress} for lifecycle control.
 *
 * Terminal methods (`done`, `fail`) are idempotent — calling any
 * of them after the handle is already stopped is a no-op.
 */
interface ProgressHandle {
	/** Advance progress by `n` units (default 1). */
	increment(n?: number): void;
	/** Set progress to an absolute value. */
	update(value: number): void;
	/** Mark progress as complete with an optional final message. */
	done(text?: string): void;
	/** Mark progress as failed with an optional final message. */
	fail(text?: string): void;
}

// ---------------------------------------------------------------------------
// Activity events
// ---------------------------------------------------------------------------

/**
 * Discriminated union of spinner and progress lifecycle events.
 *
 * Captured by testkit in {@link RunResult.activity} for assertion
 * without polluting stdout/stderr arrays.
 */
type ActivityEvent =
	| { readonly type: 'spinner:start'; readonly text: string }
	| { readonly type: 'spinner:update'; readonly text: string }
	| { readonly type: 'spinner:succeed'; readonly text: string }
	| { readonly type: 'spinner:fail'; readonly text: string }
	| { readonly type: 'spinner:stop' }
	| { readonly type: 'progress:start'; readonly label: string; readonly total: number | undefined }
	| { readonly type: 'progress:increment'; readonly delta: number }
	| { readonly type: 'progress:update'; readonly value: number }
	| { readonly type: 'progress:done'; readonly text: string | undefined }
	| { readonly type: 'progress:fail'; readonly text: string | undefined };

// ---------------------------------------------------------------------------
// Table column descriptor
// ---------------------------------------------------------------------------

/**
 * Describes a single column in table output.
 *
 * @typeParam T - The row object type (inferred from the rows array).
 */
interface TableColumn<T extends Record<string, unknown>> {
	/** Property key on the row objects to display in this column. */
	readonly key: keyof T & string;
	/**
	 * Header label for the column.
	 * Defaults to the `key` value when omitted.
	 */
	readonly header?: string;
}

/** Render format override for {@link Out.table}. */
type TableFormat = 'auto' | 'text' | 'json';

/** Output stream override for text table rendering. */
type TableStream = 'stdout' | 'stderr';

/**
 * Per-call table output options.
 *
 * `format: 'auto'` preserves the current mode-dependent behavior.
 * `format: 'json'` always emits a JSON array to stdout.
 * `format: 'text'` always renders a human-readable table; when `stream` is
 * omitted, text defaults to stdout in normal mode and stderr in jsonMode.
 */
type TableOptions =
	| { readonly format?: 'auto' }
	| { readonly format: 'json' }
	| { readonly format: 'text'; readonly stream?: TableStream };

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type {
	ActivityEvent,
	Fallback,
	ProgressHandle,
	ProgressOptions,
	SpinnerHandle,
	SpinnerOptions,
	TableColumn,
	TableFormat,
	TableOptions,
	TableStream,
};
