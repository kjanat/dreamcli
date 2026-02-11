/**
 * Activity handle implementations — spinner and progress bar.
 *
 * Four tiers per activity type:
 * - **Noop** — silent, all methods no-op (jsonMode / non-TTY silent)
 * - **Static** — plain text at lifecycle boundaries (non-TTY, fallback='static')
 * - **TTY** — animated ANSI rendering (braille spinner, bar with percentage)
 * - **Capture** — records `ActivityEvent[]` for testkit assertion
 *
 * Extracted from `index.ts` to keep the main OutputChannel file focused on
 * the `Out` implementation. Depends only on `writer.ts` (leaf) and
 * `schema/command.ts` (types).
 *
 * @module dreamcli/core/output/activity
 * @internal
 */

import type {
	ActivityEvent,
	ProgressHandle,
	ProgressOptions,
	SpinnerHandle,
} from '../schema/command.js';
import type { WriteFn } from './writer.js';
import { writeLine } from './writer.js';

// ---------------------------------------------------------------------------
// Timer globals — minimal declarations for setInterval/clearInterval.
//
// The project targets ES2022 without DOM or Node lib typings. Timer APIs
// are universally available across Node, Bun, Deno, and browsers, but the
// type checker doesn't know about them. Declaring the subset we need here
// avoids adding `@types/node` as a dependency.
// ---------------------------------------------------------------------------

declare function setInterval(callback: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;

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
		private readonly write: WriteFn,
	) {
		writeLine(write, text);
	}

	update(_text: string): void {
		// Static mode — no update output (no terminal to overwrite).
	}

	succeed(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		if (text !== undefined) {
			writeLine(this.write, text);
		}
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		if (text !== undefined) {
			writeLine(this.write, text);
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
		private readonly write: WriteFn,
	) {
		if (label !== undefined) {
			writeLine(write, label);
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
			writeLine(this.write, text);
		}
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		if (text !== undefined) {
			writeLine(this.write, text);
		}
	}
}

// ---------------------------------------------------------------------------
// ANSI escape sequences
// ---------------------------------------------------------------------------

/** Hide the terminal cursor. @internal */
const HIDE_CURSOR = '\x1b[?25l';

/** Show the terminal cursor. @internal */
const SHOW_CURSOR = '\x1b[?25h';

/** Erase the entire current line. @internal */
const ERASE_LINE = '\x1b[2K';

/**
 * Braille-dot spinner frames.
 *
 * Provides smooth animation across most terminal emulators. The 10-frame
 * sequence completes a full rotation of the braille clock pattern.
 *
 * @internal
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** @internal */ const SPINNER_INTERVAL_MS = 80;

/** Success symbol for terminal output. @internal */
const CHECK = '✓';

/** Failure symbol for terminal output. @internal */
const CROSS = '✗';

/** Filled segment of a progress bar. @internal */
const BAR_FILLED = '█';

/** Empty segment of a progress bar. @internal */
const BAR_EMPTY = '░';

/** Width of the progress bar in characters. @internal */
const BAR_WIDTH = 20;

/** Pulse width for indeterminate progress (number of filled segments). @internal */
const PULSE_WIDTH = 3;

/** Animation interval for indeterminate progress pulse (ms). @internal */
const PULSE_INTERVAL_MS = 80;

// ---------------------------------------------------------------------------
// TTY activity handles — animated mode (isTTY && !jsonMode)
// ---------------------------------------------------------------------------

/**
 * TTY spinner handle — animated braille frames with ANSI line overwrite.
 *
 * Used in TTY environments (non-JSON mode). Renders a spinning indicator
 * with configurable text, using `\r` + erase-line to overwrite in place.
 * Hides the cursor during animation and restores it on any terminal method.
 *
 * Terminal methods (`succeed`, `fail`, `stop`) are idempotent — calling any
 * of them after the handle is already stopped is a no-op.
 *
 * **Note:** If the process exits abnormally (e.g. `SIGKILL`) while a spinner
 * is active, the cursor may remain hidden. Use {@link SpinnerHandle.wrap} to
 * ensure cleanup on both success and failure paths.
 *
 * @internal
 */
class TTYSpinnerHandle implements SpinnerHandle {
	/** Whether the handle has been stopped (terminal state reached). */
	private stopped = false;
	/** Animation timer handle — cleared on any terminal method. */
	private timer: unknown;
	/** Current position in the braille frame sequence. */
	private frameIndex = 0;
	/** Current spinner text (mutable via `update()`). */
	private text: string;

	constructor(
		text: string,
		private readonly write: WriteFn,
	) {
		this.text = text;
		write(HIDE_CURSOR);
		this.render();
		this.timer = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
			this.render();
		}, SPINNER_INTERVAL_MS);
	}

	/** Render the current frame + text, overwriting the current line. */
	private render(): void {
		this.write(`\r${ERASE_LINE}${SPINNER_FRAMES[this.frameIndex]} ${this.text}`);
	}

	/** Clear the animation timer, erase the line, and restore the cursor. */
	private cleanup(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.write(`\r${ERASE_LINE}${SHOW_CURSOR}`);
	}

	update(text: string): void {
		if (this.stopped) return;
		this.text = text;
		// Render immediately so the text change is visible before the next frame.
		this.render();
	}

	succeed(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.cleanup();
		if (text !== undefined) {
			writeLine(this.write, `${CHECK} ${text}`);
		}
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.cleanup();
		if (text !== undefined) {
			writeLine(this.write, `${CROSS} ${text}`);
		}
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.cleanup();
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
 * TTY progress handle — bar rendering with ANSI line overwrite.
 *
 * Supports two modes:
 * - **Determinate** (`total` provided) — renders `[████░░░░░░] 40% label`,
 *   re-rendered on each `increment()` / `update()` call. No timer.
 * - **Indeterminate** (`total` omitted) — renders a pulsing highlight that
 *   bounces across the bar via `setInterval`.
 *
 * Terminal methods (`done`, `fail`) are idempotent — calling any of them
 * after the handle is already stopped is a no-op.
 *
 * @internal
 */
class TTYProgressHandle implements ProgressHandle {
	/** Whether the handle has been stopped (terminal state reached). */
	private stopped = false;
	/** Animation timer for indeterminate mode — `undefined` in determinate mode. */
	private timer: unknown;
	/** Current progress value (units completed). */
	private current = 0;
	/** Total units of work (`undefined` = indeterminate mode). */
	private readonly total: number | undefined;
	/** Label displayed alongside the bar. */
	private readonly label: string;
	/** Pulse position for indeterminate animation (bouncing highlight). */
	private pulsePos = 0;
	/** Pulse direction: 1 = forward, -1 = backward (for bounce). */
	private pulseDir: 1 | -1 = 1;

	constructor(
		opts: ProgressOptions,
		private readonly write: WriteFn,
	) {
		this.total = opts.total;
		this.label = opts.label ?? '';
		write(HIDE_CURSOR);
		this.render();

		// Only start animation timer for indeterminate mode.
		if (this.total === undefined) {
			this.timer = setInterval(() => {
				this.advancePulse();
				this.render();
			}, PULSE_INTERVAL_MS);
		}
	}

	/** Advance the indeterminate pulse position with bounce logic. */
	private advancePulse(): void {
		this.pulsePos += this.pulseDir;
		// Bounce at boundaries: when the rightmost lit segment would exceed the bar.
		if (this.pulsePos + PULSE_WIDTH > BAR_WIDTH) {
			this.pulseDir = -1;
			this.pulsePos = BAR_WIDTH - PULSE_WIDTH;
		} else if (this.pulsePos < 0) {
			this.pulseDir = 1;
			this.pulsePos = 0;
		}
	}

	/** Render the progress bar, overwriting the current line. */
	private render(): void {
		const bar = this.total !== undefined ? this.renderDeterminate() : this.renderIndeterminate();
		const suffix = this.label.length > 0 ? ` ${this.label}` : '';
		this.write(`\r${ERASE_LINE}${bar}${suffix}`);
	}

	/** Render a determinate bar: `[████░░░░░░] 40%`. */
	private renderDeterminate(): string {
		const total = this.total as number; // guarded by caller
		const ratio = total > 0 ? Math.min(this.current / total, 1) : 0;
		const filled = Math.round(ratio * BAR_WIDTH);
		const empty = BAR_WIDTH - filled;
		const pct = Math.round(ratio * 100);
		return `[${BAR_FILLED.repeat(filled)}${BAR_EMPTY.repeat(empty)}] ${String(pct)}%`;
	}

	/** Render an indeterminate bar: pulsing highlight bouncing across empty segments. */
	private renderIndeterminate(): string {
		let bar = '';
		for (let i = 0; i < BAR_WIDTH; i++) {
			bar += i >= this.pulsePos && i < this.pulsePos + PULSE_WIDTH ? BAR_FILLED : BAR_EMPTY;
		}
		return `[${bar}]`;
	}

	/** Clear the animation timer, erase the line, and restore the cursor. */
	private cleanup(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.write(`\r${ERASE_LINE}${SHOW_CURSOR}`);
	}

	increment(n?: number): void {
		if (this.stopped) return;
		this.current += n ?? 1;
		this.render();
	}

	update(value: number): void {
		if (this.stopped) return;
		this.current = value;
		this.render();
	}

	done(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.cleanup();
		if (text !== undefined) {
			writeLine(this.write, `${CHECK} ${text}`);
		}
	}

	fail(text?: string): void {
		if (this.stopped) return;
		this.stopped = true;
		this.cleanup();
		if (text !== undefined) {
			writeLine(this.write, `${CROSS} ${text}`);
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
		this.events.push({ type: 'progress:increment', delta: n ?? 1 });
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
// Exports
// ---------------------------------------------------------------------------

export {
	CaptureProgressHandle,
	CaptureSpinnerHandle,
	noopProgressHandle,
	noopSpinnerHandle,
	StaticProgressHandle,
	StaticSpinnerHandle,
	TTYProgressHandle,
	TTYSpinnerHandle,
};
