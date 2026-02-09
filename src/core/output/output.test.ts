import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Out } from '../schema/command.js';
import type { CapturedOutput, OutputOptions, Verbosity, WriteFn } from './index.js';
import { createCaptureOutput, createOutput, OutputChannel } from './index.js';

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
