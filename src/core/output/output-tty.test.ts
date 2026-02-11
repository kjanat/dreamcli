/**
 * Tests for TTY detection and output mode inference.
 *
 * Verifies that isTTY flows from OutputOptions → OutputChannel → Out interface,
 * and that handlers can use isTTY + jsonMode to decide output mode.
 */

import { describe, expect, it } from 'vitest';
import type { Out } from '../schema/command.ts';
import { createCaptureOutput, createOutput, OutputChannel } from './index.ts';

// ---------------------------------------------------------------------------
// isTTY on Out interface
// ---------------------------------------------------------------------------

describe('Out.isTTY', () => {
	it('defaults to false when not provided', () => {
		const out = createOutput();
		expect(out.isTTY).toBe(false);
	});

	it('reflects true when isTTY is provided as true', () => {
		const out = createOutput({ isTTY: true });
		expect(out.isTTY).toBe(true);
	});

	it('reflects false when isTTY is provided as false', () => {
		const out = createOutput({ isTTY: false });
		expect(out.isTTY).toBe(false);
	});

	it('is accessible via the Out interface type', () => {
		const out: Out = createOutput({ isTTY: true });
		expect(out.isTTY).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// isTTY on OutputChannel directly
// ---------------------------------------------------------------------------

describe('OutputChannel.isTTY', () => {
	it('stores isTTY from resolved options', () => {
		const channel = new OutputChannel({
			stdout: () => {},
			stderr: () => {},
			isTTY: true,
			verbosity: 'normal',
			jsonMode: false,
		});
		expect(channel.isTTY).toBe(true);
		expect(channel.options.isTTY).toBe(true);
	});

	it('isTTY and options.isTTY are consistent', () => {
		const tty = new OutputChannel({
			stdout: () => {},
			stderr: () => {},
			isTTY: true,
			verbosity: 'normal',
			jsonMode: false,
		});
		const piped = new OutputChannel({
			stdout: () => {},
			stderr: () => {},
			isTTY: false,
			verbosity: 'normal',
			jsonMode: false,
		});
		expect(tty.isTTY).toBe(tty.options.isTTY);
		expect(piped.isTTY).toBe(piped.options.isTTY);
	});
});

// ---------------------------------------------------------------------------
// isTTY through createCaptureOutput
// ---------------------------------------------------------------------------

describe('createCaptureOutput — isTTY', () => {
	it('defaults to false', () => {
		const [out] = createCaptureOutput();
		expect(out.isTTY).toBe(false);
	});

	it('passes isTTY=true through', () => {
		const [out] = createCaptureOutput({ isTTY: true });
		expect(out.isTTY).toBe(true);
	});

	it('passes isTTY=false through', () => {
		const [out] = createCaptureOutput({ isTTY: false });
		expect(out.isTTY).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Output mode inference — isTTY × jsonMode combinations
// ---------------------------------------------------------------------------

describe('output mode inference', () => {
	it('TTY + no JSON: normal interactive mode', () => {
		const [out] = createCaptureOutput({ isTTY: true, jsonMode: false });
		expect(out.isTTY).toBe(true);
		expect(out.jsonMode).toBe(false);
	});

	it('TTY + JSON: jsonMode overrides TTY for decorative decisions', () => {
		const [out] = createCaptureOutput({ isTTY: true, jsonMode: true });
		expect(out.isTTY).toBe(true); // raw TTY status preserved
		expect(out.jsonMode).toBe(true); // but jsonMode takes precedence
	});

	it('piped + no JSON: plain output mode', () => {
		const [out] = createCaptureOutput({ isTTY: false, jsonMode: false });
		expect(out.isTTY).toBe(false);
		expect(out.jsonMode).toBe(false);
	});

	it('piped + JSON: structured output mode', () => {
		const [out] = createCaptureOutput({ isTTY: false, jsonMode: true });
		expect(out.isTTY).toBe(false);
		expect(out.jsonMode).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Handlers can use isTTY to branch output
// ---------------------------------------------------------------------------

describe('handler output branching on isTTY', () => {
	it('handler can skip decorative output when not TTY', () => {
		const [out, captured] = createCaptureOutput({ isTTY: false });
		// Simulate handler logic
		if (out.isTTY) {
			out.log('✨ Deploying with style...');
		} else {
			out.log('Deploying...');
		}
		expect(captured.stdout).toEqual(['Deploying...\n']);
	});

	it('handler can emit decorative output when TTY', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true });
		// Simulate handler logic
		if (out.isTTY) {
			out.log('Deploying with style...');
		} else {
			out.log('Deploying...');
		}
		expect(captured.stdout).toEqual(['Deploying with style...\n']);
	});

	it('handler suppresses decorative output when jsonMode even if TTY', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, jsonMode: true });
		// Simulate handler logic: jsonMode takes precedence over isTTY
		if (out.jsonMode) {
			out.json({ status: 'deploying' });
		} else if (out.isTTY) {
			out.log('Deploying with style...');
		} else {
			out.log('Deploying...');
		}
		expect(captured.stdout).toEqual(['{"status":"deploying"}\n']);
		expect(captured.stderr).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// table() output respects mode combinations
// ---------------------------------------------------------------------------

describe('table() with TTY modes', () => {
	const rows = [
		{ name: 'Alice', age: 30 },
		{ name: 'Bob', age: 25 },
	];

	it('TTY mode: pretty-prints aligned table', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, jsonMode: false });
		out.table(rows);
		expect(captured.stdout.length).toBe(1);
		const text = captured.stdout[0] ?? '';
		expect(text).toContain('name');
		expect(text).toContain('age');
		expect(text).toContain('Alice');
		expect(text).toContain('Bob');
		// Should have separator line
		expect(text).toContain('---');
	});

	it('piped mode (non-TTY, non-JSON): still pretty-prints', () => {
		const [out, captured] = createCaptureOutput({ isTTY: false, jsonMode: false });
		out.table(rows);
		expect(captured.stdout.length).toBe(1);
		const text = captured.stdout[0] ?? '';
		// Same aligned text output as TTY — useful for grep/awk
		expect(text).toContain('name');
		expect(text).toContain('Alice');
	});

	it('JSON mode (TTY): emits JSON array to stdout', () => {
		const [out, captured] = createCaptureOutput({ isTTY: true, jsonMode: true });
		out.table(rows);
		expect(captured.stdout.length).toBe(1);
		const parsed = JSON.parse(captured.stdout[0] ?? '');
		expect(parsed).toEqual(rows);
	});

	it('JSON mode (piped): emits JSON array to stdout', () => {
		const [out, captured] = createCaptureOutput({ isTTY: false, jsonMode: true });
		out.table(rows);
		expect(captured.stdout.length).toBe(1);
		const parsed = JSON.parse(captured.stdout[0] ?? '');
		expect(parsed).toEqual(rows);
	});
});
