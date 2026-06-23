import { describe, expect, it } from 'vitest';
import { BACKSLASH, SLASH, stripTrailing } from './strings.ts';

describe('stripTrailing', () => {
	it('removes trailing forward slashes', () => {
		expect(stripTrailing('a/b///', [SLASH])).toBe('a/b');
	});

	it('removes trailing forward slashes and backslashes', () => {
		expect(stripTrailing('a\\b\\/\\', [SLASH, BACKSLASH])).toBe('a\\b');
	});

	it('leaves interior and leading separators untouched', () => {
		expect(stripTrailing('/a/b', [SLASH])).toBe('/a/b');
	});

	it('returns the original string when nothing is trimmed', () => {
		const input = 'no-trailing';
		expect(stripTrailing(input, [SLASH, BACKSLASH])).toBe(input);
	});

	it('collapses an all-separator string to empty', () => {
		expect(stripTrailing('////', [SLASH])).toBe('');
	});

	it('handles the empty string', () => {
		expect(stripTrailing('', [SLASH])).toBe('');
	});

	it('only strips backslashes when forward slash is absent from the set', () => {
		expect(stripTrailing('path\\/', [SLASH])).toBe('path\\');
	});

	it('runs linearly on adversarial slash-heavy input', () => {
		const adversarial = `${'/'.repeat(100_000)}x`;
		expect(stripTrailing(adversarial, [SLASH])).toBe(adversarial);
	});
});
