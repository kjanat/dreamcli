import { describe, expect, it } from 'vitest';
import type { TableColumn } from '#internals/core/schema/index.ts';
import { createCaptureOutput } from './index.ts';

// === table

describe('table', () => {
	// --- normal mode

	describe('normal mode', () => {
		it('renders a simple table with auto-inferred columns', () => {
			const [out, captured] = createCaptureOutput();
			out.table([
				{ name: 'Alice', age: 30 },
				{ name: 'Bob', age: 25 },
			]);
			const text = captured.stdout.join('');
			expect(text).toContain('name');
			expect(text).toContain('age');
			expect(text).toContain('Alice');
			expect(text).toContain('Bob');
			expect(text).toContain('30');
			expect(text).toContain('25');
		});

		it('renders with explicit column descriptors', () => {
			const [out, captured] = createCaptureOutput();
			out.table(
				[
					{ id: 1, name: 'Alice', email: 'alice@example.com' },
					{ id: 2, name: 'Bob', email: 'bob@example.com' },
				],
				[
					{ key: 'name', header: 'Name' },
					{ key: 'email', header: 'Email' },
				],
			);
			const text = captured.stdout.join('');
			// Only the selected columns should appear
			expect(text).toContain('Name');
			expect(text).toContain('Email');
			expect(text).toContain('Alice');
			expect(text).toContain('bob@example.com');
			// 'id' column not included — not in explicit columns
			expect(text).not.toContain('id');
		});

		it('aligns columns based on widest value', () => {
			const [out, captured] = createCaptureOutput();
			out.table([
				{ name: 'A', value: 'short' },
				{ name: 'LongName', value: 'x' },
			]);
			const lines = captured.stdout.join('').trimEnd().split('\n');
			// Header, separator, 2 data rows
			expect(lines).toHaveLength(4);
			// The 'name' column width should accommodate 'LongName' (8 chars)
			// Both rows should have 'name' padded to the same width
			const row1 = lines[2] ?? '';
			const row2 = lines[3] ?? '';
			// 'A' should be padded so both rows share the same column offset
			const col1Width = row1.indexOf('short') - 0;
			const col2Width = row2.indexOf('x') - 0;
			expect(col1Width).toBe(col2Width);
		});

		it('uses key as header when header is omitted', () => {
			const [out, captured] = createCaptureOutput();
			out.table([{ myKey: 'val' }], [{ key: 'myKey' }]);
			const text = captured.stdout.join('');
			expect(text).toContain('myKey');
		});

		it('renders separator line under headers', () => {
			const [out, captured] = createCaptureOutput();
			out.table([{ a: 1, b: 2 }]);
			const lines = captured.stdout.join('').trimEnd().split('\n');
			expect(lines).toHaveLength(3); // header, separator, 1 data row
			// Separator line should contain dashes
			expect(lines[1]).toMatch(/^[-\s]+$/);
		});

		it('handles null and undefined cell values as empty string', () => {
			const [out, captured] = createCaptureOutput();
			out.table([{ a: null, b: undefined, c: 'ok' }]);
			const text = captured.stdout.join('');
			expect(text).toContain('ok');
			// null/undefined should not appear as literal text
			expect(text).not.toContain('null');
			expect(text).not.toContain('undefined');
		});

		it('produces no output for empty rows array', () => {
			const [out, captured] = createCaptureOutput();
			out.table([]);
			expect(captured.stdout).toEqual([]);
		});

		it('handles single-row table', () => {
			const [out, captured] = createCaptureOutput();
			out.table([{ x: 42 }]);
			const lines = captured.stdout.join('').trimEnd().split('\n');
			expect(lines).toHaveLength(3); // header, separator, 1 data row
			expect(lines[2]).toContain('42');
		});

		it('handles rows with numeric and boolean values', () => {
			const [out, captured] = createCaptureOutput();
			out.table([{ count: 99, active: true }]);
			const text = captured.stdout.join('');
			expect(text).toContain('99');
			expect(text).toContain('true');
		});

		it('serializes object cell values as JSON', () => {
			const [out, captured] = createCaptureOutput();
			out.table([{ meta: { role: 'admin' } }]);
			const text = captured.stdout.join('');
			expect(text).toContain('{"role":"admin"}');
		});

		it('can route text tables to stderr explicitly with columns and options', () => {
			const [out, captured] = createCaptureOutput();
			out.table([{ name: 'Alice' }], [{ key: 'name', header: 'Name' }], {
				format: 'text',
				stream: 'stderr',
			});
			expect(captured.stdout).toEqual([]);
			expect(captured.stderr.join('')).toContain('Alice');
		});
	});

	// --- JSON mode

	describe('JSON mode', () => {
		it('emits rows as JSON array to stdout', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			const rows = [
				{ name: 'Alice', age: 30 },
				{ name: 'Bob', age: 25 },
			];
			out.table(rows);
			expect(captured.stdout).toEqual([`${JSON.stringify(rows)}\n`]);
		});

		it('does not emit text table in JSON mode', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			out.table([{ a: 1 }]);
			// Should be valid JSON, not a text table
			const parsed: unknown = JSON.parse(captured.stdout.join(''));
			expect(Array.isArray(parsed)).toBe(true);
		});

		it('emits empty array for empty rows in JSON mode', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			out.table([]);
			expect(captured.stdout).toEqual(['[]\n']);
		});

		it('projects columns in JSON mode — emits only listed keys', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			const rows = [{ id: 1, name: 'Alice', extra: true }];
			out.table(rows, [{ key: 'name' }]);
			const parsed: unknown = JSON.parse(captured.stdout.join(''));
			expect(parsed).toEqual([{ name: 'Alice' }]);
		});

		it('can force text tables in JSON mode and defaults them to stderr', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			out.table([{ name: 'Alice' }], { format: 'text' });
			expect(captured.stdout).toEqual([]);
			expect(captured.stderr.join('')).toContain('Alice');
		});

		it('can force JSON output in normal mode', () => {
			const [out, captured] = createCaptureOutput();
			const rows = [{ name: 'Alice' }];
			out.table(rows, { format: 'json' });
			expect(captured.stdout).toEqual([`${JSON.stringify(rows)}\n`]);
			expect(captured.stderr).toEqual([]);
		});

		it('preserves explicit options when columns argument is undefined', () => {
			const [out, captured] = createCaptureOutput();
			const rows = [{ name: 'Alice' }];
			const columns: readonly TableColumn<(typeof rows)[number]>[] | undefined = undefined;
			out.table(rows, columns, { format: 'json' });
			expect(captured.stdout).toEqual([`${JSON.stringify(rows)}\n`]);
			expect(captured.stderr).toEqual([]);
		});

		it('preserves text-stream overrides when columns argument is undefined', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			const rows = [{ name: 'Alice' }];
			const columns: readonly TableColumn<(typeof rows)[number]>[] | undefined = undefined;
			out.table(rows, columns, { format: 'text' });
			expect(captured.stdout).toEqual([]);
			expect(captured.stderr.join('')).toContain('Alice');
		});
	});

	// --- piped mode

	describe('piped mode', () => {
		it('renders aligned text in non-TTY mode', () => {
			const [out, captured] = createCaptureOutput({ isTTY: false });
			out.table([
				{ name: 'Alice', role: 'admin' },
				{ name: 'Bob', role: 'user' },
			]);
			const text = captured.stdout.join('');
			// Should still be a text table, not JSON
			expect(text).toContain('name');
			expect(text).toContain('Alice');
			expect(text).not.toMatch(/^\[/); // not JSON
		});
	});

	// --- combined with other output

	describe('combined with other output', () => {
		it('table output goes to stdout via log()', () => {
			const [out, captured] = createCaptureOutput();
			out.log('before');
			out.table([{ x: 1 }]);
			out.log('after');
			expect(captured.stdout).toHaveLength(3);
			expect(captured.stdout[0]).toBe('before\n');
			expect(captured.stdout[2]).toBe('after\n');
		});

		it('in JSON mode, table goes to stdout and log goes to stderr', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			out.log('text');
			out.table([{ a: 1 }]);
			// log redirected to stderr in JSON mode
			expect(captured.stderr).toEqual(['text\n']);
			// table emits JSON to stdout
			expect(captured.stdout).toEqual(['[{"a":1}]\n']);
		});
	});

	// --- column keys naming an Object.prototype member

	describe('column keys naming an Object.prototype member', () => {
		it('leaves the cell empty on a row that does not carry the key', () => {
			const [out, captured] = createCaptureOutput();
			out.table<Record<string, unknown>>(
				[{ id: 1, toString: 'own' }, { id: 2 }],
				[
					{ key: 'id', header: 'ID' },
					{ key: 'toString', header: 'Label' },
					{ key: 'absent', header: 'Absent' },
				],
			);
			const lines = captured.stdout.join('').split('\n');
			expect(lines[2]?.trimEnd()).toBe('1   own');
			expect(lines[3]?.trimEnd()).toBe('2');
		});

		it('renders every Object.prototype member name as an empty cell', () => {
			const names = Object.getOwnPropertyNames(Object.prototype).filter(
				(name) => name !== '__proto__',
			);
			expect(names).toHaveLength(11);

			for (const name of names) {
				const [out, captured] = createCaptureOutput();
				out.table<Record<string, unknown>>(
					[{ id: 1 }],
					[
						{ key: 'id', header: 'ID' },
						{ key: name, header: 'H' },
					],
				);
				const lines = captured.stdout.join('').split('\n');
				expect(lines[2]?.trimEnd()).toBe('1');
			}
		});

		it('omits the key from the JSON projection on a row that lacks it', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			out.table<Record<string, unknown>>(
				[{ id: 1, toString: 'own' }, { id: 2 }],
				[
					{ key: 'id', header: 'ID' },
					{ key: 'toString', header: 'Label' },
				],
			);
			expect(captured.stdout).toEqual(['[{"id":1,"toString":"own"},{"id":2}]\n']);
		});
	});

	// --- column keys held by the row's own prototype chain

	describe('column keys the row inherits from its own prototype', () => {
		class Server {
			readonly [key: string]: unknown;
			constructor(
				readonly host: string,
				readonly port: number,
			) {}
			get address(): string {
				return `${this.host}:${this.port}`;
			}
		}

		it('renders a class getter', () => {
			const [out, captured] = createCaptureOutput();
			out.table(
				[new Server('web-1', 80)],
				[
					{ key: 'host', header: 'Host' },
					{ key: 'address', header: 'Address' },
				],
			);
			const lines = captured.stdout.join('').split('\n');
			expect(lines[2]?.trimEnd()).toBe('web-1  web-1:80');
		});

		it('keeps the class getter in the JSON projection', () => {
			const [out, captured] = createCaptureOutput({ jsonMode: true });
			out.table(
				[new Server('web-1', 80)],
				[
					{ key: 'host', header: 'Host' },
					{ key: 'address', header: 'Address' },
				],
			);
			expect(captured.stdout).toEqual(['[{"host":"web-1","address":"web-1:80"}]\n']);
		});

		it('renders a value inherited from an Object.create() base', () => {
			const [out, captured] = createCaptureOutput();
			const row: Record<string, unknown> = Object.create({ status: 'pending' });
			row['id'] = 1;

			out.table<Record<string, unknown>>(
				[row],
				[
					{ key: 'id', header: 'ID' },
					{ key: 'status', header: 'Status' },
				],
			);
			const lines = captured.stdout.join('').split('\n');
			expect(lines[2]?.trimEnd()).toBe('1   pending');
		});

		it('still blanks an Object.prototype member on such a row', () => {
			const [out, captured] = createCaptureOutput();
			const row: Record<string, unknown> = Object.create({ status: 'pending' });
			row['id'] = 1;

			out.table<Record<string, unknown>>(
				[row],
				[
					{ key: 'id', header: 'ID' },
					{ key: 'toString', header: 'Label' },
				],
			);
			const lines = captured.stdout.join('').split('\n');
			expect(lines[2]?.trimEnd()).toBe('1');
		});
	});
});
