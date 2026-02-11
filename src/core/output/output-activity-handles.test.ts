/**
 * Tests for spinner/progress activity handle classes — direct unit tests.
 *
 * Coverage:
 * - Noop handles (jsonMode, non-TTY silent fallback)
 * - Static handles (non-TTY, fallback='static')
 * - TTY handles (isTTY, ANSI rendering, timer cleanup)
 * - Capture handles (testkit event recording)
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActivityEvent } from '../schema/command.js';
import type { StaticWriters } from './index.js';
import {
	CaptureProgressHandle,
	CaptureSpinnerHandle,
	noopProgressHandle,
	noopSpinnerHandle,
	StaticProgressHandle,
	StaticSpinnerHandle,
	TTYProgressHandle,
	TTYSpinnerHandle,
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
// Noop handles — jsonMode + non-TTY silent fallback
// ===================================================================

describe('noopSpinnerHandle', () => {
	it('all methods are no-ops (no throw)', () => {
		expect(() => {
			noopSpinnerHandle.update('text');
			noopSpinnerHandle.succeed('done');
			noopSpinnerHandle.fail('err');
			noopSpinnerHandle.stop();
		}).not.toThrow();
	});

	it('wrap() passes through the resolved value', async () => {
		const result = await noopSpinnerHandle.wrap(Promise.resolve(42));
		expect(result).toBe(42);
	});

	it('wrap() propagates rejection', async () => {
		const err = new Error('boom');
		await expect(noopSpinnerHandle.wrap(Promise.reject(err))).rejects.toThrow('boom');
	});
});

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
// Static handles — non-TTY, fallback='static'
// ===================================================================

describe('StaticSpinnerHandle', () => {
	it('emits start text on construction', () => {
		const { writers, stdout } = makeWriters();
		new StaticSpinnerHandle('Loading...', writers);
		expect(stdout).toEqual(['Loading...\n']);
	});

	it('succeed() emits text to stdout', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.succeed('Done!');
		expect(stdout).toEqual(['work\n', 'Done!\n']);
	});

	it('succeed() without text emits nothing extra', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.succeed();
		expect(stdout).toEqual(['work\n']);
	});

	it('fail() emits text to stderr', () => {
		const { writers, stderr } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.fail('Error!');
		expect(stderr).toEqual(['Error!\n']);
	});

	it('fail() without text emits nothing extra', () => {
		const { writers, stderr } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.fail();
		expect(stderr).toEqual([]);
	});

	it('stop() is silent', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.stop();
		expect(stdout).toEqual(['work\n']);
		expect(stderr).toEqual([]);
	});

	it('update() is silent (no terminal to overwrite)', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.update('new text');
		// Only the initial text
		expect(stdout).toEqual(['work\n']);
	});

	// --- Idempotency ---

	it('terminal methods are idempotent — second succeed is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.succeed('first');
		handle.succeed('second');
		expect(stdout).toEqual(['work\n', 'first\n']);
	});

	it('fail after succeed is no-op', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.succeed('ok');
		handle.fail('nope');
		expect(stdout).toEqual(['work\n', 'ok\n']);
		expect(stderr).toEqual([]);
	});

	it('succeed after fail is no-op', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.fail('nope');
		handle.succeed('ok');
		expect(stderr).toEqual(['nope\n']);
		expect(stdout).toEqual(['work\n']);
	});

	it('stop after succeed is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		handle.succeed('done');
		handle.stop();
		expect(stdout).toEqual(['work\n', 'done\n']);
	});

	// --- wrap() ---

	it('wrap() calls succeed on resolution', async () => {
		const { writers, stdout } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		const result = await handle.wrap(Promise.resolve('val'), { succeed: 'ok!' });
		expect(result).toBe('val');
		expect(stdout).toEqual(['work\n', 'ok!\n']);
	});

	it('wrap() calls fail on rejection', async () => {
		const { writers, stderr } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		await expect(
			handle.wrap(Promise.reject(new Error('boom')), { fail: 'failed!' }),
		).rejects.toThrow('boom');
		expect(stderr).toEqual(['failed!\n']);
	});

	it('wrap() is idempotent — no output after first wrap', async () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new StaticSpinnerHandle('work', writers);
		await handle.wrap(Promise.resolve(1), { succeed: 'first' });
		// Second wrap resolves but handle is already stopped
		await handle.wrap(Promise.resolve(2), { succeed: 'second' });
		expect(stdout).toEqual(['work\n', 'first\n']);
		expect(stderr).toEqual([]);
	});
});

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
// TTY handles — ANSI rendering, timer management
// ===================================================================

describe('TTYSpinnerHandle', () => {
	it('emits hide cursor + initial frame on construction', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('Loading', writers);
		// First write: hide cursor
		expect(stdout[0]).toBe('\x1b[?25l');
		// Second write: initial frame render with \r + erase line
		expect(stdout[1]).toContain('\r');
		expect(stdout[1]).toContain('Loading');
		handle.stop();
	});

	it('succeed() cleans up + emits check symbol', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.succeed('Done!');
		const all = stdout.join('');
		// Should contain show cursor (cleanup)
		expect(all).toContain('\x1b[?25h');
		// Should contain check symbol
		expect(all).toContain('✓');
		expect(all).toContain('Done!');
	});

	it('fail() cleans up + emits cross symbol to stderr', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.fail('Error!');
		// Cleanup writes to stdout (erase line + show cursor)
		const stdoutAll = stdout.join('');
		expect(stdoutAll).toContain('\x1b[?25h');
		// Failure text goes to stderr
		const stderrAll = stderr.join('');
		expect(stderrAll).toContain('✗');
		expect(stderrAll).toContain('Error!');
	});

	it('fail() without text cleans up silently', () => {
		const { writers, stdout, stderr } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.fail();
		const stdoutAll = stdout.join('');
		expect(stdoutAll).toContain('\x1b[?25h');
		expect(stdoutAll).not.toContain('✗');
		expect(stderr).toEqual([]);
	});

	it('stop() cleans up without status symbol', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.stop();
		const all = stdout.join('');
		expect(all).toContain('\x1b[?25h');
		// No check or cross
		expect(all).not.toContain('✓');
		expect(all).not.toContain('✗');
	});

	it('update() changes displayed text', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('first', writers);
		handle.update('second');
		// Should have a render containing 'second'
		const hasSecond = stdout.some((s) => s.includes('second'));
		expect(hasSecond).toBe(true);
		handle.stop();
	});

	it('update() after stop is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.stop();
		const countAfterStop = stdout.length;
		handle.update('ignored');
		expect(stdout.length).toBe(countAfterStop);
	});

	// --- Idempotency ---

	it('double stop is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.stop();
		const countAfterStop = stdout.length;
		handle.stop();
		expect(stdout.length).toBe(countAfterStop);
	});

	it('succeed after stop is no-op', () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.stop();
		const countAfterStop = stdout.length;
		handle.succeed('ignored');
		expect(stdout.length).toBe(countAfterStop);
	});

	it('fail after succeed is no-op', () => {
		const { writers, stderr } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		handle.succeed('ok');
		handle.fail('ignored');
		// No failure text in stderr
		const stderrAll = stderr.join('');
		expect(stderrAll).not.toContain('ignored');
	});

	// --- wrap() ---

	it('wrap() succeeds → auto-succeed', async () => {
		const { writers, stdout } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		const result = await handle.wrap(Promise.resolve('val'), { succeed: 'ok!' });
		expect(result).toBe('val');
		const all = stdout.join('');
		expect(all).toContain('✓');
		expect(all).toContain('ok!');
	});

	it('wrap() rejects → auto-fail', async () => {
		const { writers, stderr } = makeWriters();
		const handle = new TTYSpinnerHandle('work', writers);
		await expect(
			handle.wrap(Promise.reject(new Error('boom')), { fail: 'failed!' }),
		).rejects.toThrow('boom');
		const all = stderr.join('');
		expect(all).toContain('✗');
		expect(all).toContain('failed!');
	});

	// --- Timer cleanup ---

	it('stop() clears animation timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { writers, stdout } = makeWriters();
			const handle = new TTYSpinnerHandle('work', writers);
			handle.stop();
			const countAfterStop = stdout.length;
			vi.advanceTimersByTime(200);
			expect(stdout.length).toBe(countAfterStop);
		} finally {
			vi.useRealTimers();
		}
	});

	it('succeed() clears animation timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { writers, stdout } = makeWriters();
			const handle = new TTYSpinnerHandle('work', writers);
			handle.succeed('ok');
			const countAfterSucceed = stdout.length;
			vi.advanceTimersByTime(200);
			expect(stdout.length).toBe(countAfterSucceed);
		} finally {
			vi.useRealTimers();
		}
	});

	it('fail() clears animation timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { writers, stdout, stderr } = makeWriters();
			const handle = new TTYSpinnerHandle('work', writers);
			handle.fail('err');
			const stdoutCount = stdout.length;
			const stderrCount = stderr.length;
			vi.advanceTimersByTime(200);
			expect(stdout.length).toBe(stdoutCount);
			expect(stderr.length).toBe(stderrCount);
		} finally {
			vi.useRealTimers();
		}
	});
});

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
// Capture handles — testkit event recording
// ===================================================================

describe('CaptureSpinnerHandle', () => {
	it('records start event on construction', () => {
		const events: ActivityEvent[] = [];
		new CaptureSpinnerHandle('Loading', events);
		expect(events).toEqual([{ type: 'spinner:start', text: 'Loading' }]);
	});

	it('records update events', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.update('Still loading');
		expect(events).toEqual([
			{ type: 'spinner:start', text: 'Loading' },
			{ type: 'spinner:update', text: 'Still loading' },
		]);
	});

	it('records succeed event', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.succeed('Done');
		expect(events).toEqual([
			{ type: 'spinner:start', text: 'Loading' },
			{ type: 'spinner:succeed', text: 'Done' },
		]);
	});

	it('succeed without text records empty string', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.succeed();
		expect(events[1]).toEqual({ type: 'spinner:succeed', text: '' });
	});

	it('records fail event', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.fail('Error');
		expect(events).toEqual([
			{ type: 'spinner:start', text: 'Loading' },
			{ type: 'spinner:fail', text: 'Error' },
		]);
	});

	it('fail without text records empty string', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.fail();
		expect(events[1]).toEqual({ type: 'spinner:fail', text: '' });
	});

	it('records stop event', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.stop();
		expect(events).toEqual([{ type: 'spinner:start', text: 'Loading' }, { type: 'spinner:stop' }]);
	});

	// --- Idempotency ---

	it('terminal methods are idempotent — no duplicate events', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.succeed('Done');
		handle.succeed('Again');
		handle.fail('Nope');
		handle.stop();
		expect(events).toEqual([
			{ type: 'spinner:start', text: 'Loading' },
			{ type: 'spinner:succeed', text: 'Done' },
		]);
	});

	it('update after stop is no-op', () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('Loading', events);
		handle.stop();
		handle.update('ignored');
		expect(events).toEqual([{ type: 'spinner:start', text: 'Loading' }, { type: 'spinner:stop' }]);
	});

	// --- wrap() ---

	it('wrap() records succeed on resolution', async () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('work', events);
		const result = await handle.wrap(Promise.resolve(42), { succeed: 'ok' });
		expect(result).toBe(42);
		expect(events).toEqual([
			{ type: 'spinner:start', text: 'work' },
			{ type: 'spinner:succeed', text: 'ok' },
		]);
	});

	it('wrap() records fail on rejection', async () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('work', events);
		await expect(
			handle.wrap(Promise.reject(new Error('boom')), { fail: 'failed' }),
		).rejects.toThrow('boom');
		expect(events).toEqual([
			{ type: 'spinner:start', text: 'work' },
			{ type: 'spinner:fail', text: 'failed' },
		]);
	});

	it('wrap() without options records empty string on success', async () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('work', events);
		await handle.wrap(Promise.resolve('x'));
		expect(events[1]).toEqual({ type: 'spinner:succeed', text: '' });
	});

	it('wrap() without options records empty string on rejection', async () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('work', events);
		await expect(handle.wrap(Promise.reject(new Error('x')))).rejects.toThrow('x');
		expect(events[1]).toEqual({ type: 'spinner:fail', text: '' });
	});
});

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
