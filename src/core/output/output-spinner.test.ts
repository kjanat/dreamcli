/**
 * Tests for spinner activity handle classes — direct unit tests.
 *
 * Coverage:
 * - noopSpinnerHandle (jsonMode, non-TTY silent fallback)
 * - StaticSpinnerHandle (non-TTY, fallback='static')
 * - TTYSpinnerHandle (isTTY, ANSI rendering, timer cleanup)
 * - CaptureSpinnerHandle (testkit event recording)
 *
 * All concrete handles receive a single `WriteFn` (stderr). Output
 * assertions use a unified `output` array — no stdout/stderr split.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest';
import type { ActivityEvent } from '../schema/activity.js';
import type { WriteFn } from './index.js';
import {
	CaptureSpinnerHandle,
	noopSpinnerHandle,
	StaticSpinnerHandle,
	TTYSpinnerHandle,
} from './index.js';

// --- Test helpers ---

function makeWriter(): { write: WriteFn; output: string[] } {
	const output: string[] = [];
	return {
		write: (s) => output.push(s),
		output,
	};
}

// === Noop spinner — jsonMode + non-TTY silent fallback

describe('noopSpinnerHandle — jsonMode + non-TTY silent fallback', () => {
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

// === Static spinner — non-TTY, fallback='static'

describe('StaticSpinnerHandle — non-TTY static fallback', () => {
	it('emits start text on construction', () => {
		const { write, output } = makeWriter();
		new StaticSpinnerHandle('Loading...', write);
		expect(output).toEqual(['Loading...\n']);
	});

	it('succeed() emits text', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.succeed('Done!');
		expect(output).toEqual(['work\n', 'Done!\n']);
	});

	it('succeed() without text emits nothing extra', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.succeed();
		expect(output).toEqual(['work\n']);
	});

	it('fail() emits text', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.fail('Error!');
		expect(output).toEqual(['work\n', 'Error!\n']);
	});

	it('fail() without text emits nothing extra', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.fail();
		expect(output).toEqual(['work\n']);
	});

	it('stop() is silent', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.stop();
		expect(output).toEqual(['work\n']);
	});

	it('update() is silent (no terminal to overwrite)', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.update('new text');
		// Only the initial text
		expect(output).toEqual(['work\n']);
	});

	// --- Idempotency ---

	it('terminal methods are idempotent — second succeed is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.succeed('first');
		handle.succeed('second');
		expect(output).toEqual(['work\n', 'first\n']);
	});

	it('fail after succeed is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.succeed('ok');
		handle.fail('nope');
		expect(output).toEqual(['work\n', 'ok\n']);
	});

	it('succeed after fail is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.fail('nope');
		handle.succeed('ok');
		expect(output).toEqual(['work\n', 'nope\n']);
	});

	it('stop after succeed is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		handle.succeed('done');
		handle.stop();
		expect(output).toEqual(['work\n', 'done\n']);
	});

	// --- wrap() ---

	it('wrap() calls succeed on resolution', async () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		const result = await handle.wrap(Promise.resolve('val'), { succeed: 'ok!' });
		expect(result).toBe('val');
		expect(output).toEqual(['work\n', 'ok!\n']);
	});

	it('wrap() calls fail on rejection', async () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		await expect(
			handle.wrap(Promise.reject(new Error('boom')), { fail: 'failed!' }),
		).rejects.toThrow('boom');
		expect(output).toEqual(['work\n', 'failed!\n']);
	});

	it('wrap() is idempotent — no output after first wrap', async () => {
		const { write, output } = makeWriter();
		const handle = new StaticSpinnerHandle('work', write);
		await handle.wrap(Promise.resolve(1), { succeed: 'first' });
		// Second wrap resolves but handle is already stopped
		await handle.wrap(Promise.resolve(2), { succeed: 'second' });
		expect(output).toEqual(['work\n', 'first\n']);
	});
});

// === TTY spinner — ANSI rendering, timer management

describe('TTYSpinnerHandle — ANSI rendering, timer management', () => {
	it('emits hide cursor + initial frame on construction', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('Loading', write);
		// First write: hide cursor
		expect(output[0]).toBe('\x1b[?25l');
		// Second write: initial frame render with \r + erase line
		expect(output[1]).toContain('\r');
		expect(output[1]).toContain('Loading');
		handle.stop();
	});

	it('succeed() cleans up + emits check symbol', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.succeed('Done!');
		const all = output.join('');
		// Should contain show cursor (cleanup)
		expect(all).toContain('\x1b[?25h');
		// Should contain check symbol
		expect(all).toContain('✓');
		expect(all).toContain('Done!');
	});

	it('fail() cleans up + emits cross symbol', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.fail('Error!');
		const all = output.join('');
		// Cleanup (erase line + show cursor)
		expect(all).toContain('\x1b[?25h');
		// Failure text
		expect(all).toContain('✗');
		expect(all).toContain('Error!');
	});

	it('fail() without text cleans up silently', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.fail();
		const all = output.join('');
		expect(all).toContain('\x1b[?25h');
		expect(all).not.toContain('✗');
	});

	it('stop() cleans up without status symbol', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.stop();
		const all = output.join('');
		expect(all).toContain('\x1b[?25h');
		// No check or cross
		expect(all).not.toContain('✓');
		expect(all).not.toContain('✗');
	});

	it('update() changes displayed text', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('first', write);
		handle.update('second');
		// Should have a render containing 'second'
		const hasSecond = output.some((s) => s.includes('second'));
		expect(hasSecond).toBe(true);
		handle.stop();
	});

	it('update() after stop is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.stop();
		const countAfterStop = output.length;
		handle.update('ignored');
		expect(output.length).toBe(countAfterStop);
	});

	// --- Idempotency ---

	it('double stop is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.stop();
		const countAfterStop = output.length;
		handle.stop();
		expect(output.length).toBe(countAfterStop);
	});

	it('succeed after stop is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.stop();
		const countAfterStop = output.length;
		handle.succeed('ignored');
		expect(output.length).toBe(countAfterStop);
	});

	it('fail after succeed is no-op', () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		handle.succeed('ok');
		const countAfterSucceed = output.length;
		handle.fail('ignored');
		// No additional output
		expect(output.length).toBe(countAfterSucceed);
	});

	// --- wrap() ---

	it('wrap() succeeds → auto-succeed', async () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		const result = await handle.wrap(Promise.resolve('val'), { succeed: 'ok!' });
		expect(result).toBe('val');
		const all = output.join('');
		expect(all).toContain('✓');
		expect(all).toContain('ok!');
	});

	it('wrap() rejects → auto-fail', async () => {
		const { write, output } = makeWriter();
		const handle = new TTYSpinnerHandle('work', write);
		await expect(
			handle.wrap(Promise.reject(new Error('boom')), { fail: 'failed!' }),
		).rejects.toThrow('boom');
		const all = output.join('');
		expect(all).toContain('✗');
		expect(all).toContain('failed!');
	});

	// --- Timer cleanup ---

	it('stop() clears animation timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { write, output } = makeWriter();
			const handle = new TTYSpinnerHandle('work', write);
			handle.stop();
			const countAfterStop = output.length;
			vi.advanceTimersByTime(200);
			expect(output.length).toBe(countAfterStop);
		} finally {
			vi.useRealTimers();
		}
	});

	it('succeed() clears animation timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { write, output } = makeWriter();
			const handle = new TTYSpinnerHandle('work', write);
			handle.succeed('ok');
			const countAfterSucceed = output.length;
			vi.advanceTimersByTime(200);
			expect(output.length).toBe(countAfterSucceed);
		} finally {
			vi.useRealTimers();
		}
	});

	it('fail() clears animation timer — no callbacks after advance', () => {
		vi.useFakeTimers();
		try {
			const { write, output } = makeWriter();
			const handle = new TTYSpinnerHandle('work', write);
			handle.fail('err');
			const countAfterFail = output.length;
			vi.advanceTimersByTime(200);
			expect(output.length).toBe(countAfterFail);
		} finally {
			vi.useRealTimers();
		}
	});

	// --- Frame animation ---

	it('cycles through braille frames at 80ms intervals', () => {
		vi.useFakeTimers();
		try {
			const { write, output } = makeWriter();
			const handle = new TTYSpinnerHandle('work', write);
			// Construction renders frame 0 (⠋)
			const last = () => {
				const v = output[output.length - 1];
				if (v === undefined) throw new Error('expected output');
				return v;
			};
			expect(last()).toContain('⠋');
			// 1 tick → frame 1 (⠙)
			vi.advanceTimersByTime(80);
			expect(last()).toContain('⠙');
			// 1 tick → frame 2 (⠹)
			vi.advanceTimersByTime(80);
			expect(last()).toContain('⠹');
			// 7 ticks → frame 9 (⠏)
			vi.advanceTimersByTime(80 * 7);
			expect(last()).toContain('⠏');
			// 1 tick → wraps to frame 0 (⠋)
			vi.advanceTimersByTime(80);
			expect(last()).toContain('⠋');
			handle.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('wrap() rejection clears animation timer — no interval leak', async () => {
		vi.useFakeTimers();
		try {
			const { write, output } = makeWriter();
			const handle = new TTYSpinnerHandle('work', write);
			await expect(handle.wrap(Promise.reject(new Error('boom')), { fail: 'err' })).rejects.toThrow(
				'boom',
			);
			const countAfterFail = output.length;
			vi.advanceTimersByTime(200);
			expect(output.length).toBe(countAfterFail);
		} finally {
			vi.useRealTimers();
		}
	});
});

// === Capture spinner — testkit event recording

describe('CaptureSpinnerHandle — testkit event recording', () => {
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
