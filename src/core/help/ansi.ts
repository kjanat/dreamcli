/**
 * ANSI/OSC-aware text helpers for help formatting.
 *
 * Terminal escape sequences (SGR colors, OSC 8 hyperlinks) occupy zero
 * columns when rendered, so width math must measure the *visible* text.
 * {@linkcode visibleWidth} strips escapes before counting, and the shared
 * {@linkcode padEnd}/{@linkcode wrapText} helpers build on it so aligned
 * tables and wrapped lines stay intact when escapes are present.
 *
 * @module dreamcli/core/help/ansi
 */

// --- Terminal control characters

/** `ESC` — introduces every ANSI escape sequence. */
const ESC = '\u001B';
/** `BEL` — the legacy OSC terminator (the other being `ESC \`, i.e. ST). */
const BEL = '\u0007';
/** OSC introducer: `ESC ]`. */
const OSC = `${ESC}]`;

// --- Escape stripping

/**
 * Matches ANSI escape sequences: CSI (e.g. SGR color codes like `ESC [31m`)
 * and OSC (e.g. OSC 8 hyperlinks), with both BEL and ST terminators.
 *
 * Composed from the {@link ESC}/{@link BEL} constants instead of written as a
 * regex literal, so the control characters this module matches and the ones it
 * emits have a single definition.
 *
 * @internal
 */
const ANSI_PATTERN = new RegExp(
	`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\))`,
	'g',
);

/**
 * Remove ANSI CSI and OSC escape sequences from `text`.
 *
 * @param text - Text possibly containing terminal escapes.
 * @returns The text with all escape sequences removed.
 */
function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, '');
}

/**
 * Measure the visible column width of `text`, ignoring ANSI/OSC escapes.
 *
 * Escape sequences (SGR colors, OSC 8 hyperlinks) occupy zero columns when
 * rendered, so `.length` overcounts whenever they are present. Help
 * formatting uses this for padding and wrapping; exported for custom help
 * renderers that mix colors or links into aligned output.
 *
 * @param text - Text possibly containing terminal escapes.
 * @returns Number of visible characters.
 *
 * @example
 * ```ts
 * visibleWidth('plain');                     // 5
 * visibleWidth(osc8('https://x.dev', 'x')); // 1
 * ```
 */
function visibleWidth(text: string): number {
	return stripAnsi(text).length;
}

// --- OSC 8 hyperlinks

/**
 * Wrap `text` in an [OSC 8 hyperlink](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda)
 * pointing at `url`.
 *
 * Supporting terminals render `text` as a clickable link; non-supporting
 * terminals ignore the escape sequence and show plain text. Combine with
 * {@linkcode visibleWidth}-aware formatting when embedding links in aligned
 * output.
 *
 * @param url - Link target (string or `URL` instance).
 * @param text - Visible link text.
 * @defaultValue the link target itself, so terminals without OSC 8 support still show a usable URL.
 * @returns The OSC 8 escape sequence wrapping `text`.
 *
 * @example
 * ```ts
 * cli('mycli').version(osc8('https://github.com/me/mycli/releases/tag/v1.0.0', '1.0.0'));
 *
 * osc8('https://dreamcli.kjanat.dev'); // linked, displayed as the URL
 * ```
 */
function osc8(url: string | URL, text?: string): string {
	const href = url instanceof URL ? url.href : url;
	return `${OSC}8;;${href}${BEL}${text ?? href}${OSC}8;;${BEL}`;
}

// --- Width-aware padding and wrapping

/**
 * Pad `text` to `length` visible columns with trailing spaces.
 *
 * @param text - The string to pad (may contain ANSI/OSC escapes).
 * @param length - Target visible width in columns.
 * @returns The padded string, unchanged if already at or beyond `length`.
 */
function padEnd(text: string, length: number): string {
	const visible = visibleWidth(text);
	if (visible >= length) return text;
	return text + ' '.repeat(length - visible);
}

/**
 * Wrap text to `width`, preserving leading indent on continuation lines.
 *
 * Line lengths are measured with {@linkcode visibleWidth}, so embedded
 * ANSI/OSC escapes do not trigger premature wrapping.
 *
 * @param text - The text to wrap.
 * @param width - Maximum line width in columns.
 * @param indent - Number of leading spaces for continuation lines.
 * @returns The wrapped string with newlines inserted as needed.
 */
function wrapText(text: string, width: number, indent: number): string {
	if (visibleWidth(text) + indent <= width) return text;

	const maxLen = width - indent;
	if (maxLen <= 0) return text;

	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';
	let currentWidth = 0;

	for (const word of words) {
		const wordWidth = visibleWidth(word);
		if (current.length === 0) {
			current = word;
			currentWidth = wordWidth;
		} else if (currentWidth + 1 + wordWidth <= maxLen) {
			current += ` ${word}`;
			currentWidth += 1 + wordWidth;
		} else {
			lines.push(current);
			current = word;
			currentWidth = wordWidth;
		}
	}
	if (current.length > 0) {
		lines.push(current);
	}

	const pad = ' '.repeat(indent);
	return lines.map((line, i) => (i === 0 ? line : `${pad}${line}`)).join('\n');
}

// --- Exports

export { osc8, padEnd, stripAnsi, visibleWidth, wrapText };
