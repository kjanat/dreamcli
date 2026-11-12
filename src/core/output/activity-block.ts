/**
 * Shared terminal lines for concurrent spinner and progress handles.
 * @module dreamcli/core/output/activity-block
 * @internal
 */

import type { ActivityLine } from './activity.ts';
import type { WriteFn } from './writer.ts';

interface BlockLine {
	text: string | undefined;
	active: boolean;
}

class ActivityBlock {
	private readonly lines = new Set<BlockLine>();
	private renderedLines = 0;

	constructor(private readonly write: WriteFn) {}

	line(): ActivityLine {
		if (this.lines.size === 0) this.write('\x1b[?25l');
		const line: BlockLine = { text: undefined, active: true };
		this.lines.add(line);
		return {
			update: (text) => {
				if (!line.active) return;
				line.text = text.replace(/[\r\n]+/g, ' ');
				this.render();
			},
			finish: (text) => {
				if (!line.active) return;
				line.active = false;
				line.text = text?.replace(/[\r\n]+/g, ' ');
				this.render();
				if (![...this.lines].some((entry) => entry.active)) {
					this.lines.clear();
					this.renderedLines = 0;
					this.write('\x1b[?25h');
				}
			},
		};
	}

	writeMessage(writer: WriteFn, text: string): void {
		this.clear();
		writer(text);
		this.render();
	}

	private clear(): void {
		if (this.renderedLines === 0) return;
		this.write(`\x1b[${this.renderedLines}A\r\x1b[J`);
		this.renderedLines = 0;
	}

	private render(): void {
		this.clear();
		const rows = [...this.lines].flatMap((line) => (line.text === undefined ? [] : [line.text]));
		if (rows.length === 0) return;
		// Keep each activity on one physical row even when its text exceeds the terminal width.
		this.write(`\x1b[?7l${rows.map((text) => `\r${text}\n`).join('')}\r\x1b[?7h`);
		this.renderedLines = rows.length;
	}
}

export { ActivityBlock };
