/**
 * Syntax colors for serialized JSON in terminal output.
 * @module dreamcli/core/output/json
 * @internal
 */

import type { Colors } from 'ansispeck';

function colorJson(text: string, colors: Colors): string {
	const parts: string[] = [];
	let plainStart = 0;
	let offset = 0;
	while (offset < text.length) {
		const start = offset;
		const char = text.charAt(offset);
		let color: (value: string) => string;
		if (char === '"') {
			offset++;
			while (offset < text.length && text[offset] !== '"') {
				offset += text[offset] === '\\' ? 2 : 1;
			}
			if (offset >= text.length) break;
			offset++;
			let next = offset;
			while (text.charCodeAt(next) <= 0x20) next++;
			color = text[next] === ':' ? colors.cyan : colors.green;
		} else if (char === '-' || (char >= '0' && char <= '9')) {
			offset++;
			while (offset < text.length && '0123456789.eE+-'.includes(text.charAt(offset))) offset++;
			color = colors.yellow;
		} else if (char === 't' || char === 'f' || char === 'n') {
			// Input comes from JSON.stringify, so these are true, false, and null.
			offset += char === 'f' ? 5 : 4;
			color = colors.magenta;
		} else {
			offset++;
			continue;
		}
		parts.push(text.slice(plainStart, start), color(text.slice(start, offset)));
		plainStart = offset;
	}
	parts.push(text.slice(plainStart));
	return parts.join('');
}

export { colorJson };
