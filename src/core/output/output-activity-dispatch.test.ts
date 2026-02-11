/**
 * Tests for OutputChannel activity dispatch — mode selection, active handle tracking,
 * capture integration, and runCommand() testkit integration.
 *
 * Coverage:
 * - OutputChannel.spinner() mode dispatch (jsonMode, TTY, non-TTY, fallback)
 * - OutputChannel.progress() mode dispatch
 * - Active handle tracking (implicit stop on overlap)
 * - createCaptureOutput() activity event capture
 * - runCommand() testkit integration with activity capture
 *
 * @module
 */

import { describe, expect, it } from 'vitest';
import { command } from '../schema/command.js';
import { runCommand } from '../testkit/index.js';
import { createCaptureOutput, OutputChannel } from './index.js';

// --- Test helpers ---

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

// ===================================================================
// OutputChannel — mode dispatch for spinner()
// ===================================================================

describe('OutputChannel.spinner() — mode dispatch', () => {
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

	it('wrap() on implicitly stopped spinner still resolves', async () => {
		const { channel } = makeChannel({ isTTY: false });
		const first = channel.spinner('First', { fallback: 'static' });
		channel.spinner('Second', { fallback: 'static' });
		// first was implicitly stopped — wrap() must still resolve the promise
		const result = await first.wrap(Promise.resolve(42), { succeed: 'ok' });
		expect(result).toBe(42);
	});

	it('wrap() on implicitly stopped spinner still rejects', async () => {
		const { channel } = makeChannel({ isTTY: false });
		const first = channel.spinner('First', { fallback: 'static' });
		channel.spinner('Second', { fallback: 'static' });
		// first was implicitly stopped — wrap() must still propagate rejection
		await expect(first.wrap(Promise.reject(new Error('boom')), { fail: 'err' })).rejects.toThrow(
			'boom',
		);
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
			{ type: 'progress:increment', delta: 3 },
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
			{ type: 'progress:increment', delta: 2 },
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

	it('capture handles operate independently (no implicit stop)', () => {
		const [out, captured] = createCaptureOutput();
		const s1 = out.spinner('First');
		const s2 = out.spinner('Second'); // does NOT stop s1
		s1.update('First updated');
		s2.update('Second updated');
		s1.succeed('First done');
		s2.succeed('Second done');
		expect(captured.activity).toEqual([
			{ type: 'spinner:start', text: 'First' },
			{ type: 'spinner:start', text: 'Second' },
			{ type: 'spinner:update', text: 'First updated' },
			{ type: 'spinner:update', text: 'Second updated' },
			{ type: 'spinner:succeed', text: 'First done' },
			{ type: 'spinner:succeed', text: 'Second done' },
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
			{ type: 'progress:increment', delta: 1 },
			{ type: 'progress:increment', delta: 1 },
			{ type: 'progress:increment', delta: 1 },
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
