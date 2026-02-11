import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Out } from '../schema/command.ts';
import type { CapturedOutput, OutputOptions, Verbosity, WriteFn } from './index.ts';
import { createCaptureOutput, createOutput, OutputChannel } from './index.ts';

// ---------------------------------------------------------------------------
// createOutput — factory
// ---------------------------------------------------------------------------

describe('createOutput', () => {
	it('returns an object satisfying the Out interface', () => {
		const out = createOutput();
		expectTypeOf(out).toMatchTypeOf<Out>();
		expect(typeof out.log).toBe('function');
		expect(typeof out.info).toBe('function');
		expect(typeof out.warn).toBe('function');
		expect(typeof out.error).toBe('function');
	});

	it('discards output when no writers are provided', () => {
		const out = createOutput();
		// Should not throw — output silently discarded
		expect(() => {
			out.log('hello');
			out.info('info');
			out.warn('warn');
			out.error('err');
		}).not.toThrow();
	});

	it('routes log to stdout writer', () => {
		const lines: string[] = [];
		const out = createOutput({ stdout: (s) => lines.push(s) });
		out.log('hello');
		expect(lines).toEqual(['hello\n']);
	});

	it('routes info to stdout writer', () => {
		const lines: string[] = [];
		const out = createOutput({ stdout: (s) => lines.push(s) });
		out.info('details');
		expect(lines).toEqual(['details\n']);
	});

	it('routes warn to stderr writer', () => {
		const lines: string[] = [];
		const out = createOutput({ stderr: (s) => lines.push(s) });
		out.warn('careful');
		expect(lines).toEqual(['careful\n']);
	});

	it('routes error to stderr writer', () => {
		const lines: string[] = [];
		const out = createOutput({ stderr: (s) => lines.push(s) });
		out.error('boom');
		expect(lines).toEqual(['boom\n']);
	});

	it('separates stdout and stderr traffic', () => {
		const stdoutLines: string[] = [];
		const stderrLines: string[] = [];
		const out = createOutput({
			stdout: (s) => stdoutLines.push(s),
			stderr: (s) => stderrLines.push(s),
		});
		out.log('out1');
		out.info('out2');
		out.warn('err1');
		out.error('err2');
		expect(stdoutLines).toEqual(['out1\n', 'out2\n']);
		expect(stderrLines).toEqual(['err1\n', 'err2\n']);
	});
});

// ---------------------------------------------------------------------------
// Verbosity — quiet mode
// ---------------------------------------------------------------------------

describe('verbosity', () => {
	it('emits all messages in normal mode', () => {
		const [out, captured] = createCaptureOutput({ verbosity: 'normal' });
		out.log('log');
		out.info('info');
		out.warn('warn');
		out.error('error');
		expect(captured.stdout).toEqual(['log\n', 'info\n']);
		expect(captured.stderr).toEqual(['warn\n', 'error\n']);
	});

	it('suppresses info in quiet mode', () => {
		const [out, captured] = createCaptureOutput({ verbosity: 'quiet' });
		out.log('log');
		out.info('info');
		out.warn('warn');
		out.error('error');
		expect(captured.stdout).toEqual(['log\n']);
		expect(captured.stderr).toEqual(['warn\n', 'error\n']);
	});

	it('defaults to normal verbosity', () => {
		const [out, captured] = createCaptureOutput();
		out.info('visible');
		expect(captured.stdout).toEqual(['visible\n']);
	});
});

// ---------------------------------------------------------------------------
// TTY detection
// ---------------------------------------------------------------------------

describe('isTTY', () => {
	it('defaults to false', () => {
		const out = createOutput() as OutputChannel;
		expect(out.options.isTTY).toBe(false);
	});

	it('reflects the provided value', () => {
		const outTTY = createOutput({ isTTY: true }) as OutputChannel;
		const outPiped = createOutput({ isTTY: false }) as OutputChannel;
		expect(outTTY.options.isTTY).toBe(true);
		expect(outPiped.options.isTTY).toBe(false);
	});

	it('is accessible on the OutputChannel for downstream consumers', () => {
		const out = createOutput({ isTTY: true }) as OutputChannel;
		expect(out.options.isTTY).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// createCaptureOutput — test helper
// ---------------------------------------------------------------------------

describe('createCaptureOutput', () => {
	it('returns [Out, CapturedOutput] tuple', () => {
		const result = createCaptureOutput();
		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(2);
		const [out, captured] = result;
		expectTypeOf(out).toMatchTypeOf<Out>();
		expectTypeOf(captured).toMatchTypeOf<CapturedOutput>();
	});

	it('captures stdout and stderr separately', () => {
		const [out, captured] = createCaptureOutput();
		out.log('a');
		out.info('b');
		out.warn('c');
		out.error('d');
		expect(captured.stdout).toEqual(['a\n', 'b\n']);
		expect(captured.stderr).toEqual(['c\n', 'd\n']);
	});

	it('starts with empty buffers', () => {
		const [, captured] = createCaptureOutput();
		expect(captured.stdout).toEqual([]);
		expect(captured.stderr).toEqual([]);
	});

	it('respects verbosity option', () => {
		const [out, captured] = createCaptureOutput({ verbosity: 'quiet' });
		out.info('suppressed');
		expect(captured.stdout).toEqual([]);
	});

	it('respects isTTY option', () => {
		const [out] = createCaptureOutput({ isTTY: true });
		const channel = out as OutputChannel;
		expect(channel.options.isTTY).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// OutputChannel — direct construction
// ---------------------------------------------------------------------------

describe('OutputChannel', () => {
	it('can be constructed directly with resolved options', () => {
		const lines: string[] = [];
		const channel = new OutputChannel({
			stdout: (s) => lines.push(s),
			stderr: (s) => lines.push(s),
			isTTY: false,
			verbosity: 'normal',
			jsonMode: false,
		});
		channel.log('test');
		expect(lines).toEqual(['test\n']);
	});

	it('exposes resolved options', () => {
		const channel = new OutputChannel({
			stdout: () => {},
			stderr: () => {},
			isTTY: true,
			verbosity: 'quiet',
			jsonMode: false,
		});
		expect(channel.options.isTTY).toBe(true);
		expect(channel.options.verbosity).toBe('quiet');
	});
});

// ---------------------------------------------------------------------------
// Newline behavior
// ---------------------------------------------------------------------------

describe('newline handling', () => {
	it('appends newline to each message', () => {
		const [out, captured] = createCaptureOutput();
		out.log('no trailing newline');
		expect(captured.stdout).toEqual(['no trailing newline\n']);
	});

	it('does not strip existing trailing newlines (double newline)', () => {
		const [out, captured] = createCaptureOutput();
		out.log('already has newline\n');
		expect(captured.stdout).toEqual(['already has newline\n\n']);
	});

	it('handles empty string', () => {
		const [out, captured] = createCaptureOutput();
		out.log('');
		expect(captured.stdout).toEqual(['\n']);
	});
});

// ---------------------------------------------------------------------------
// Multiple calls accumulate
// ---------------------------------------------------------------------------

describe('accumulation', () => {
	it('accumulates multiple log calls', () => {
		const [out, captured] = createCaptureOutput();
		out.log('one');
		out.log('two');
		out.log('three');
		expect(captured.stdout).toEqual(['one\n', 'two\n', 'three\n']);
	});

	it('accumulates interleaved stdout/stderr calls', () => {
		const [out, captured] = createCaptureOutput();
		out.log('a');
		out.warn('b');
		out.log('c');
		out.error('d');
		expect(captured.stdout).toEqual(['a\n', 'c\n']);
		expect(captured.stderr).toEqual(['b\n', 'd\n']);
	});
});

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

describe('type inference', () => {
	it('WriteFn accepts string parameter', () => {
		expectTypeOf<WriteFn>().toBeFunction();
		expectTypeOf<WriteFn>().parameters.toEqualTypeOf<[data: string]>();
		expectTypeOf<WriteFn>().returns.toBeVoid();
	});

	it('Verbosity is a string union', () => {
		expectTypeOf<Verbosity>().toEqualTypeOf<'normal' | 'quiet'>();
	});

	it('OutputOptions has optional fields', () => {
		// All fields optional — empty object is valid
		const _valid: OutputOptions = {};
		expect(_valid).toBeDefined();
	});

	it('CapturedOutput has readonly string arrays', () => {
		expectTypeOf<CapturedOutput['stdout']>().toEqualTypeOf<string[]>();
		expectTypeOf<CapturedOutput['stderr']>().toEqualTypeOf<string[]>();
	});

	it('createOutput returns Out', () => {
		expectTypeOf(createOutput).returns.toEqualTypeOf<Out>();
	});

	it('createCaptureOutput returns [Out, CapturedOutput]', () => {
		expectTypeOf(createCaptureOutput).returns.toEqualTypeOf<[out: Out, captured: CapturedOutput]>();
	});
});

// ---------------------------------------------------------------------------
// json() method
// ---------------------------------------------------------------------------

describe('json', () => {
	it('serialises an object to stdout', () => {
		const [out, captured] = createCaptureOutput();
		out.json({ key: 'value' });
		expect(captured.stdout).toEqual(['{"key":"value"}\n']);
	});

	it('serialises a string value', () => {
		const [out, captured] = createCaptureOutput();
		out.json('hello');
		expect(captured.stdout).toEqual(['"hello"\n']);
	});

	it('serialises a number', () => {
		const [out, captured] = createCaptureOutput();
		out.json(42);
		expect(captured.stdout).toEqual(['42\n']);
	});

	it('serialises null', () => {
		const [out, captured] = createCaptureOutput();
		out.json(null);
		expect(captured.stdout).toEqual(['null\n']);
	});

	it('serialises an array', () => {
		const [out, captured] = createCaptureOutput();
		out.json([1, 2, 3]);
		expect(captured.stdout).toEqual(['[1,2,3]\n']);
	});

	it('serialises a boolean', () => {
		const [out, captured] = createCaptureOutput();
		out.json(true);
		expect(captured.stdout).toEqual(['true\n']);
	});

	it('serialises nested objects', () => {
		const [out, captured] = createCaptureOutput();
		out.json({ a: { b: 'c' }, d: [1, 2] });
		expect(captured.stdout).toEqual(['{"a":{"b":"c"},"d":[1,2]}\n']);
	});

	it('always writes to stdout even in JSON mode', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: true });
		out.json({ status: 'ok' });
		expect(captured.stdout).toEqual(['{"status":"ok"}\n']);
		expect(captured.stderr).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// jsonMode — output redirection
// ---------------------------------------------------------------------------

describe('jsonMode', () => {
	it('defaults to false', () => {
		const out = createOutput() as OutputChannel;
		expect(out.jsonMode).toBe(false);
	});

	it('reflects the provided value', () => {
		const out = createOutput({ jsonMode: true }) as OutputChannel;
		expect(out.jsonMode).toBe(true);
	});

	it('is exposed on the Out interface', () => {
		const [out] = createCaptureOutput({ jsonMode: true });
		expect(out.jsonMode).toBe(true);
	});

	it('redirects log to stderr in JSON mode', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: true });
		out.log('normal output');
		expect(captured.stdout).toEqual([]);
		expect(captured.stderr).toEqual(['normal output\n']);
	});

	it('redirects info to stderr in JSON mode', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: true });
		out.info('info message');
		expect(captured.stdout).toEqual([]);
		expect(captured.stderr).toEqual(['info message\n']);
	});

	it('keeps warn on stderr in JSON mode', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: true });
		out.warn('warning');
		expect(captured.stderr).toEqual(['warning\n']);
	});

	it('keeps error on stderr in JSON mode', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: true });
		out.error('error');
		expect(captured.stderr).toEqual(['error\n']);
	});

	it('reserves stdout exclusively for json() in JSON mode', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: true });
		out.log('text');
		out.info('info');
		out.warn('warn');
		out.error('error');
		out.json({ data: true });
		// Only json() output on stdout
		expect(captured.stdout).toEqual(['{"data":true}\n']);
		// Everything else on stderr
		expect(captured.stderr).toEqual(['text\n', 'info\n', 'warn\n', 'error\n']);
	});

	it('does not redirect log/info in normal mode', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: false });
		out.log('text');
		out.info('info');
		out.json({ data: true });
		expect(captured.stdout).toEqual(['text\n', 'info\n', '{"data":true}\n']);
		expect(captured.stderr).toEqual([]);
	});

	it('respects verbosity quiet in JSON mode — suppresses info', () => {
		const [out, captured] = createCaptureOutput({ jsonMode: true, verbosity: 'quiet' });
		out.info('suppressed');
		out.log('visible');
		out.json({ ok: true });
		expect(captured.stdout).toEqual(['{"ok":true}\n']);
		expect(captured.stderr).toEqual(['visible\n']);
	});
});
