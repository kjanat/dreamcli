/**
 * Unit tests for ANSI/OSC-aware text helpers.
 *
 * Tests osc8() hyperlink construction, escape stripping, visible-width
 * measurement, and the escape-aware padEnd()/wrapText() used by help
 * formatting.
 */
import { describe, expect, it } from 'vitest';
import { osc8, padEnd, stripAnsi, visibleWidth, wrapText } from './ansi.ts';

// === osc8 — hyperlink construction

describe('osc8 — hyperlink construction', () => {
	it('wraps text in an OSC 8 hyperlink terminated by BEL', () => {
		expect(osc8('https://example.com', 'name')).toBe(
			'\u001B]8;;https://example.com\u0007name\u001B]8;;\u0007',
		);
	});

	it('accepts a URL instance', () => {
		expect(osc8(new URL('https://example.com/path'), 'x')).toBe(
			'\u001B]8;;https://example.com/path\u0007x\u001B]8;;\u0007',
		);
	});

	it('defaults the visible text to the link target', () => {
		const link = osc8('https://example.com');
		expect(link).toBe(osc8('https://example.com', 'https://example.com'));
		expect(stripAnsi(link)).toBe('https://example.com');
	});

	it('defaults to the normalized href for a URL instance', () => {
		// `new URL('https://example.com')` serializes with a trailing slash, and the displayed text must be the same href the link points at.
		const link = osc8(new URL('https://example.com'));
		expect(stripAnsi(link)).toBe('https://example.com/');
		expect(link).toBe(osc8('https://example.com/', 'https://example.com/'));
	});

	it('treats an explicit undefined text as omitted', () => {
		expect(osc8('https://example.com', undefined)).toBe(osc8('https://example.com'));
	});
});

// === stripAnsi / visibleWidth — escape-aware measurement

describe('stripAnsi / visibleWidth — escape-aware measurement', () => {
	it('passes plain text through unchanged', () => {
		expect(stripAnsi('plain text')).toBe('plain text');
		expect(visibleWidth('plain text')).toBe(10);
	});

	it('strips OSC 8 hyperlinks down to the visible text', () => {
		const linked = osc8('https://example.com', 'name');
		expect(stripAnsi(linked)).toBe('name');
		expect(visibleWidth(linked)).toBe(4);
	});

	it('strips ST-terminated OSC sequences', () => {
		const linked = '\u001B]8;;https://example.com\u001B\\name\u001B]8;;\u001B\\';
		expect(stripAnsi(linked)).toBe('name');
	});

	it('strips CSI sequences (SGR colors)', () => {
		expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red');
		expect(visibleWidth('\u001B[1;4mbold\u001B[0m')).toBe(4);
	});

	it('handles mixed links and colors in one string', () => {
		const text = `\u001B[2m${osc8('https://example.com', 'dim link')}\u001B[0m`;
		expect(visibleWidth(text)).toBe(8);
	});
});

// === padEnd — visible-width padding

describe('padEnd — visible-width padding', () => {
	it('pads plain text to the target width', () => {
		expect(padEnd('ab', 5)).toBe('ab   ');
	});

	it('returns text unchanged at or beyond the target width', () => {
		expect(padEnd('abcde', 5)).toBe('abcde');
		expect(padEnd('abcdef', 5)).toBe('abcdef');
	});

	it('ignores escape sequences when computing padding', () => {
		const linked = osc8('https://example.com', 'ab');
		const padded = padEnd(linked, 5);
		expect(padded).toBe(`${linked}   `);
		expect(visibleWidth(padded)).toBe(5);
	});
});

// === wrapText — visible-width wrapping

describe('wrapText — visible-width wrapping', () => {
	it('leaves short text unwrapped', () => {
		expect(wrapText('short text', 80, 4)).toBe('short text');
	});

	it('wraps long text with continuation indentation', () => {
		const wrapped = wrapText('aaa bbb ccc ddd', 10, 2);
		expect(wrapped).toBe('aaa bbb\n  ccc ddd');
	});

	it('does not wrap when escapes inflate the raw length past the width', () => {
		// Visible: 'link text' (9 cols) — raw length far exceeds width 20.
		const text = `${osc8('https://example.com/very/long/url/that/inflates/length', 'link')} text`;
		expect(text.length).toBeGreaterThan(20);
		expect(wrapText(text, 20, 4)).toBe(text);
	});

	it('measures linked words by visible width when wrapping', () => {
		const linked = osc8('https://example.com/some/long/url', 'bbb');
		const wrapped = wrapText(`aaa ${linked} ccc ddd`, 10, 2);
		expect(wrapped).toBe(`aaa ${linked}\n  ccc ddd`);
	});

	it('returns text unchanged when indent consumes the full width', () => {
		expect(wrapText('aaa bbb ccc ddd ee', 4, 4)).toBe('aaa bbb ccc ddd ee');
	});
});
