import { describe, expect, it } from 'vitest';
import { ParseError } from '../errors/index.ts';
import { createArgSchema } from '../schema/arg.ts';
import type { CommandSchema } from '../schema/command.ts';
import { createSchema } from '../schema/flag.ts';
import { parse, tokenize } from './index.ts';

// ---------------------------------------------------------------------------
// Helpers — build minimal CommandSchema for testing
// ---------------------------------------------------------------------------

function makeSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: false,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

// ========================================================================
// Tokenizer
// ========================================================================

describe('tokenize', () => {
	it('empty argv produces empty tokens', () => {
		expect(tokenize([])).toEqual([]);
	});

	it('long flag without value', () => {
		const tokens = tokenize(['--verbose']);
		expect(tokens).toEqual([{ kind: 'long-flag', name: 'verbose', value: undefined }]);
	});

	it('long flag with inline value (=)', () => {
		const tokens = tokenize(['--port=8080']);
		expect(tokens).toEqual([{ kind: 'long-flag', name: 'port', value: '8080' }]);
	});

	it('long flag with empty inline value', () => {
		const tokens = tokenize(['--name=']);
		expect(tokens).toEqual([{ kind: 'long-flag', name: 'name', value: '' }]);
	});

	it('short flags', () => {
		const tokens = tokenize(['-abc']);
		expect(tokens).toEqual([{ kind: 'short-flags', chars: 'abc' }]);
	});

	it('single short flag', () => {
		const tokens = tokenize(['-v']);
		expect(tokens).toEqual([{ kind: 'short-flags', chars: 'v' }]);
	});

	it('positional arguments', () => {
		const tokens = tokenize(['hello', 'world']);
		expect(tokens).toEqual([
			{ kind: 'positional', value: 'hello' },
			{ kind: 'positional', value: 'world' },
		]);
	});

	it('bare dash is a positional (stdin convention)', () => {
		const tokens = tokenize(['-']);
		expect(tokens).toEqual([{ kind: 'positional', value: '-' }]);
	});

	it('separator (--) makes everything after it positional', () => {
		const tokens = tokenize(['--verbose', '--', '--not-a-flag', '-x']);
		expect(tokens).toEqual([
			{ kind: 'long-flag', name: 'verbose', value: undefined },
			{ kind: 'separator' },
			{ kind: 'positional', value: '--not-a-flag' },
			{ kind: 'positional', value: '-x' },
		]);
	});

	it('mixed argv', () => {
		const tokens = tokenize(['deploy', '--force', '-r', 'us', '--port=3000', '--', 'extra']);
		expect(tokens).toHaveLength(7);
		expect(tokens[0]).toEqual({ kind: 'positional', value: 'deploy' });
		expect(tokens[1]).toEqual({ kind: 'long-flag', name: 'force', value: undefined });
		expect(tokens[2]).toEqual({ kind: 'short-flags', chars: 'r' });
		expect(tokens[3]).toEqual({ kind: 'positional', value: 'us' });
		expect(tokens[4]).toEqual({ kind: 'long-flag', name: 'port', value: '3000' });
		expect(tokens[5]).toEqual({ kind: 'separator' });
		expect(tokens[6]).toEqual({ kind: 'positional', value: 'extra' });
	});
});

// ========================================================================
// Parser — flags
// ========================================================================

describe('parse — flags', () => {
	it('parses long boolean flag', () => {
		const schema = makeSchema({
			flags: { verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }) },
		});
		const result = parse(schema, ['--verbose']);
		expect(result.flags.verbose).toBe(true);
	});

	it('parses long boolean flag with explicit =true', () => {
		const schema = makeSchema({
			flags: { verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }) },
		});
		const result = parse(schema, ['--verbose=true']);
		expect(result.flags.verbose).toBe(true);
	});

	it('parses long boolean flag with explicit =false', () => {
		const schema = makeSchema({
			flags: { verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }) },
		});
		const result = parse(schema, ['--verbose=false']);
		expect(result.flags.verbose).toBe(false);
	});

	it('parses long string flag with space-separated value', () => {
		const schema = makeSchema({
			flags: { name: createSchema('string') },
		});
		const result = parse(schema, ['--name', 'alice']);
		expect(result.flags.name).toBe('alice');
	});

	it('parses long string flag with inline value', () => {
		const schema = makeSchema({
			flags: { name: createSchema('string') },
		});
		const result = parse(schema, ['--name=bob']);
		expect(result.flags.name).toBe('bob');
	});

	it('parses long number flag', () => {
		const schema = makeSchema({
			flags: { port: createSchema('number') },
		});
		const result = parse(schema, ['--port', '3000']);
		expect(result.flags.port).toBe(3000);
	});

	it('parses long number flag with inline value', () => {
		const schema = makeSchema({
			flags: { port: createSchema('number') },
		});
		const result = parse(schema, ['--port=8080']);
		expect(result.flags.port).toBe(8080);
	});

	it('parses enum flag with valid value', () => {
		const schema = makeSchema({
			flags: { region: createSchema('enum', { enumValues: ['us', 'eu', 'ap'] }) },
		});
		const result = parse(schema, ['--region', 'eu']);
		expect(result.flags.region).toBe('eu');
	});

	it('parses array flag — multiple occurrences accumulate', () => {
		const schema = makeSchema({
			flags: {
				tag: createSchema('array', {
					elementSchema: createSchema('string'),
				}),
			},
		});
		const result = parse(schema, ['--tag', 'v1', '--tag', 'v2', '--tag', 'v3']);
		expect(result.flags.tag).toEqual(['v1', 'v2', 'v3']);
	});

	it('parses array flag with number elements', () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('array', {
					elementSchema: createSchema('number'),
				}),
			},
		});
		const result = parse(schema, ['--port', '3000', '--port', '8080']);
		expect(result.flags.port).toEqual([3000, 8080]);
	});

	it('resolves flag by alias', () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['v'],
				}),
			},
		});
		const result = parse(schema, ['-v']);
		expect(result.flags.verbose).toBe(true);
	});

	it('resolves flag by long alias', () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['verb'],
				}),
			},
		});
		const result = parse(schema, ['--verb']);
		expect(result.flags.verbose).toBe(true);
	});

	it('no flags supplied returns empty flags object', () => {
		const schema = makeSchema({
			flags: { verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }) },
		});
		const result = parse(schema, []);
		expect(result.flags).toEqual({});
	});
});

// ========================================================================
// Parser — short flags
// ========================================================================

describe('parse — short flags', () => {
	it('single short boolean flag', () => {
		const schema = makeSchema({
			flags: {
				force: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['f'],
				}),
			},
		});
		const result = parse(schema, ['-f']);
		expect(result.flags.force).toBe(true);
	});

	it('combined short boolean flags -abc', () => {
		const schema = makeSchema({
			flags: {
				all: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['a'],
				}),
				brief: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['b'],
				}),
				color: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['c'],
				}),
			},
		});
		const result = parse(schema, ['-abc']);
		expect(result.flags.all).toBe(true);
		expect(result.flags.brief).toBe(true);
		expect(result.flags.color).toBe(true);
	});

	it('short flag with value as next arg', () => {
		const schema = makeSchema({
			flags: { output: createSchema('string', { aliases: ['o'] }) },
		});
		const result = parse(schema, ['-o', 'file.txt']);
		expect(result.flags.output).toBe('file.txt');
	});

	it('short flag with inline value -oFile', () => {
		const schema = makeSchema({
			flags: { output: createSchema('string', { aliases: ['o'] }) },
		});
		const result = parse(schema, ['-ofile.txt']);
		expect(result.flags.output).toBe('file.txt');
	});

	it('combined short flags where last consumes value', () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['v'],
				}),
				output: createSchema('string', { aliases: ['o'] }),
			},
		});
		const result = parse(schema, ['-vo', 'out.txt']);
		expect(result.flags.verbose).toBe(true);
		expect(result.flags.output).toBe('out.txt');
	});

	it('combined short flags where middle flag consumes rest as value', () => {
		const schema = makeSchema({
			flags: {
				output: createSchema('string', { aliases: ['o'] }),
				verbose: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['v'],
				}),
			},
		});
		// -oVfile → -o consumes "Vfile" as value (V is not treated as -v)
		const result = parse(schema, ['-oVfile']);
		expect(result.flags.output).toBe('Vfile');
	});
});

// ========================================================================
// Parser — positional args
// ========================================================================

describe('parse — positional args', () => {
	it('single string arg', () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		const result = parse(schema, ['production']);
		expect(result.args.target).toBe('production');
	});

	it('multiple args in order', () => {
		const schema = makeSchema({
			args: [
				{ name: 'source', schema: createArgSchema('string') },
				{ name: 'dest', schema: createArgSchema('string') },
			],
		});
		const result = parse(schema, ['from.txt', 'to.txt']);
		expect(result.args.source).toBe('from.txt');
		expect(result.args.dest).toBe('to.txt');
	});

	it('number arg is coerced', () => {
		const schema = makeSchema({
			args: [{ name: 'count', schema: createArgSchema('number') }],
		});
		const result = parse(schema, ['42']);
		expect(result.args.count).toBe(42);
	});

	it('enum arg passes valid value through', () => {
		const schema = makeSchema({
			args: [
				{ name: 'region', schema: createArgSchema('enum', { enumValues: ['us', 'eu', 'ap'] }) },
			],
		});
		const result = parse(schema, ['eu']);
		expect(result.args.region).toBe('eu');
	});

	it('enum arg rejects invalid value', () => {
		const schema = makeSchema({
			args: [{ name: 'region', schema: createArgSchema('enum', { enumValues: ['us', 'eu'] }) }],
		});
		expect(() => parse(schema, ['ap'])).toThrow(ParseError);
		try {
			parse(schema, ['ap']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('INVALID_VALUE');
			expect(pe.details).toEqual({ arg: 'region', value: 'ap', allowed: ['us', 'eu'] });
		}
	});

	it('variadic enum args are validated', () => {
		const schema = makeSchema({
			args: [
				{
					name: 'regions',
					schema: createArgSchema('enum', { enumValues: ['us', 'eu'], variadic: true }),
				},
			],
		});
		const result = parse(schema, ['us', 'eu', 'us']);
		expect(result.args.regions).toEqual(['us', 'eu', 'us']);
	});

	it('variadic enum rejects invalid value in list', () => {
		const schema = makeSchema({
			args: [
				{
					name: 'regions',
					schema: createArgSchema('enum', { enumValues: ['us', 'eu'], variadic: true }),
				},
			],
		});
		expect(() => parse(schema, ['us', 'ap'])).toThrow(ParseError);
	});

	it('custom arg parse function is invoked', () => {
		const schema = makeSchema({
			args: [
				{
					name: 'hex',
					schema: createArgSchema('custom', {
						parseFn: (raw: string) => Number.parseInt(raw, 16),
					}),
				},
			],
		});
		const result = parse(schema, ['ff']);
		expect(result.args.hex).toBe(255);
	});

	it('variadic arg consumes remaining positionals', () => {
		const schema = makeSchema({
			args: [
				{ name: 'cmd', schema: createArgSchema('string') },
				{ name: 'files', schema: createArgSchema('string', { variadic: true }) },
			],
		});
		const result = parse(schema, ['build', 'a.ts', 'b.ts', 'c.ts']);
		expect(result.args.cmd).toBe('build');
		expect(result.args.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
	});

	it('variadic arg with no remaining positionals produces empty array', () => {
		const schema = makeSchema({
			args: [
				{ name: 'cmd', schema: createArgSchema('string') },
				{ name: 'files', schema: createArgSchema('string', { variadic: true }) },
			],
		});
		const result = parse(schema, ['build']);
		expect(result.args.cmd).toBe('build');
		expect(result.args.files).toEqual([]);
	});

	it('missing optional arg is absent from result', () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string', { presence: 'optional' }) }],
		});
		const result = parse(schema, []);
		expect(result.args.target).toBeUndefined();
	});
});

// ========================================================================
// Parser — flags + args mixed
// ========================================================================

describe('parse — mixed flags and args', () => {
	it('flags and positionals interleaved', () => {
		const schema = makeSchema({
			flags: {
				force: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['f'],
				}),
				region: createSchema('string'),
			},
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		const result = parse(schema, ['--force', 'production', '--region', 'us']);
		expect(result.flags.force).toBe(true);
		expect(result.flags.region).toBe('us');
		expect(result.args.target).toBe('production');
	});

	it('separator (--) forces remaining as positionals', () => {
		const schema = makeSchema({
			flags: {
				verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
			},
			args: [{ name: 'files', schema: createArgSchema('string', { variadic: true }) }],
		});
		const result = parse(schema, ['--verbose', '--', '--not-a-flag', '-x']);
		expect(result.flags.verbose).toBe(true);
		expect(result.args.files).toEqual(['--not-a-flag', '-x']);
	});
});

// ========================================================================
// Parser — error cases
// ========================================================================

describe('parse — errors', () => {
	it('unknown long flag throws ParseError UNKNOWN_FLAG', () => {
		const schema = makeSchema();
		expect(() => parse(schema, ['--unknown'])).toThrow(ParseError);
		try {
			parse(schema, ['--unknown']);
		} catch (err) {
			expect(err).toBeInstanceOf(ParseError);
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('UNKNOWN_FLAG');
		}
	});

	it('unknown short flag throws ParseError UNKNOWN_FLAG', () => {
		const schema = makeSchema();
		expect(() => parse(schema, ['-z'])).toThrow(ParseError);
	});

	it('unknown short flag in combined group throws', () => {
		const schema = makeSchema({
			flags: {
				all: createSchema('boolean', {
					presence: 'defaulted',
					defaultValue: false,
					aliases: ['a'],
				}),
			},
		});
		expect(() => parse(schema, ['-az'])).toThrow(ParseError);
	});

	it('missing value for string flag throws MISSING_VALUE', () => {
		const schema = makeSchema({
			flags: { name: createSchema('string') },
		});
		expect(() => parse(schema, ['--name'])).toThrow(ParseError);
		try {
			parse(schema, ['--name']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('MISSING_VALUE');
		}
	});

	it('missing value for short flag throws MISSING_VALUE', () => {
		const schema = makeSchema({
			flags: { output: createSchema('string', { aliases: ['o'] }) },
		});
		expect(() => parse(schema, ['-o'])).toThrow(ParseError);
		try {
			parse(schema, ['-o']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('MISSING_VALUE');
		}
	});

	it('invalid number flag value throws INVALID_VALUE', () => {
		const schema = makeSchema({
			flags: { port: createSchema('number') },
		});
		expect(() => parse(schema, ['--port', 'abc'])).toThrow(ParseError);
		try {
			parse(schema, ['--port', 'abc']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('INVALID_VALUE');
		}
	});

	it('invalid enum flag value throws INVALID_VALUE', () => {
		const schema = makeSchema({
			flags: { region: createSchema('enum', { enumValues: ['us', 'eu'] }) },
		});
		expect(() => parse(schema, ['--region', 'ap'])).toThrow(ParseError);
		try {
			parse(schema, ['--region', 'ap']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('INVALID_VALUE');
			expect(pe.message).toContain('Allowed: us, eu');
		}
	});

	it('invalid boolean flag value throws INVALID_VALUE', () => {
		const schema = makeSchema({
			flags: { verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }) },
		});
		expect(() => parse(schema, ['--verbose=maybe'])).toThrow(ParseError);
	});

	it('invalid number arg throws INVALID_VALUE', () => {
		const schema = makeSchema({
			args: [{ name: 'count', schema: createArgSchema('number') }],
		});
		expect(() => parse(schema, ['abc'])).toThrow(ParseError);
	});

	it('custom arg parse failure throws INVALID_VALUE', () => {
		const schema = makeSchema({
			args: [
				{
					name: 'url',
					schema: createArgSchema('custom', {
						parseFn: (raw: string) => {
							if (!raw.startsWith('http')) throw new Error('Must be a URL');
							return raw;
						},
					}),
				},
			],
		});
		expect(() => parse(schema, ['not-a-url'])).toThrow(ParseError);
		try {
			parse(schema, ['not-a-url']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('INVALID_VALUE');
			expect(pe.message).toContain('Must be a URL');
		}
	});

	it('excess positionals throw UNEXPECTED_POSITIONAL', () => {
		const schema = makeSchema({
			args: [{ name: 'target', schema: createArgSchema('string') }],
		});
		expect(() => parse(schema, ['a', 'b', 'c'])).toThrow(ParseError);
		try {
			parse(schema, ['a', 'b', 'c']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('UNEXPECTED_POSITIONAL');
		}
	});

	it('excess positionals with no args defined throws', () => {
		const schema = makeSchema();
		expect(() => parse(schema, ['extra'])).toThrow(ParseError);
	});

	it('unknown flag includes "did you mean" suggestion for close match', () => {
		const schema = makeSchema({
			flags: { verbose: createSchema('boolean', { presence: 'defaulted', defaultValue: false }) },
		});
		try {
			parse(schema, ['--verbos']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.message).toContain('Did you mean --verbose');
			expect(pe.suggest).toBe('--verbose');
		}
	});

	it('all ParseErrors have exitCode 2', () => {
		const schema = makeSchema();
		try {
			parse(schema, ['--unknown']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.exitCode).toBe(2);
		}
	});
});

// ========================================================================
// Custom flag parsing
// ========================================================================

describe('parse — custom flags', () => {
	it('custom flag invokes parseFn on the raw string', () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
				}),
			},
		});
		const result = parse(schema, ['--hex', 'ff']);
		expect(result.flags.hex).toBe(255);
	});

	it('custom flag with inline value', () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
				}),
			},
		});
		const result = parse(schema, ['--hex=a0']);
		expect(result.flags.hex).toBe(160);
	});

	it('custom flag parse failure throws INVALID_VALUE', () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('custom', {
					parseFn: (raw: unknown) => {
						const n = Number(raw);
						if (Number.isNaN(n) || n < 0 || n > 65535) throw new Error('Invalid port');
						return n;
					},
				}),
			},
		});
		expect(() => parse(schema, ['--port', 'abc'])).toThrow(ParseError);
		try {
			parse(schema, ['--port', 'abc']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.code).toBe('INVALID_VALUE');
			expect(pe.message).toContain('Failed to parse flag --port');
			expect(pe.message).toContain('Invalid port');
		}
	});

	it('custom flag re-throws ParseError from parseFn as-is', () => {
		const schema = makeSchema({
			flags: {
				value: createSchema('custom', {
					parseFn: () => {
						throw new ParseError('Custom error', { code: 'INVALID_VALUE' });
					},
				}),
			},
		});
		try {
			parse(schema, ['--value', 'x']);
		} catch (err) {
			const pe = err as InstanceType<typeof ParseError>;
			expect(pe.message).toBe('Custom error');
		}
	});

	it('custom flag with short alias', () => {
		const schema = makeSchema({
			flags: {
				hex: createSchema('custom', {
					aliases: ['x'],
					parseFn: (raw: unknown) => Number.parseInt(String(raw), 16),
				}),
			},
		});
		const result = parse(schema, ['-x', 'ff']);
		expect(result.flags.hex).toBe(255);
	});

	it('custom flag without parseFn returns raw string', () => {
		const schema = makeSchema({
			flags: {
				value: createSchema('custom'),
			},
		});
		const result = parse(schema, ['--value', 'hello']);
		expect(result.flags.value).toBe('hello');
	});
});

// ========================================================================
// Edge cases
// ========================================================================

describe('parse — edge cases', () => {
	it('flag value that looks like a flag (--name --other)', () => {
		const schema = makeSchema({
			flags: {
				name: createSchema('string'),
				other: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
			},
		});
		// --name expects a value; --other is parsed as a separate token (not as value for --name)
		// This should throw MISSING_VALUE since next token is a flag, not a positional
		expect(() => parse(schema, ['--name', '--other'])).toThrow(ParseError);
	});

	it('empty string as flag value is allowed', () => {
		const schema = makeSchema({
			flags: { name: createSchema('string') },
		});
		const result = parse(schema, ['--name=']);
		expect(result.flags.name).toBe('');
	});

	it('negative number as flag value', () => {
		const schema = makeSchema({
			flags: { offset: createSchema('number') },
		});
		// -5 looks like a short flag; must use --offset=-5 or --offset -5 after --
		// With inline value it works:
		const result = parse(schema, ['--offset=-5']);
		expect(result.flags.offset).toBe(-5);
	});

	it('last flag overrides earlier occurrence', () => {
		const schema = makeSchema({
			flags: { region: createSchema('string') },
		});
		const result = parse(schema, ['--region', 'us', '--region', 'eu']);
		expect(result.flags.region).toBe('eu');
	});

	it('boolean flag with 0/1 values', () => {
		const schema = makeSchema({
			flags: { debug: createSchema('boolean', { presence: 'defaulted', defaultValue: false }) },
		});
		expect(parse(schema, ['--debug=1']).flags.debug).toBe(true);
		expect(parse(schema, ['--debug=0']).flags.debug).toBe(false);
	});

	it('variadic number args are coerced', () => {
		const schema = makeSchema({
			args: [{ name: 'nums', schema: createArgSchema('number', { variadic: true }) }],
		});
		const result = parse(schema, ['1', '2', '3']);
		expect(result.args.nums).toEqual([1, 2, 3]);
	});

	it('parse with no argv returns empty result', () => {
		const schema = makeSchema();
		const result = parse(schema, []);
		expect(result.flags).toEqual({});
		expect(result.args).toEqual({});
	});
});
