import { describe, expect, it } from 'vitest';
import {
	CLIError,
	isCLIError,
	isParseError,
	isValidationError,
	ParseError,
	ValidationError,
} from './index.ts';

// --- CLIError

describe('CLIError', () => {
	it('stores message, code, and default exitCode', () => {
		const err = new CLIError('something broke', { code: 'UNKNOWN_FLAG' });
		expect(err.message).toBe('something broke');
		expect(err.code).toBe('UNKNOWN_FLAG');
		expect(err.exitCode).toBe(1);
		expect(err.name).toBe('CLIError');
	});

	it('accepts custom exitCode', () => {
		const err = new CLIError('bad', { code: 'MISSING_VALUE', exitCode: 3 });
		expect(err.exitCode).toBe(3);
	});

	it('stores suggest and details', () => {
		const err = new CLIError('nope', {
			code: 'UNKNOWN_FLAG',
			suggest: 'Did you mean --verbose?',
			details: { flag: '--verbos' },
		});
		expect(err.suggest).toBe('Did you mean --verbose?');
		expect(err.details).toEqual({ flag: '--verbos' });
	});

	it('preserves cause', () => {
		const cause = new Error('root');
		const err = new CLIError('wrapped', { code: 'UNKNOWN_FLAG', cause });
		expect(err.cause).toBe(cause);
	});

	it('is an instance of Error', () => {
		const err = new CLIError('x', { code: 'UNKNOWN_FLAG' });
		expect(err).toBeInstanceOf(Error);
	});

	it('toJSON() serialises required fields', () => {
		const err = new CLIError('fail', { code: 'MISSING_VALUE', exitCode: 2 });
		const json = err.toJSON();
		expect(json).toEqual({
			name: 'CLIError',
			code: 'MISSING_VALUE',
			message: 'fail',
			exitCode: 2,
		});
	});

	it('toJSON() includes optional fields only when set', () => {
		const err = new CLIError('fail', {
			code: 'UNKNOWN_FLAG',
			suggest: 'try --help',
			details: { a: 1 },
		});
		const json = err.toJSON();
		expect(json.suggest).toBe('try --help');
		expect(json.details).toEqual({ a: 1 });
	});

	it('toJSON() omits suggest/details when undefined', () => {
		const json = new CLIError('x', { code: 'UNKNOWN_FLAG' }).toJSON();
		expect('suggest' in json).toBe(false);
		expect('details' in json).toBe(false);
	});

	describe('toJSON() details projection', () => {
		it('renders a bigint as its digits and keeps the runtime value', () => {
			const err = new CLIError('x', { code: 'UNKNOWN_FLAG', details: { value: 123n } });
			const json = err.toJSON();
			expect(json.details).toEqual({ value: '123' });
			expect(err.details).toEqual({ value: 123n });
			expect(() => JSON.stringify(json)).not.toThrow();
		});

		it('projects bigints nested in arrays and records', () => {
			const err = new CLIError('x', {
				code: 'UNKNOWN_FLAG',
				details: { value: { ids: [1n, 2], inner: { id: 3n } } },
			});
			expect(err.toJSON().details).toEqual({ value: { ids: ['1', 2], inner: { id: '3' } } });
		});

		it('omits a cyclic value and keeps its siblings', () => {
			const cyclic: Record<string, unknown> = { name: 'loop' };
			cyclic.self = cyclic;
			const err = new CLIError('x', {
				code: 'UNKNOWN_FLAG',
				details: { value: cyclic, issues: ['rejected'] },
			});
			const json = err.toJSON();
			expect(json.details).toEqual({ value: { name: 'loop' }, issues: ['rejected'] });
			expect(err.details?.value).toBe(cyclic);
			expect(() => JSON.stringify(json)).not.toThrow();
		});

		it('drops functions, symbols, and undefined the way JSON.stringify does', () => {
			const err = new CLIError('x', {
				code: 'UNKNOWN_FLAG',
				details: { fn: () => 1, sym: Symbol('s'), missing: undefined, list: [undefined, 1] },
			});
			expect(err.toJSON().details).toEqual({ list: [null, 1] });
		});

		it('projects through toJSON() like JSON.stringify', () => {
			const when = new Date(0);
			const err = new CLIError('x', {
				code: 'UNKNOWN_FLAG',
				details: { when, custom: { toJSON: () => 7n } },
			});
			expect(err.toJSON().details).toEqual({ when: when.toISOString(), custom: '7' });
		});

		it('omits a value whose toJSON() throws', () => {
			const err = new CLIError('x', {
				code: 'UNKNOWN_FLAG',
				details: {
					broken: {
						toJSON: () => {
							throw new Error('nope');
						},
					},
					kept: 1,
				},
			});
			expect(err.toJSON().details).toEqual({ kept: 1 });
		});
	});

	it('accepts arbitrary string codes via ErrorCode union', () => {
		const err = new CLIError('custom', { code: 'MY_CUSTOM_CODE' });
		expect(err.code).toBe('MY_CUSTOM_CODE');
	});
});

// --- ParseError

describe('ParseError', () => {
	it('defaults exitCode to 2', () => {
		const err = new ParseError('unknown flag --foo', { code: 'UNKNOWN_FLAG' });
		expect(err.exitCode).toBe(2);
		expect(err.name).toBe('ParseError');
	});

	it('is an instance of CLIError and Error', () => {
		const err = new ParseError('bad', { code: 'MISSING_VALUE' });
		expect(err).toBeInstanceOf(CLIError);
		expect(err).toBeInstanceOf(Error);
	});

	it('allows custom exitCode override', () => {
		const err = new ParseError('x', { code: 'INVALID_VALUE', exitCode: 5 });
		expect(err.exitCode).toBe(5);
	});

	it('carries suggest and details', () => {
		const err = new ParseError('bad value', {
			code: 'INVALID_VALUE',
			suggest: 'expected a number',
			details: { flag: '--count', received: 'abc' },
		});
		expect(err.suggest).toBe('expected a number');
		expect(err.details).toEqual({ flag: '--count', received: 'abc' });
	});

	it('toJSON() reflects ParseError name', () => {
		const json = new ParseError('x', { code: 'UNKNOWN_FLAG' }).toJSON();
		expect(json.name).toBe('ParseError');
	});
});

// --- ValidationError

describe('ValidationError', () => {
	it('defaults exitCode to 2', () => {
		const err = new ValidationError('missing --region', { code: 'REQUIRED_FLAG' });
		expect(err.exitCode).toBe(2);
		expect(err.name).toBe('ValidationError');
	});

	it('is an instance of CLIError and Error', () => {
		const err = new ValidationError('bad', { code: 'TYPE_MISMATCH' });
		expect(err).toBeInstanceOf(CLIError);
		expect(err).toBeInstanceOf(Error);
	});

	it('allows custom exitCode override', () => {
		const err = new ValidationError('x', { code: 'INVALID_ENUM', exitCode: 4 });
		expect(err.exitCode).toBe(4);
	});

	it('carries suggest and details', () => {
		const err = new ValidationError('invalid region', {
			code: 'INVALID_ENUM',
			suggest: 'valid values: us, eu, ap',
			details: { flag: '--region', received: 'mars', allowed: ['us', 'eu', 'ap'] },
		});
		expect(err.suggest).toBe('valid values: us, eu, ap');
		expect(err.details).toEqual({
			flag: '--region',
			received: 'mars',
			allowed: ['us', 'eu', 'ap'],
		});
	});

	it('toJSON() reflects ValidationError name', () => {
		const json = new ValidationError('x', { code: 'REQUIRED_ARG' }).toJSON();
		expect(json.name).toBe('ValidationError');
	});
});

// --- Type guards

describe('type guards', () => {
	const cliErr = new CLIError('a', { code: 'UNKNOWN_FLAG' });
	const parseErr = new ParseError('b', { code: 'UNKNOWN_FLAG' });
	const validErr = new ValidationError('c', { code: 'REQUIRED_FLAG' });
	const plainErr = new Error('d');

	describe('isCLIError', () => {
		it('returns true for CLIError', () => expect(isCLIError(cliErr)).toBe(true));
		it('returns true for ParseError', () => expect(isCLIError(parseErr)).toBe(true));
		it('returns true for ValidationError', () => expect(isCLIError(validErr)).toBe(true));
		it('returns false for plain Error', () => expect(isCLIError(plainErr)).toBe(false));
		it('returns false for non-error', () => expect(isCLIError('oops')).toBe(false));
	});

	describe('isParseError', () => {
		it('returns true for ParseError', () => expect(isParseError(parseErr)).toBe(true));
		it('returns false for CLIError', () => expect(isParseError(cliErr)).toBe(false));
		it('returns false for ValidationError', () => expect(isParseError(validErr)).toBe(false));
	});

	describe('isValidationError', () => {
		it('returns true for ValidationError', () => expect(isValidationError(validErr)).toBe(true));
		it('returns false for CLIError', () => expect(isValidationError(cliErr)).toBe(false));
		it('returns false for ParseError', () => expect(isValidationError(parseErr)).toBe(false));
	});
});

// --- Edge cases

describe('edge cases', () => {
	it('CLIError without cause does not set cause property', () => {
		const err = new CLIError('x', { code: 'UNKNOWN_FLAG' });
		expect(err.cause).toBeUndefined();
	});

	it('details object is readonly (frozen at type level)', () => {
		const details = { flag: '--foo' } as const;
		const err = new CLIError('x', { code: 'UNKNOWN_FLAG', details });
		// Runtime check: the reference is the same object
		expect(err.details).toBe(details);
	});

	it('stack trace is captured', () => {
		const err = new CLIError('x', { code: 'UNKNOWN_FLAG' });
		expect(err.stack).toBeDefined();
		expect(err.stack).toContain('CLIError');
	});
});
