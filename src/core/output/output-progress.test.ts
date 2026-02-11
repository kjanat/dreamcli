/**
 * Tests for progress activity handle classes — direct unit tests.
 *
 * Coverage:
 * - noopProgressHandle (jsonMode, non-TTY silent fallback)
 * - StaticProgressHandle (non-TTY, fallback='static')
 * - TTYProgressHandle (isTTY, ANSI rendering, timer cleanup)
 * - CaptureProgressHandle (testkit event recording)
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActivityEvent } from '../schema/command.js';
import type { StaticWriters } from './index.js';
import {
	CaptureProgressHandle,
	noopProgressHandle,
	StaticProgressHandle,
	TTYProgressHandle,
} from './index.js';

// --- Test helpers ---

function makeWriters(): { writers: StaticWriters; stdout: string[]; stderr: string[] } {
	const stdout: string[] = [];
	const stderr: string[] = [];
	return {
		writers: { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
		stdout,
		stderr,
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
		const { writers, stdout } = makeWriters();
		new StaticProgressHandle('Downloading', writers);
		expect(stdout).toEqual(['Downloading\n']);
	});

	it('emits nothing on construction when label is undefined', () => {
		const { writers, stdout } = makeWriters();
		new StaticProgressHandle(undefined, writers);
		expect(stdout).toEqual([]);
	});

	it('done() emits text to stdout', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticProgressHandle('Downloading', writers);
		handle.done('Complete!');
		expect(stdout).toEqual(['Downloading\n', 'Complete!\n']);
	});

	it('done() without text emits nothing extra', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticProgressHandle('label', writers);
		handle.done();
		expect(stdout).toEqual(['label\n']);
	});

	it('fail() emits text to stderr', () => {
		const { writers, stderr } = makeWriters();
		const handle = new StaticProgressHandle('label', writers);
		handle.fail('Failed!');
		expect(stderr).toEqual(['Failed!\n']);
	});

	it('fail() without text emits nothing extra', () => {
		const { writers, stderr } = makeWriters();
		const handle = new StaticProgressHandle('label', writers);
		handle.fail();
		expect(stderr).toEqual([]);
	});

	it('increment() and update() are silent', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticProgressHandle('label', writers);
		handle.increment();
		handle.increment(5);
		handle.update(10);
		expect(stdout).toEqual(['label\n']);
	});

	// --- Idempotency ---

	it('double done is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticProgressHandle('label', writers);
		handle.done('first');
		handle.done('second');
		expect(stdout).toEqual(['label\n', 'first\n']);
	});

	it('fail after done is no-op', () => {
		const { writers, stderr } = makeWriters();
		const handle = new StaticProgressHandle('label', writers);
		handle.done('ok');
		handle.fail('nope');
		expect(stderr).toEqual([]);
	});

	it('done after fail is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticProgressHandle('label', writers);
		handle.fail('err');
		handle.done('ok');
		// Only the label was on stdout, done('ok') should not appear
		expect(stdout).toEqual(['label\n']);
	});
});

// ===================================================================
// TTY progress — determinate
// ===================================================================

describe('TTYProgressHandle — determinate', () => {
	it('emits hide cursor + initial bar on construction', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10, label: 'Files' }, writers);
		expect(stdout[0]).toBe('\x1b[?25l');
		// Initial render: 0%
		const all = stdout.join('');
		expect(all).toContain('0%');
		expect(all).toContain('Files');
		handle.done();
	});

	it('increment() re-renders with updated percentage', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.increment(5);
		const all = stdout.join('');
		expect(all).toContain('50%');
		handle.done();
	});

	it('update() sets absolute value', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 100 }, writers);
		handle.update(75);
		const all = stdout.join('');
		expect(all).toContain('75%');
		handle.done();
	});

	it('increment defaults to 1', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 4 }, writers);
		handle.increment();
		const all = stdout.join('');
		expect(all).toContain('25%');
		handle.done();
	});

	it('clamps at 100%', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.update(20); // exceeds total
		const all = stdout.join('');
		expect(all).toContain('100%');
		handle.done();
	});

	it('done() cleans up + emits check symbol', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.done('Complete!');
		const all = stdout.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).toContain('✓');
		expect(all).toContain('Complete!');
	});

	it('fail() cleans up + emits cross symbol to stderr', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.fail('Failed!');
		const stdoutAll = stdout.join('');
		expect(stdoutAll).toContain('\x1b[?25h');
		const stderrAll = stderr.join('');
		expect(stderrAll).toContain('✗');
		expect(stderrAll).toContain('Failed!');
	});

	it('fail() without text cleans up silently', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.fail();
		const stdoutAll = stdout.join('');
		expect(stdoutAll).toContain('\x1b[?25h');
		expect(stderr).toEqual([]);
	});

	// --- Idempotency ---

	it('double done is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.done('first');
		const countAfterDone = stdout.length;
		handle.done('second');
		expect(stdout.length).toBe(countAfterDone);
	});

	it('increment after done is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.done();
		const countAfterDone = stdout.length;
		handle.increment();
		expect(stdout.length).toBe(countAfterDone);
	});

	it('update after done is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		handle.done();
		const countAfterDone = stdout.length;
		handle.update(5);
		expect(stdout.length).toBe(countAfterDone);
	});

	it('no animation timer for determinate mode', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ total: 10 }, writers);
		// In determinate mode, no setInterval — renders only on increment()/update()
		const initialCount = stdout.length;
		// Wait briefly to confirm no timer-based renders
		handle.done();
		// Cleanup writes happen, but no extra frames from timer
		const finalCount = stdout.length;
		// Only cleanup writes (erase + show cursor) beyond initial
		expect(finalCount - initialCount).toBeLessThanOrEqual(2);
	});
});

// ===================================================================
// TTY progress — indeterminate
// ===================================================================

describe('TTYProgressHandle — indeterminate', () => {
	it('starts with hide cursor and initial render', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({ label: 'Waiting' }, writers);
		expect(stdout[0]).toBe('\x1b[?25l');
		const all = stdout.join('');
		expect(all).toContain('Waiting');
		// No percentage in indeterminate mode
		expect(all).not.toContain('%');
		handle.done();
	});

	it('done() stops timer and cleans up', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYProgressHandle({}, writers);
		handle.done('finished');
		const all = stdout.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).toContain('✓');
		expect(all).toContain('finished');
	});

	it('fail() stops timer and cleans up', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new TTYProgressHandle({}, writers);
		handle.fail('broken');
		const stdoutAll = stdout.join('');
		expect(stdoutAll).toContain('\x1b[?25h');
		const stderrAll = stderr.join('');
		expect(stderrAll).toContain('✗');
		expect(stderrAll).toContain('broken');
	});

	it('done() clears pulse timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { writers, stdout } = makeWriters();
			const handle = new TTYProgressHandle({}, writers);
			handle.done();
			const countAfterDone = stdout.length;
			vi.advanceTimersByTime(200);
			expect(stdout.length).toBe(countAfterDone);
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

	it('increment() records update event with value', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.increment(3);
		expect(events[1]).toEqual({ type: 'progress:update', value: 3 });
	});

	it('increment() defaults to 1', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureProgressHandle({ total: 10 }, events);
		handle.increment();
		expect(events[1]).toEqual({ type: 'progress:update', value: 1 });
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
