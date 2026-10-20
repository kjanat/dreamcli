/** Shared line and hidden-input reader for runtime adapters.
 * @module dreamcli/runtime/input
 * @internal
 */
import { CLIError } from '#internals/core/errors/index.ts';
import { PromptCancelledError } from '#internals/core/prompt/errors.ts';
import type { ReadFn } from '#internals/core/prompt/index.ts';

/** One input stream owns the buffer, decoder, and raw-mode lifetime. */
export function createInputReader(
	readChunk: () => Promise<string | null>,
	enterRaw?: () => () => void,
): { readonly readLine: ReadFn; readonly readSecret?: ReadFn } {
	let buffer = '';
	let bufferWasSecret = false;
	let ended = false;
	let active = false;
	let skipLF = false;
	const fill = async (secret: boolean): Promise<boolean> => {
		while (buffer === '' && !ended) {
			const chunk = await readChunk();
			if (chunk === null) ended = true;
			else {
				buffer = chunk;
				bufferWasSecret = secret;
			}
		}
		if (skipLF && buffer !== '') {
			if (buffer.startsWith('\n')) buffer = buffer.slice(1);
			skipLF = false;
			if (buffer === '' && !ended) return fill(secret);
		}
		return buffer !== '';
	};
	const read = async (secret: boolean): Promise<string | null> => {
		if (active) throw new CLIError('An input read is already active', { code: 'PROMPT_BUSY' });
		active = true;
		let restore: (() => void) | undefined;
		try {
			if (secret) {
				restore = enterRaw?.();
				// Ordinary reads may have captured additional lines with terminal echo on.
				if (!bufferWasSecret) {
					buffer = '';
					skipLF = false;
				}
			}
			let answer = '';
			for (;;) {
				if (!(await fill(secret))) return secret || answer === '' ? null : answer;
				if (!secret) {
					const newline = buffer.indexOf('\n');
					if (newline !== -1) {
						const line = answer + buffer.slice(0, newline);
						buffer = buffer.slice(newline + 1);
						return line.replace(/\r$/, '');
					}
					answer += buffer;
					buffer = '';
					continue;
				}
				const char = String.fromCodePoint(buffer.codePointAt(0) ?? 0);
				buffer = buffer.slice(char.length);
				switch (char) {
					case '\r':
						skipLF = true;
						return answer;
					case '\n':
						return answer;
					case '\u0003':
						throw new PromptCancelledError('interrupt');
					case '\u001b':
						throw new PromptCancelledError('escape');
					case '\u0004':
					case '\u001a':
						return null;
					case '\u007f':
					case '\b':
						answer = Array.from(answer).slice(0, -1).join('');
						break;
					case '\u0015':
						answer = '';
						break;
					case '\u0017':
						answer = answer.replace(/\s*\S+\s*$/, '');
						break;
					default:
						if (char >= ' ' || char === '\t') answer += char;
				}
			}
		} finally {
			try {
				restore?.();
			} finally {
				active = false;
			}
		}
	};
	return {
		readLine: () => read(false),
		...(enterRaw !== undefined ? { readSecret: () => read(true) } : {}),
	};
}
