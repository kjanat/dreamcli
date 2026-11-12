import { describe, expect, it, vi } from 'vitest';
import { command } from '#internals/core/schema/command.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { createCaptureOutput, createOutput, OutputChannel } from './index.ts';

function terminal(width = 80) {
	const rows: string[][] = [[]];
	let row = 0;
	let column = 0;
	let wrap = true;
	let cursor = true;
	return {
		write(text: string) {
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Decode terminal CSI sequences in the screen fixture.
			for (const token of text.match(/\x1b\[[?\d;]*[A-Za-z]|./gsu) ?? []) {
				if (token === '\x1b[?25l') cursor = false;
				else if (token === '\x1b[?25h') cursor = true;
				else if (token === '\x1b[?7l') wrap = false;
				else if (token === '\x1b[?7h') wrap = true;
				else if (token.startsWith('\x1b[') && token.endsWith('A'))
					row = Math.max(0, row - Number(token.slice(2, -1)));
				else if (token === '\x1b[J') {
					rows.splice(row + 1);
					rows[row] = (rows[row] ?? []).slice(0, column);
				} else if (token === '\x1b[2K') rows[row] = [];
				else if (token === '\r') column = 0;
				else if (token === '\n') row++;
				else {
					if (column >= width && wrap) {
						row++;
						column = 0;
					}
					const cells = rows[row] ?? [];
					rows[row] = cells;
					if (column < width) cells[column] = token;
					column++;
				}
			}
		},
		lines: () => rows.map((line) => line.join('')).filter((line) => line !== ''),
		cursor: () => cursor,
		wrap: () => wrap,
	};
}

describe('concurrent terminal activities', () => {
	it('updates independent rows, retains results, and restores the cursor after the last finish', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal();
			const out = createOutput({ isTTY: true, color: false, stderr: screen.write });
			const spinner = out.spinner('Building', { concurrent: true });
			const progress = out.progress({ label: 'Uploading', total: 10, concurrent: true });
			progress.update(5);
			expect(screen.lines()).toEqual(['⠋ Building', '[██████████░░░░░░░░░░] 50% Uploading']);
			vi.advanceTimersByTime(80);
			expect(screen.lines()[0]).toBe('⠙ Building');
			spinner.succeed('Built');
			expect(screen.lines()).toEqual(['✓ Built', '[██████████░░░░░░░░░░] 50% Uploading']);
			expect(screen.cursor()).toBe(false);
			progress.increment(5);
			progress.done('Uploaded');
			expect(screen.lines()).toEqual(['✓ Built', '✓ Uploaded']);
			expect(screen.cursor()).toBe(true);
			expect(screen.wrap()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('writes stdout and stderr messages above the active block', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal();
			const out = createOutput({
				isTTY: true,
				color: false,
				stderr: screen.write,
				stdout: screen.write,
			});
			const first = out.spinner('First', { concurrent: true });
			const second = out.spinner('Second', { concurrent: true });
			out.log('stdout message');
			out.warn('stderr message');
			first.update('Updated');
			expect(screen.lines()).toEqual(['stdout message', 'stderr message', '⠋ Updated', '⠋ Second']);
			first.stop();
			second.fail('Failed');
			expect(screen.lines()).toEqual(['stdout message', 'stderr message', '✗ Failed']);
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('clips long rows and flattens line breaks without corrupting later redraws', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(12);
			const out = createOutput({ isTTY: true, color: false, stderr: screen.write });
			const first = out.spinner('A very long description', { concurrent: true });
			const second = out.spinner('line\nbreak', { concurrent: true });
			first.update('Short');
			expect(screen.lines()).toEqual(['⠋ Short', '⠋ line break']);
			first.stop();
			second.stop();
			expect(screen.lines()).toEqual([]);
			expect(screen.wrap()).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('replaces a block with a default handle and ignores later calls to stopped handles', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal();
			const out = createOutput({ isTTY: true, color: false, stderr: screen.write });
			const first = out.spinner('First', { concurrent: true });
			const second = out.progress({ label: 'Second', concurrent: true });
			const replacement = out.spinner('Replacement');
			first.succeed('Ignored');
			second.fail('Ignored');
			expect(screen.lines()).toEqual(['⠋ Replacement']);
			expect(vi.getTimerCount()).toBe(1);
			replacement.stop();
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('starts a fresh block after a completed block', async () => {
		vi.useFakeTimers();
		try {
			const screen = terminal();
			const out = createOutput({ isTTY: true, color: false, stderr: screen.write });
			await out
				.spinner('First', { concurrent: true })
				.wrap(Promise.resolve(12), { succeed: (n) => `Listed ${n}` });
			const next = out.spinner('Next', { concurrent: true });
			expect(screen.lines()).toEqual(['✓ Listed 12', '⠋ Next']);
			next.stop();
			expect(screen.lines()).toEqual(['✓ Listed 12']);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([{ jsonMode: true }, { verbosity: 'quiet' as const }, { isTTY: false }])(
		'keeps concurrent activities silent with $jsonMode/$verbosity/$isTTY',
		(options) => {
			const stderr: string[] = [];
			const out = createOutput({ isTTY: true, stderr: (text) => stderr.push(text), ...options });
			out.spinner('Work', { concurrent: true }).succeed('Done');
			out.progress({ concurrent: true }).done('Done');
			expect(stderr).toEqual([]);
		},
	);

	it('keeps static handles independent without terminal control sequences', () => {
		const stderr: string[] = [];
		const out = createOutput({ stderr: (text) => stderr.push(text) });
		const first = out.spinner('First', { concurrent: true, fallback: 'static' });
		const second = out.progress({ label: 'Second', concurrent: true, fallback: 'static' });
		first.succeed('First done');
		second.done('Second done');
		expect(stderr).toEqual(['First\n', 'Second\n', 'First done\n', 'Second done\n']);
	});

	it('stopActive clears every timer and remains idempotent', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal();
			const out = new OutputChannel({
				isTTY: true,
				color: false,
				jsonMode: false,
				verbosity: 'normal',
				isHyperlinkSupported: false,
				stderr: screen.write,
				stdout: screen.write,
			});
			out.spinner('First', { concurrent: true });
			out.progress({ label: 'Second', concurrent: true });
			expect(vi.getTimerCount()).toBe(2);
			out.stopActive();
			out.stopActive();
			expect(screen.lines()).toEqual([]);
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('concurrent capture lifecycle', () => {
	it('captures replacement before starting a default handle', () => {
		const [out, captured] = createCaptureOutput();
		const first = out.spinner('First', { concurrent: true });
		const second = out.progress({ concurrent: true });
		out.spinner('Replacement').stop();
		first.update('Ignored');
		second.increment();
		expect(captured.activity).toEqual([
			{ type: 'spinner:start', text: 'First' },
			{ type: 'progress:start', label: '', total: undefined },
			{ type: 'spinner:stop' },
			{ type: 'progress:done', text: undefined },
			{ type: 'spinner:start', text: 'Replacement' },
			{ type: 'spinner:stop' },
		]);
	});

	it('captures cleanup of all leaked handles when the command throws', async () => {
		const result = await runCommand(
			command('work').action(({ out }) => {
				out.spinner('First', { concurrent: true });
				out.progress({ label: 'Second', concurrent: true });
				throw new Error('failed');
			}),
			[],
		);
		expect(result.exitCode).toBe(1);
		expect(result.activity).toEqual([
			{ type: 'spinner:start', text: 'First' },
			{ type: 'progress:start', label: 'Second', total: undefined },
			{ type: 'spinner:stop' },
			{ type: 'progress:done', text: undefined },
		]);
	});
});
