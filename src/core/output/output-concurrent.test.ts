import { describe, expect, it, vi } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { createCaptureOutput, createOutput, OutputChannel } from './index.ts';

function terminal(width = 80, height = 24) {
	const rows: string[][] = [[]];
	const history: string[] = [];
	const nextRow = () => {
		if (row < height - 1) row++;
		else {
			history.push((rows.shift() ?? []).join(''));
			rows.push([]);
		}
	};
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
				else if (token === '\n') nextRow();
				else {
					const cellWidth = /[\u4e00-\u9fff]/u.test(token) ? 2 : 1;
					if (column + cellWidth > width && wrap) {
						nextRow();
						column = 0;
					}
					const cells = rows[row] ?? [];
					rows[row] = cells;
					if (column + cellWidth <= width) cells[column] = token;
					column += cellWidth;
				}
			}
		},
		lines: () => rows.map((line) => line.join('')).filter((line) => line !== ''),
		history: () => [...history],
		size: () => ({ columns: width, rows: height }),
		resize(nextWidth: number, nextHeight: number) {
			width = nextWidth;
			height = nextHeight;
			while (row >= height) {
				history.push((rows.shift() ?? []).join(''));
				row--;
			}
			rows.length = Math.min(rows.length, height);
		},
		cursor: () => cursor,
		wrap: () => wrap,
	};
}

describe('concurrent terminal activities', () => {
	it('updates independent rows, retains results, and restores the cursor after the last finish', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal();
			const out = createOutput({
				isTTY: true,
				color: false,
				getTerminalSize: screen.size,
				stderr: screen.write,
			});
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
				getTerminalSize: screen.size,
				stderr: screen.write,
				stdout: screen.write,
			});
			const first = out.spinner('First', { concurrent: true });
			const second = out.spinner('Second', { concurrent: true });
			out.log('stdout message');
			out.warn('stderr message');
			first.update('Updated');
			expect(screen.lines()).toEqual(['stdout message', 'stderr message', '⠋ Updated', '⠋ Second']);
			out.json({ ready: true });
			out.table([{ name: 'widget' }], { format: 'json' });
			expect(screen.lines().slice(-2)).toEqual(['⠋ Updated', '⠋ Second']);
			expect(screen.lines().join('\n')).toContain('ready');
			expect(screen.lines().join('\n')).toContain('widget');
			first.stop();
			second.fail('Failed');
			expect(screen.lines().slice(0, 2)).toEqual(['stdout message', 'stderr message']);
			expect(screen.lines().at(-1)).toBe('✗ Failed');
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
			const out = createOutput({
				isTTY: true,
				color: false,
				getTerminalSize: screen.size,
				stderr: screen.write,
			});
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
			const out = createOutput({
				isTTY: true,
				color: false,
				getTerminalSize: screen.size,
				stderr: screen.write,
			});
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
			const out = createOutput({
				isTTY: true,
				color: false,
				getTerminalSize: screen.size,
				stderr: screen.write,
			});
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
				getTerminalSize: screen.size,
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

describe('concurrent activity viewport bounds', () => {
	it('skips hidden timer redraws while retaining updates for later promotion', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(40, 2);
			const write = vi.fn(screen.write);
			const out = createOutput({ isTTY: true, stderr: write, getTerminalSize: screen.size });
			const handles = Array.from({ length: 20 }, (_, i) =>
				out.spinner(`Job ${i}`, { concurrent: true }),
			);
			write.mockClear();
			vi.advanceTimersByTime(80);
			handles[19]?.update('Last job updated');
			expect(write).not.toHaveBeenCalled();
			expect(screen.lines()).toEqual(['20 more activities']);
			for (const handle of handles.slice(0, 19)) handle.stop();
			expect(screen.lines()).toEqual(['⠙ Last job updated']);
			handles[19]?.stop();
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('redraws unchanged text after resizing or writing permanent output', () => {
		const screen = terminal(40, 4);
		const write = vi.fn(screen.write);
		const out = createOutput({
			isTTY: true,
			stderr: write,
			stdout: screen.write,
			getTerminalSize: screen.size,
		});
		const progress = out.progress({ label: 'Uploading', total: 10, concurrent: true });
		const frame = screen.lines();
		write.mockClear();
		progress.update(0);
		expect(write).not.toHaveBeenCalled();
		for (const [width, height] of [
			[50, 4],
			[50, 5],
		] as const) {
			screen.resize(width, height);
			progress.update(0);
			expect(write).toHaveBeenCalled();
			expect(screen.lines()).toEqual(frame);
			write.mockClear();
		}
		out.log('Permanent message');
		expect(screen.lines()).toEqual(['Permanent message', ...frame]);
		expect(write).toHaveBeenCalled();
		progress.done('Uploaded');
		expect(screen.lines()).toEqual(['Permanent message', '✓ Uploaded']);
		expect(screen.cursor()).toBe(true);
	});

	it('retires completed children while a parent remains active', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(40, 4);
			const out = createOutput({ isTTY: true, stderr: screen.write, getTerminalSize: screen.size });
			const parent = out.spinner('Parent', { concurrent: true });
			for (let i = 0; i < 20; i++) {
				out.spinner(`Child ${i}`, { concurrent: true }).succeed(`Finished ${i}`);
			}
			const historyBefore = screen.history();
			vi.advanceTimersByTime(800);
			expect(screen.history()).toEqual(historyBefore);
			expect(screen.lines()).toContain('⠋ Parent');
			parent.succeed('Parent finished');
			const permanent = [...screen.history(), ...screen.lines()];
			for (let i = 0; i < 20; i++) {
				expect(permanent.filter((line) => line === `✓ Finished ${i}`)).toHaveLength(1);
			}
			expect(permanent.filter((line) => line === '✓ Parent finished')).toHaveLength(1);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('bounds active rows and promotes hidden activities as visible ones finish', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(40, 4);
			const out = createOutput({ isTTY: true, stderr: screen.write, getTerminalSize: screen.size });
			const handles = Array.from({ length: 10 }, (_, i) =>
				out.spinner(`Job ${i}`, { concurrent: true }),
			);
			expect(screen.lines()).toEqual(['⠋ Job 0', '⠋ Job 1', '8 more activities']);
			const historyBefore = screen.history();
			vi.advanceTimersByTime(800);
			expect(screen.history()).toEqual(historyBefore);
			handles[9]?.update('Last job updated');
			for (const handle of handles.slice(0, 8)) handle.stop();
			expect(screen.lines()).toEqual(['⠋ Job 8', '⠋ Last job updated']);
			for (const handle of handles) handle.stop();
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('bounds redraws after shrinking an occupied viewport, then expands on growth', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(40, 12);
			const out = createOutput({ isTTY: true, stderr: screen.write, getTerminalSize: screen.size });
			const handles = Array.from({ length: 10 }, (_, i) =>
				out.spinner(`Job ${i}`, { concurrent: true }),
			);
			screen.resize(40, 4);
			vi.advanceTimersByTime(80);
			expect(screen.lines()).toEqual(['⠙ Job 0', '⠙ Job 1', '8 more activities']);
			const historyAfterResize = screen.history();
			vi.advanceTimersByTime(800);
			expect(screen.history()).toEqual(historyAfterResize);
			screen.resize(40, 12);
			vi.advanceTimersByTime(80);
			expect(screen.lines()).toHaveLength(10);
			expect(screen.lines()).toContain('⠹ Job 9');
			for (const handle of handles) handle.stop();
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('uses a single overflow row in a two-row terminal', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(40, 2);
			const out = createOutput({ isTTY: true, stderr: screen.write, getTerminalSize: screen.size });
			const handles = Array.from({ length: 4 }, (_, i) =>
				out.spinner(`Job ${i}`, { concurrent: true }),
			);
			expect(screen.lines()).toEqual(['4 more activities']);
			const historyBefore = screen.history();
			vi.advanceTimersByTime(800);
			expect(screen.history()).toEqual(historyBefore);
			for (const handle of handles.slice(0, 3)) handle.stop();
			expect(screen.lines()).toEqual(['⠋ Job 3']);
			handles[3]?.stop();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it.each([
		undefined,
		{ columns: 40, rows: 1 },
		{ columns: 0, rows: 4 },
		{ columns: 40, rows: Number.NaN },
	])('uses static lifecycle output when dimensions are unusable: %s', (size) => {
		vi.useFakeTimers();
		try {
			const output: string[] = [];
			const out = createOutput({
				isTTY: true,
				stderr: (text) => output.push(text),
				getTerminalSize: () => size,
			});
			const spinner = out.spinner('Loading', { concurrent: true });
			const progress = out.progress({ label: 'Uploading', concurrent: true });
			spinner.update('Still loading');
			vi.advanceTimersByTime(800);
			expect(output).toEqual(['Loading\n', 'Uploading\n']);
			expect(vi.getTimerCount()).toBe(0);
			spinner.succeed('Loaded');
			progress.done('Uploaded');
			expect(output).toEqual(['Loading\n', 'Uploading\n', '✓ Loaded\n', '✓ Uploaded\n']);
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops animation if dimensions become unavailable and recovers on the next block', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(40, 4);
			let available = true;
			const output: string[] = [];
			const out = createOutput({
				isTTY: true,
				stderr: (text) => {
					output.push(text);
					screen.write(text);
				},
				getTerminalSize: () => (available ? screen.size() : undefined),
			});
			const spinner = out.spinner('Loading', { concurrent: true });
			available = false;
			vi.advanceTimersByTime(80);
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
			const before = output.join('');
			vi.advanceTimersByTime(800);
			expect(output.join('')).toBe(before);
			spinner.succeed('Loaded');
			available = true;
			const next = out.spinner('Next', { concurrent: true });
			expect(screen.lines()).toContain('⠋ Next');
			expect(vi.getTimerCount()).toBe(1);
			next.stop();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('concurrent viewport integration', () => {
	it('keeps redraws stable after wrapped wide output and width changes', () => {
		vi.useFakeTimers();
		try {
			const screen = terminal(12, 4);
			const out = createOutput({
				isTTY: true,
				stderr: screen.write,
				stdout: screen.write,
				getTerminalSize: screen.size,
			});
			const first = out.spinner('界'.repeat(20), { concurrent: true });
			const second = out.spinner('Second', { concurrent: true });
			out.log('界'.repeat(20));
			const historyAfterMessage = screen.history();
			vi.advanceTimersByTime(800);
			expect(screen.history()).toEqual(historyAfterMessage);
			screen.resize(8, 4);
			first.update('Short');
			const historyAfterResize = screen.history();
			vi.advanceTimersByTime(800);
			expect(screen.history()).toEqual(historyAfterResize);
			expect(screen.lines().slice(-2)).toEqual(['⠋ Short', '⠋ Second']);
			first.stop();
			second.stop();
			expect(screen.cursor()).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('reads live adapter dimensions through cli.run()', async () => {
		const screen = terminal(40, 8);
		const observed: string[][] = [];
		const adapter = {
			...createTestAdapter({ isTTY: true, stderr: screen.write }),
			getTerminalSize: screen.size,
		};
		const app = cli('app').default(
			command('work').action(({ out }) => {
				const handles = Array.from({ length: 5 }, (_, i) =>
					out.spinner(`Job ${i}`, { concurrent: true }),
				);
				observed.push(screen.lines());
				screen.resize(40, 3);
				handles[0]?.update('Updated');
				observed.push(screen.lines());
				for (const handle of handles) handle.stop();
			}),
		);
		await expect(app.run({ adapter })).rejects.toMatchObject({ code: 0 });
		expect(observed[0]).toHaveLength(5);
		expect(observed[1]).toEqual(['⠋ Updated', '4 more activities']);
		expect(screen.cursor()).toBe(true);
	});
});
