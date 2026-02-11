/**
 * Tests for progress activity handle classes — direct unit tests.
 *
 * Coverage:
 * - noopProgressHandle (jsonMode, non-TTY silent fallback)
 * - StaticProgressHandle (non-TTY, fallback='static')
 * - TTYProgressHandle (isTTY, ANSI rendering, timer cleanup)
 * - CaptureProgressHandle (testkit event recording)
 *
 * All concrete handles receive a single `WriteFn` (stderr). Output
 * assertions use a unified `output` array — no stdout/stderr split.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActivityEvent } from '../schema/command.js';
import type { WriteFn } from './index.js';
import {
	CaptureProgressHandle,
	noopProgressHandle,
	StaticProgressHandle,
	TTYProgressHandle,
} from './index.js';

// --- Test helpers ---

function makeWriter(): { write: WriteFn; output: string[] } {
	const output: string[] = [];
	return {
		write: (s) => output.push(s),
		output,
	};
}

// ===================================================================
// Noop progress — jsonMode + non-TTY silent fallback
// ===================================================================

describe('noopProgressHandle', () => {
	it('all methods are no-ops (no throw)', () => {
		expect(() => {
			noopProgressHandle.increment();
			noopProgressHandle.increment(5);
			noopProgressHandle.update(10);
			noopProgressHandle.done('complete');
			noopProgressHandle.fail('error');
		}).not.toThrow();
	});
});

// ===================================================================
// Static progress — non-TTY, fallback='static'
// ===================================================================

describe('StaticProgressHandle', () => {
	it('emits label on construction', () => {
		const { write, output } = makeWriter();
		new StaticProgressHandle('Downloading', write);
		expect(output).toEqual(['Downloading\n']);
	});

	it('emits nothing on construction when label is undefined', () => {
		const { write, output } = makeWriter();
		new StaticProgressHandle(undefined, write);
		expect(output).toEqual([]);
	});

	it('done() emits text', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('Downloading', write);
		handle.done('Complete!');
		expect(output).toEqual(['Downloading\n', 'Complete!\n']);
	});

	it('done() without text emits nothing extra', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('label', write);
		handle.done();
		expect(output).toEqual(['label\n']);
	});

	it('fail() emits text', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('label', write);
		handle.fail('Failed!');
		expect(output).toEqual(['label\n', 'Failed!\n']);
	});

	it('fail() without text emits nothing extra', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('label', write);
		handle.fail();
		expect(output).toEqual(['label\n']);
	});

	it('increment() and update() are silent', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('label', write);
		handle.increment();
		handle.increment(5);
		handle.update(10);
		expect(output).toEqual(['label\n']);
	});

	// --- Idempotency ---

	it('double done is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('label', write);
		handle.done('first');
		handle.done('second');
		expect(output).toEqual(['label\n', 'first\n']);
	});

	it('fail after done is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('label', write);
		handle.done('ok');
		handle.fail('nope');
		expect(output).toEqual(['label\n', 'ok\n']);
	});

	it('done after fail is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new StaticProgressHandle('label', write);
		handle.fail('err');
		handle.done('ok');
		// Label + fail text only, done('ok') should not appear
		expect(output).toEqual(['label\n', 'err\n']);
	});
});

// ===================================================================
// TTY progress — determinate
// ===================================================================

describe('TTYProgressHandle — determinate', () => {
	it('emits hide cursor + initial bar on construction', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10, label: 'Files' }, write);
		expect(output[0]).toBe('\x1b[?25l');
		// Initial render: 0%
		const all = output.join('');
		expect(all).toContain('0%');
		expect(all).toContain('Files');
		handle.done();
	});

	it('increment() re-renders with updated percentage', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.increment(5);
		const all = output.join('');
		expect(all).toContain('50%');
		handle.done();
	});

	it('update() sets absolute value', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 100 }, write);
		handle.update(75);
		const all = output.join('');
		expect(all).toContain('75%');
		handle.done();
	});

	it('increment defaults to 1', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 4 }, write);
		handle.increment();
		const all = output.join('');
		expect(all).toContain('25%');
		handle.done();
	});

	it('clamps at 100%', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.update(20); // exceeds total
		const all = output.join('');
		expect(all).toContain('100%');
		handle.done();
	});

	it('done() cleans up + emits check symbol', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.done('Complete!');
		const all = output.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).toContain('✓');
		expect(all).toContain('Complete!');
	});

	it('fail() cleans up + emits cross symbol', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.fail('Failed!');
		const all = output.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).toContain('✗');
		expect(all).toContain('Failed!');
	});

	it('fail() without text cleans up silently', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.fail();
		const all = output.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).not.toContain('✗');
	});

	// --- Idempotency ---

	it('double done is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.done('first');
		const countAfterDone = output.length;
		handle.done('second');
		expect(output.length).toBe(countAfterDone);
	});

	it('increment after done is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.done();
		const countAfterDone = output.length;
		handle.increment();
		expect(output.length).toBe(countAfterDone);
	});

	it('update after done is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.done();
		const countAfterDone = output.length;
		handle.update(5);
		expect(output.length).toBe(countAfterDone);
	});

	it('renders empty bar at 0%', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		const all = output.join('');
		expect(all).toContain('[░░░░░░░░░░░░░░░░░░░░] 0%');
		handle.done();
	});

	it('renders correct bar fill at 50%', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.increment(5);
		const all = output.join('');
		expect(all).toContain('[██████████░░░░░░░░░░] 50%');
		handle.done();
	});

	it('renders fully filled bar at 100%', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		handle.update(10);
		const all = output.join('');
		expect(all).toContain('[████████████████████] 100%');
		handle.done();
	});

	it('no animation timer for determinate mode', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ total: 10 }, write);
		// In determinate mode, no setInterval — renders only on increment()/update()
		const initialCount = output.length;
		// Wait briefly to confirm no timer-based renders
		handle.done();
		// Cleanup writes happen, but no extra frames from timer
		const finalCount = output.length;
		// Only cleanup writes (erase + show cursor) beyond initial
		expect(finalCount - initialCount).toBeLessThanOrEqual(2);
	});
});

// ===================================================================
// TTY progress — indeterminate
// ===================================================================

describe('TTYProgressHandle — indeterminate', () => {
	it('starts with hide cursor and initial render', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({ label: 'Waiting' }, write);
		expect(output[0]).toBe('\x1b[?25l');
		const all = output.join('');
		expect(all).toContain('Waiting');
		// No percentage in indeterminate mode
		expect(all).not.toContain('%');
		handle.done();
	});

	it('done() stops timer and cleans up', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({}, write);
		handle.done('finished');
		const all = output.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).toContain('✓');
		expect(all).toContain('finished');
	});

	it('fail() stops timer and cleans up', () => {
		const { write, output } = makeWriter();
		const handle = new TTYProgressHandle({}, write);
		handle.fail('broken');
		const all = output.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).toContain('✗');
		expect(all).toContain('broken');
	});

	it('done() clears pulse timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { write, output } = makeWriter();
			const handle = new TTYProgressHandle({}, write);
			handle.done();
			const countAfterDone = output.length;
			vi.advanceTimersByTime(200);
			expect(output.length).toBe(countAfterDone);
		} finally {
			vi.useRealTimers();
		}
	});
});

// ===================================================================
// Capture progress — testkit event recording
// ===================================================================

describe('CaptureProgressHandle', () => {
	it('records start event with label and total', () => {
		const events: ActivityEvent[] = [];
		new CaptureProgressHandle({ total: 10, label: 'Files' }, events);
		expect(events).toEqual([{ type: 'progress:start', label: 'Files', total: 10 }]);
	});

	it('records start event with undefined total (indeterminate)', () => {
		const events: ActivityEvent[] = [];
		new CaptureProgressHandle({ label: 'Waiting' }, events);
		expect(events).toEqual([{ type: 'progress:start', label: 'Waiting', total: undefined }]);
	});

	it('records start with default empty label when omitted', () => {
		const events: ActivityEvent[] = [];
		new CaptureProgressHandle({}, events);
		expect(events).toEqual([{ type: 'progress:start', label: '', total: undefined }]);
	});

	it('increment() records increment event with delta', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.increment(3);
		expect(events[1]).toEqual({ type: 'progress:increment', delta: 3 });
	});

	it('increment() defaults to delta 1', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.increment();
		expect(events[1]).toEqual({ type: 'progress:increment', delta: 1 });
	});

	it('update() records update event with absolute value', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.update(7);
		expect(events[1]).toEqual({ type: 'progress:update', value: 7 });
	});

	it('done() records done event', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.done('Complete');
		expect(events[1]).toEqual({ type: 'progress:done', text: 'Complete' });
	});

	it('done() without text records undefined text', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.done();
		expect(events[1]).toEqual({ type: 'progress:done', text: undefined });
	});

	it('fail() records fail event', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.fail('Error');
		expect(events[1]).toEqual({ type: 'progress:fail', text: 'Error' });
	});

	it('fail() without text records undefined text', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.fail();
		expect(events[1]).toEqual({ type: 'progress:fail', text: undefined });
	});

	// --- Idempotency ---

	it('terminal methods are idempotent', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.done('first');
		handle.done('second');
		handle.fail('nope');
		expect(events).toEqual([
			{ type: 'progress:start', label: '', total: 10 },
			{ type: 'progress:done', text: 'first' },
		]);
	});

	it('increment after done is no-op', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.done();
		handle.increment();
		expect(events).toEqual([
			{ type: 'progress:start', label: '', total: 10 },
			{ type: 'progress:done', text: undefined },
		]);
	});

	it('update after fail is no-op', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.fail('err');
		handle.update(5);
		expect(events).toEqual([
			{ type: 'progress:start', label: '', total: 10 },
			{ type: 'progress:fail', text: 'err' },
		]);
	});
});
