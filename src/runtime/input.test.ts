/** Hidden reads preserve content and restore terminal state on all exits. */
import { describe, expect, it } from 'vitest';
import { createInputReader } from './input.ts';

function reader(chunks: string[], initialRaw = false) {
	let raw = initialRaw;
	const changes: boolean[] = [];
	const input = createInputReader(
		async () => chunks.shift() ?? null,
		() => {
			const previous = raw;
			raw = true;
			changes.push(raw);
			return () => {
				raw = previous;
				changes.push(raw);
			};
		},
	);
	return { ...input, changes, isRaw: () => raw };
}

describe('runtime hidden input', () => {
	it('preserves whitespace, Unicode, backspace, and subsequent ordinary reads', async () => {
		const input = reader(['  päss😀x\u007f  \r\nnext\n']);
		expect(await input.readSecret?.()).toBe('  päss😀  ');
		expect(await input.readLine()).toBe('next');
		expect(input.changes).toEqual([true, false]);
	});

	it.each([
		['\u0003', 'interrupt'],
		['\u001b', 'escape'],
	] as const)('restores raw mode on %s cancellation', async (key, reason) => {
		const input = reader([key]);
		await expect(input.readSecret?.()).rejects.toMatchObject({ code: 'PROMPT_CANCELLED', reason });
		expect(input.isRaw()).toBe(false);
	});

	it('restores an already-raw terminal to its prior state', async () => {
		const input = reader(['password\n'], true);
		expect(await input.readSecret?.()).toBe('password');
		expect(input.changes).toEqual([true, true]);
	});

	it.each([[], ['\u0004'], ['\u001a'], ['partial\u001a', 'next\n'], ['unterminated secret']])(
		'discards incomplete input on EOF',
		async (...chunks) => {
			const input = reader(chunks);
			expect(await input.readSecret?.()).toBe(null);
			expect(input.isRaw()).toBe(false);
		},
	);

	it('restores terminal state when reading throws', async () => {
		let restored = false;
		const input = createInputReader(
			async () => {
				throw new Error('read failed');
			},
			() => () => {
				restored = true;
			},
		);
		await expect(input.readSecret?.()).rejects.toThrow('read failed');
		expect(restored).toBe(true);
	});

	it('does not advertise hidden input without a raw-mode capability', () => {
		expect(createInputReader(async () => null).readSecret).toBeUndefined();
	});
});
