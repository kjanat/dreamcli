/**
 * Tests for spinner activity handle classes — direct unit tests.
 *
 * Coverage:
 * - noopSpinnerHandle (jsonMode, non-TTY silent fallback)
 * - StaticSpinnerHandle (non-TTY, fallback='static')
 * - TTYSpinnerHandle (isTTY, ANSI rendering, timer cleanup)
 * - CaptureSpinnerHandle (testkit event recording)
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActivityEvent } from '../schema/command.js';
import type { StaticWriters } from './index.js';
import {
	CaptureSpinnerHandle,
	noopSpinnerHandle,
	StaticSpinnerHandle,
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
// Noop spinner — jsonMode + non-TTY silent fallback
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

// ===================================================================
// Static spinner — non-TTY, fallback='static'
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

// ===================================================================
// TTY spinner — ANSI rendering, timer management
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

// ===================================================================
// Capture spinner — testkit event recording
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
