import { describe, expect, it } from 'vitest';
import { stripAnsi } from '#internals/core/help/ansi.ts';
import { createCaptureOutput } from './index.ts';

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
