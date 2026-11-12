/**
 * Shared terminal lines for concurrent spinner and progress handles.
 * @module dreamcli/core/output/activity-block
 * @internal
 */

import type { TerminalSize } from '#internals/runtime/adapter.ts';
import type { ActivityLine } from './activity.ts';
import type { WriteFn } from './writer.ts';

interface BlockLine {
	text: string | undefined;
	readonly label: string | undefined;
}

class ActivityBlock {
	private readonly lines = new Set<BlockLine>();
	private renderedLines = 0;
	private cursorHidden = false;
	private staticFallback = false;
	private frame: { text: string; columns: number; rows: number } | undefined;

	constructor(
		private readonly write: WriteFn,
		private readonly getTerminalSize?: () => TerminalSize | undefined,
	) {}

	line(label?: string): ActivityLine {
		const line: BlockLine = { text: undefined, label };
		this.lines.add(line);
		const block = this;
		return {
			get animated() {
				return !block.staticFallback;
			},
			update: (text) => {
				if (!this.lines.has(line)) return;
				const initial = line.text === undefined;
				line.text = text.replace(/[\r\n]+/g, ' ');
				this.render(undefined, initial ? line : undefined);
			},
			finish: (text) => {
				if (!this.lines.delete(line)) return;
				this.render(text?.replace(/[\r\n]+/g, ' '));
				if (this.lines.size === 0) this.staticFallback = false;
			},
		};
	}

	writeMessage(writer: WriteFn, text: string): void {
		this.clear(this.readSize());
		writer(text);
		this.render();
	}

	private readSize(): TerminalSize | undefined {
		if (this.staticFallback) return undefined;
		try {
			const size = this.getTerminalSize?.();
			if (
				size !== undefined &&
				Number.isInteger(size.rows) &&
				size.rows > 1 &&
				Number.isInteger(size.columns) &&
				size.columns > 0
			)
				return size;
		} catch {
			// An unavailable terminal size uses the same static fallback as a missing size.
		}
		return undefined;
	}

	private showCursor(): void {
		if (!this.cursorHidden) return;
		this.write('\x1b[?25h');
		this.cursorHidden = false;
	}

	private clear(size: TerminalSize | undefined): void {
		this.frame = undefined;
		if (this.renderedLines === 0) return;
		if (size === undefined) {
			// Cursor position is unknown after losing dimensions. Leave the old frame once.
			this.write('\r\n');
			this.staticFallback = true;
		} else {
			const visible = Math.min(this.renderedLines, size.rows - 1);
			this.write(`\x1b[${visible}A\r\x1b[J`);
		}
		this.renderedLines = 0;
	}

	private render(permanent?: string, initial?: BlockLine): void {
		const size = this.readSize();
		if (size === undefined) {
			this.clear(size);
			this.showCursor();
			if (this.lines.size > 0) this.staticFallback = true;
			const text = permanent ?? initial?.label;
			if (text !== undefined) this.write(`${text}\n`);
			return;
		}

		const rows = [...this.lines].flatMap((line) => (line.text === undefined ? [] : [line.text]));
		const capacity = size.rows - 1;
		const visible =
			rows.length <= capacity
				? rows
				: [...rows.slice(0, capacity - 1), `${rows.length - capacity + 1} more activities`];
		const text = visible.map((line) => `\r${line}\n`).join('');
		if (
			permanent === undefined &&
			this.cursorHidden &&
			this.renderedLines === visible.length &&
			this.frame?.text === text &&
			this.frame.columns === size.columns &&
			this.frame.rows === size.rows
		)
			return;

		this.clear(size);
		if (permanent !== undefined) this.write(`${permanent}\n`);
		if (visible.length === 0) {
			this.showCursor();
			return;
		}
		if (!this.cursorHidden) {
			this.write('\x1b[?25l');
			this.cursorHidden = true;
		}
		// Disable wrapping so long or wide labels still occupy one physical terminal row.
		this.write(`\x1b[?7l${text}\r\x1b[?7h`);
		this.renderedLines = visible.length;
		this.frame = { text, columns: size.columns, rows: size.rows };
	}
}

export { ActivityBlock };
