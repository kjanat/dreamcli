/**
 * Tests for spinner/progress activity handles — all modes, all handle types.
 *
 * Coverage:
 * - Noop handles (jsonMode, non-TTY silent fallback)
 * - Static handles (non-TTY, fallback='static')
 * - TTY handles (isTTY, ANSI rendering, timer cleanup)
 * - Capture handles (testkit event recording)
 * - OutputChannel mode dispatch
 * - Active handle tracking (implicit stop on overlap)
 * - Spinner .wrap() success/failure paths
 * - Progress determinate/indeterminate
 * - Testkit integration via runCommand()
 */

import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../schema/command.js';
import { command } from '../schema/command.js';
import { runCommand } from '../testkit/index.js';
import type { StaticWriters } from './index.js';
import {
	CaptureProgressHandle,
	CaptureSpinnerHandle,
	createCaptureOutput,
	noopProgressHandle,
	noopSpinnerHandle,
	OutputChannel,
	StaticProgressHandle,
	StaticSpinnerHandle,
	TTYProgressHandle,
	TTYSpinnerHandle,
} from './index.js';

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
	function makeWriters(): { writers: StaticWriters; stdout: string[]; stderr: string[] } {
		const stdout: string[] = [];
		const stderr: string[] = [];
		return {
			writers: { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
			stdout,
			stderr,
		};
	}

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
	function makeWriters(): { writers: StaticWriters; stdout: string[]; stderr: string[] } {
		const stdout: string[] = [];
		const stderr: string[] = [];
		return {
			writers: { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
			stdout,
			stderr,
		};
	}

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
	function makeWriters(): { writers: StaticWriters; stdout: string[]; stderr: string[] } {
		const stdout: string[] = [];
		const stderr: string[] = [];
		return {
			writers: { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
			stdout,
			stderr,
		};
	}

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
});

describe('TTYProgressHandle — determinate', () => {
	function makeWriters(): { writers: StaticWriters; stdout: string[]; stderr: string[] } {
		const stdout: string[] = [];
		const stderr: string[] = [];
		return {
			writers: { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
			stdout,
			stderr,
		};
	}

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
	function makeWriters(): { writers: StaticWriters; stdout: string[]; stderr: string[] } {
		const stdout: string[] = [];
		const stderr: string[] = [];
		return {
			writers: { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
			stdout,
			stderr,
		};
	}

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

	it('wrap() without options records empty string', async () => {
		const events: ActivityEvent[] = [];
		const handle = new CaptureSpinnerHandle('work', events);
		await handle.wrap(Promise.resolve('x'));
		expect(events[1]).toEqual({ type: 'spinner:succeed', text: '' });
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

// ===================================================================
// OutputChannel — mode dispatch for spinner()
// ===================================================================

describe('OutputChannel.spinner() — mode dispatch', () => {
	function makeChannel(opts: { jsonMode?: boolean; isTTY?: boolean }): {
		channel: OutputChannel;
		stdout: string[];
		stderr: string[];
	} {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => stdout.push(s),
			stderr: (s) => stderr.push(s),
			isTTY: opts.isTTY ?? false,
			verbosity: 'normal',
			jsonMode: opts.jsonMode ?? false,
		});
		return { channel, stdout, stderr };
	}

	it('jsonMode → noop handle (no output)', () => {
		const { channel, stdout, stderr } = makeChannel({ jsonMode: true, isTTY: true });
		const handle = channel.spinner('Loading');
		handle.succeed('done');
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([]);
	});

	it('non-TTY, silent fallback (default) → noop handle', () => {
		const { channel, stdout, stderr } = makeChannel({ isTTY: false });
		const handle = channel.spinner('Loading');
		handle.succeed('done');
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([]);
	});

	it('non-TTY, explicit silent fallback → noop handle', () => {
		const { channel, stdout, stderr } = makeChannel({ isTTY: false });
		const handle = channel.spinner('Loading', { fallback: 'silent' });
		handle.succeed('done');
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([]);
	});

	it('non-TTY, static fallback → static handle with text output', () => {
		const { channel, stdout } = makeChannel({ isTTY: false });
		const handle = channel.spinner('Loading', { fallback: 'static' });
		handle.succeed('Done!');
		expect(stdout).toEqual(['Loading\n', 'Done!\n']);
	});

	it('isTTY → TTY handle with ANSI output', () => {
		const { channel, stdout } = makeChannel({ isTTY: true });
		const handle = channel.spinner('Loading');
		handle.stop();
		const all = stdout.join('');
		// TTY handle: should have hide/show cursor
		expect(all).toContain('\x1b[?25l');
		expect(all).toContain('\x1b[?25h');
	});

	it('jsonMode overrides isTTY → noop even when TTY', () => {
		const { channel, stdout } = makeChannel({ jsonMode: true, isTTY: true });
		const handle = channel.spinner('Loading', { fallback: 'static' });
		handle.succeed('done');
		// jsonMode takes precedence — no output
		expect(stdout).toEqual([]);
	});
});

// ===================================================================
// OutputChannel — mode dispatch for progress()
// ===================================================================

describe('OutputChannel.progress() — mode dispatch', () => {
	function makeChannel(opts: { jsonMode?: boolean; isTTY?: boolean }): {
		channel: OutputChannel;
		stdout: string[];
		stderr: string[];
	} {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => stdout.push(s),
			stderr: (s) => stderr.push(s),
			isTTY: opts.isTTY ?? false,
			verbosity: 'normal',
			jsonMode: opts.jsonMode ?? false,
		});
		return { channel, stdout, stderr };
	}

	it('jsonMode → noop handle', () => {
		const { channel, stdout, stderr } = makeChannel({ jsonMode: true });
		const handle = channel.progress({ total: 10, label: 'Files' });
		handle.increment(5);
		handle.done('ok');
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([]);
	});

	it('non-TTY, silent fallback (default) → noop handle', () => {
		const { channel, stdout } = makeChannel({ isTTY: false });
		const handle = channel.progress({ total: 10 });
		handle.increment(5);
		handle.done();
		expect(stdout).toEqual([]);
	});

	it('non-TTY, static fallback → static handle', () => {
		const { channel, stdout } = makeChannel({ isTTY: false });
		const handle = channel.progress({ total: 10, label: 'Files', fallback: 'static' });
		handle.done('Complete!');
		expect(stdout).toEqual(['Files\n', 'Complete!\n']);
	});

	it('isTTY → TTY handle with bar rendering', () => {
		const { channel, stdout } = makeChannel({ isTTY: true });
		const handle = channel.progress({ total: 10 });
		handle.done();
		const all = stdout.join('');
		expect(all).toContain('\x1b[?25l');
		expect(all).toContain('\x1b[?25h');
	});
});

// ===================================================================
// Active handle tracking — implicit stop on overlap
// ===================================================================

describe('active handle tracking — implicit stop', () => {
	it('new spinner implicitly stops previous spinner (static)', () => {
		const stdout: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => stdout.push(s),
			stderr: () => {},
			isTTY: false,
			verbosity: 'normal',
			jsonMode: false,
		});
		const first = channel.spinner('First', { fallback: 'static' });
		channel.spinner('Second', { fallback: 'static' });
		// First spinner should have been stopped (no extra output, just stopped)
		// Calling succeed on first should be no-op (already stopped)
		first.succeed('ignored');
		expect(stdout).toEqual(['First\n', 'Second\n']);
	});

	it('new progress implicitly stops previous spinner (TTY)', () => {
		const stdout: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => stdout.push(s),
			stderr: () => {},
			isTTY: true,
			verbosity: 'normal',
			jsonMode: false,
		});
		const spinner = channel.spinner('Spinning');
		channel.progress({ total: 10 });
		// Spinner should have been stopped — succeed is no-op
		spinner.succeed('ignored');
		// Just verify no errors; the spinner was cleaned up
		const all = stdout.join('');
		expect(all).toContain('\x1b[?25l');
	});

	it('new spinner implicitly stops previous progress (TTY)', () => {
		const stdout: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => stdout.push(s),
			stderr: () => {},
			isTTY: true,
			verbosity: 'normal',
			jsonMode: false,
		});
		const progress = channel.progress({ total: 10 });
		channel.spinner('Spinning');
		// Progress was implicitly stopped — done is no-op
		progress.done('ignored');
		const all = stdout.join('');
		// Both handles wrote to stdout
		expect(all.length).toBeGreaterThan(0);
	});

	it('noop handles do not participate in tracking', () => {
		const stdout: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => stdout.push(s),
			stderr: () => {},
			isTTY: false,
			verbosity: 'normal',
			jsonMode: false,
		});
		// Both are noop (non-TTY, silent fallback)
		const first = channel.spinner('First');
		const second = channel.spinner('Second');
		first.succeed('a');
		second.succeed('b');
		// No output from noop handles
		expect(stdout).toEqual([]);
	});

	it('jsonMode handles do not participate in tracking', () => {
		const stdout: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => stdout.push(s),
			stderr: () => {},
			isTTY: true,
			verbosity: 'normal',
			jsonMode: true,
		});
		const first = channel.spinner('First');
		const second = channel.spinner('Second');
		first.succeed('a');
		second.succeed('b');
		expect(stdout).toEqual([]);
	});
});

// ===================================================================
// createCaptureOutput — activity event capture
// ===================================================================

describe('createCaptureOutput — activity capture', () => {
	it('captures spinner lifecycle events', () => {
		const [out, captured] = createCaptureOutput();
		const handle = out.spinner('Loading');
		handle.update('Still loading');
		handle.succeed('Done');
		expect(captured.activity).toEqual([
			{ type: 'spinner:start', text: 'Loading' },
			{ type: 'spinner:update', text: 'Still loading' },
			{ type: 'spinner:succeed', text: 'Done' },
		]);
	});

	it('captures progress lifecycle events', () => {
		const [out, captured] = createCaptureOutput();
		const handle = out.progress({ total: 10, label: 'Files' });
		handle.increment(3);
		handle.update(7);
		handle.done('Complete');
		expect(captured.activity).toEqual([
			{ type: 'progress:start', label: 'Files', total: 10 },
			{ type: 'progress:update', value: 3 },
			{ type: 'progress:update', value: 7 },
			{ type: 'progress:done', text: 'Complete' },
		]);
	});

	it('activity events are separate from stdout/stderr', () => {
		const [out, captured] = createCaptureOutput();
		out.log('text output');
		const handle = out.spinner('Loading');
		handle.succeed('Done');
		expect(captured.stdout).toEqual(['text output\n']);
		expect(captured.activity.length).toBe(2);
	});

	it('starts with empty activity array', () => {
		const [, captured] = createCaptureOutput();
		expect(captured.activity).toEqual([]);
	});

	it('multiple spinners share the same activity array', () => {
		const [out, captured] = createCaptureOutput();
		const s1 = out.spinner('First');
		s1.stop();
		const s2 = out.spinner('Second');
		s2.succeed('ok');
		expect(captured.activity).toEqual([
			{ type: 'spinner:start', text: 'First' },
			{ type: 'spinner:stop' },
			{ type: 'spinner:start', text: 'Second' },
			{ type: 'spinner:succeed', text: 'ok' },
		]);
	});

	it('spinner + progress events interleave correctly', () => {
		const [out, captured] = createCaptureOutput();
		const spinner = out.spinner('Fetching');
		spinner.succeed('Fetched');
		const progress = out.progress({ total: 5, label: 'Processing' });
		progress.increment(2);
		progress.done('All done');
		expect(captured.activity).toEqual([
			{ type: 'spinner:start', text: 'Fetching' },
			{ type: 'spinner:succeed', text: 'Fetched' },
			{ type: 'progress:start', label: 'Processing', total: 5 },
			{ type: 'progress:update', value: 2 },
			{ type: 'progress:done', text: 'All done' },
		]);
	});

	it('capture ignores fallback option (always records)', () => {
		const [out, captured] = createCaptureOutput();
		const handle = out.spinner('Loading', { fallback: 'silent' });
		handle.stop();
		// Capture handles always record regardless of fallback setting
		expect(captured.activity).toEqual([
			{ type: 'spinner:start', text: 'Loading' },
			{ type: 'spinner:stop' },
		]);
	});
});

// ===================================================================
// Testkit integration — runCommand() with activity capture
// ===================================================================

describe('runCommand() — activity capture', () => {
	it('captures spinner events from handler', async () => {
		const cmd = command('test').action(({ out }) => {
			const s = out.spinner('Working');
			s.succeed('Done!');
		});
		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(result.activity).toEqual([
			{ type: 'spinner:start', text: 'Working' },
			{ type: 'spinner:succeed', text: 'Done!' },
		]);
	});

	it('captures progress events from handler', async () => {
		const cmd = command('test').action(({ out }) => {
			const p = out.progress({ total: 3, label: 'Items' });
			p.increment();
			p.increment();
			p.increment();
			p.done('All items processed');
		});
		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(result.activity).toEqual([
			{ type: 'progress:start', label: 'Items', total: 3 },
			{ type: 'progress:update', value: 1 },
			{ type: 'progress:update', value: 1 },
			{ type: 'progress:update', value: 1 },
			{ type: 'progress:done', text: 'All items processed' },
		]);
	});

	it('activity is empty when handler uses no spinners/progress', async () => {
		const cmd = command('test').action(({ out }) => {
			out.log('just text');
		});
		const result = await runCommand(cmd, []);
		expect(result.activity).toEqual([]);
	});

	it('captures wrap() lifecycle from handler', async () => {
		const cmd = command('test').action(async ({ out }) => {
			const s = out.spinner('Fetching');
			await s.wrap(Promise.resolve('data'), { succeed: 'Fetched!' });
		});
		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(result.activity).toEqual([
			{ type: 'spinner:start', text: 'Fetching' },
			{ type: 'spinner:succeed', text: 'Fetched!' },
		]);
	});

	it('captures fail event when wrap() rejects', async () => {
		const cmd = command('test').action(async ({ out }) => {
			const s = out.spinner('Risky');
			try {
				await s.wrap(Promise.reject(new Error('oops')), { fail: 'Failed!' });
			} catch {
				// swallow — handler catches
			}
		});
		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(result.activity).toEqual([
			{ type: 'spinner:start', text: 'Risky' },
			{ type: 'spinner:fail', text: 'Failed!' },
		]);
	});

	it('activity does not pollute stdout/stderr', async () => {
		const cmd = command('test').action(({ out }) => {
			out.log('visible');
			const s = out.spinner('invisible');
			s.succeed('also invisible');
		});
		const result = await runCommand(cmd, []);
		expect(result.stdout).toEqual(['visible\n']);
		expect(result.stderr).toEqual([]);
		expect(result.activity.length).toBe(2);
	});

	it('captures indeterminate progress', async () => {
		const cmd = command('test').action(({ out }) => {
			const p = out.progress({ label: 'Syncing' });
			p.done('Synced');
		});
		const result = await runCommand(cmd, []);
		expect(result.activity).toEqual([
			{ type: 'progress:start', label: 'Syncing', total: undefined },
			{ type: 'progress:done', text: 'Synced' },
		]);
	});
});
