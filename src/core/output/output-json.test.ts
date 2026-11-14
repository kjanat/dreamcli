import { describe, expect, it } from 'vitest';
import { stripAnsi } from '#internals/core/help/ansi.ts';
import { createCaptureOutput } from './index.ts';
import { colorJson } from './json.ts';

describe('terminal JSON', () => {
	const value = {
		name: 'a "quoted" string',
		count: -1.2e30,
		enabled: true,
		empty: null,
		nested: [false, '42'],
	};

	it('indents JSON without requiring color', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, color: false });
		out.json(value);
		expect(captured.stdout).toEqual([`${JSON.stringify(value, null, 2)}\n`]);
	});

	it('colors complete tokens without changing the serialized value', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, color: true });
		out.json(value);
		const output = captured.stdout.join('');
		expect(stripAnsi(output)).toBe(`${JSON.stringify(value, null, 2)}\n`);
		expect(output).toContain(out.color.cyan('"name"'));
		expect(output).toContain(out.color.green(JSON.stringify(value.name)));
		expect(output).toContain(out.color.yellow('-1.2e+30'));
		expect(output).toContain(out.color.magenta('true'));
		expect(output).toContain(out.color.magenta('false'));
		expect(output).toContain(out.color.magenta('null'));
	});

	it('keeps escaped keys and values in complete colored tokens', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, color: true });
		const key = '"\\key\\';
		const values = ['"', '\\', '\\"', '\\\\"', '\n\t\u0000', 'true:null:42', ''];
		out.json({ [key]: values, numbers: [0, -42, 1.25, 1e-7, 1e21] });
		const output = captured.stdout.join('');
		expect(stripAnsi(output)).toBe(
			`${JSON.stringify({ [key]: values, numbers: [0, -42, 1.25, 1e-7, 1e21] }, null, 2)}\n`,
		);
		expect(output).toContain(out.color.cyan(JSON.stringify(key)));
		for (const value of values) expect(output).toContain(out.color.green(JSON.stringify(value)));
		for (const number of ['0', '-42', '1.25', '1e-7', '1e+21']) {
			expect(output).toContain(out.color.yellow(number));
		}
	});

	it('colors a long string with repeated escaped quotes and backslashes', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, color: true });
		const value = '\\"'.repeat(100_000);
		out.json(value);
		expect(captured.stdout).toEqual([`${out.color.green(JSON.stringify(value))}\n`]);
	});

	it('leaves an unterminated escaped string intact without retrying at each quote', () => {
		const [out] = createCaptureOutput({ color: true });
		const text = `"${'\\"'.repeat(100_000)}`;
		expect(colorJson(text, out.color)).toBe(text);
	});

	it.each([{ isTTY: false }, { isTTY: true, jsonMode: true }])(
		'keeps machine output compact with $isTTY TTY',
		(options) => {
			const [out, captured] = createCaptureOutput({ ...options, color: true });
			out.json(value);
			expect(captured.stdout).toEqual([`${JSON.stringify(value)}\n`]);
		},
	);

	it('keeps explicit JSON tables machine-readable in a colored terminal', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, color: true });
		out.table([{ name: 'widget' }], { format: 'json' });
		expect(captured.stdout).toEqual(['[{"name":"widget"}]\n']);
	});

	it.each([null, false, 42, 'text', undefined])('preserves top-level %s serialization', (value) => {
		const [out, captured] = createCaptureOutput({ isTTY: true, color: false });
		out.json(value);
		expect(captured.stdout).toEqual([`${JSON.stringify(value, null, 2)}\n`]);
	});
});
