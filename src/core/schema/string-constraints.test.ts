import { describe, expect, expectTypeOf, it } from 'vitest';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { InferArg } from './arg.ts';
import { arg } from './arg.ts';
import { command } from './command.ts';
import type { InferFlag } from './flag.ts';
import { flag } from './flag.ts';
import type { StringConstraints, StringConstraintViolation } from './string-constraints.ts';
import {
	assertStringConstraints,
	describeStringConstraintViolation,
	stringConstraintDetails,
	validateStringConstraints,
} from './string-constraints.ts';

// === validateStringConstraints — shared validator

describe('validateStringConstraints()', () => {
	// --- no constraints

	it('returns undefined when constraints are undefined', () => {
		expect(validateStringConstraints('anything', undefined)).toBeUndefined();
	});

	it('returns undefined for an empty constraints object', () => {
		expect(validateStringConstraints('', {})).toBeUndefined();
	});

	// --- individual rules

	it('nonEmpty rejects the empty string', () => {
		expect(validateStringConstraints('', { nonEmpty: true })).toEqual({ kind: 'nonEmpty' });
	});

	it('nonEmpty accepts whitespace-only strings', () => {
		expect(validateStringConstraints('   ', { nonEmpty: true })).toBeUndefined();
	});

	it('nonEmpty false accepts the empty string', () => {
		expect(validateStringConstraints('', { nonEmpty: false })).toBeUndefined();
	});

	it('minLength rejects shorter values and carries the bound', () => {
		expect(validateStringConstraints('ab', { minLength: 3 })).toEqual({
			kind: 'minLength',
			bound: 3,
		});
	});

	it('minLength is inclusive', () => {
		expect(validateStringConstraints('abc', { minLength: 3 })).toBeUndefined();
	});

	it('maxLength rejects longer values and carries the bound', () => {
		expect(validateStringConstraints('abcd', { maxLength: 3 })).toEqual({
			kind: 'maxLength',
			bound: 3,
		});
	});

	it('maxLength is inclusive', () => {
		expect(validateStringConstraints('abc', { maxLength: 3 })).toBeUndefined();
	});

	it('pattern rejects non-matching values and carries the source', () => {
		expect(validateStringConstraints('abc', { pattern: /^ghp_/ })).toEqual({
			kind: 'pattern',
			pattern: '/^ghp_/',
		});
	});

	it('pattern accepts matching values', () => {
		expect(validateStringConstraints('ghp_token', { pattern: /^ghp_/ })).toBeUndefined();
	});

	// --- check order — first violation wins

	it('nonEmpty fires before minLength for the empty string', () => {
		const violation = validateStringConstraints('', {
			nonEmpty: true,
			minLength: 3,
			pattern: /^ghp_/,
		});
		expect(violation).toEqual({ kind: 'nonEmpty' });
	});

	it('minLength fires before maxLength', () => {
		// Inverted bounds passed directly so both length rules fail at once;
		// the validator itself does not assert well-formedness.
		const violation = validateStringConstraints('ab', {
			minLength: 3,
			maxLength: 1,
			pattern: /^z/,
		});
		expect(violation).toEqual({ kind: 'minLength', bound: 3 });
	});

	it('maxLength fires before pattern', () => {
		const violation = validateStringConstraints('abcdef', { maxLength: 3, pattern: /^z/ });
		expect(violation).toEqual({ kind: 'maxLength', bound: 3 });
	});

	it('pattern fires last when length bounds pass', () => {
		const violation = validateStringConstraints('abc', {
			minLength: 1,
			maxLength: 5,
			pattern: /^z/,
		});
		expect(violation).toEqual({ kind: 'pattern', pattern: '/^z/' });
	});

	// --- stateful regexes

	it('a /g pattern validates consistently across repeated calls', () => {
		const constraints: StringConstraints = { pattern: /^ghp_/g };
		expect(validateStringConstraints('ghp_token', constraints)).toBeUndefined();
		// Without a lastIndex reset the second .test() would start at index 4 and fail.
		expect(validateStringConstraints('ghp_token', constraints)).toBeUndefined();
		expect(validateStringConstraints('ghp_token', constraints)).toBeUndefined();
	});

	it('a /y (sticky) pattern validates consistently across repeated calls', () => {
		const constraints: StringConstraints = { pattern: /ghp_/y };
		expect(validateStringConstraints('ghp_token', constraints)).toBeUndefined();
		expect(validateStringConstraints('ghp_token', constraints)).toBeUndefined();
	});

	it('resets an externally-dirtied lastIndex before testing', () => {
		const pattern = /^ghp_/g;
		pattern.lastIndex = 3;
		expect(validateStringConstraints('ghp_token', { pattern })).toBeUndefined();
	});
});

// === assertStringConstraints — construction-time well-formedness

describe('assertStringConstraints()', () => {
	it('accepts an empty constraints object', () => {
		expect(() => assertStringConstraints({})).not.toThrow();
	});

	it('accepts zero bounds', () => {
		expect(() => assertStringConstraints({ minLength: 0, maxLength: 0 })).not.toThrow();
	});

	it('accepts minLength equal to maxLength', () => {
		expect(() => assertStringConstraints({ minLength: 5, maxLength: 5 })).not.toThrow();
	});

	it('throws RangeError for a negative minLength', () => {
		expect(() => assertStringConstraints({ minLength: -1 })).toThrow(RangeError);
	});

	it('throws RangeError for a negative maxLength', () => {
		expect(() => assertStringConstraints({ maxLength: -3 })).toThrow(RangeError);
	});

	it('throws RangeError for a fractional minLength', () => {
		expect(() => assertStringConstraints({ minLength: 2.5 })).toThrow(RangeError);
	});

	it('throws RangeError for a fractional maxLength', () => {
		expect(() => assertStringConstraints({ maxLength: 7.1 })).toThrow(RangeError);
	});

	it('throws RangeError for a NaN bound', () => {
		expect(() => assertStringConstraints({ minLength: Number.NaN })).toThrow(RangeError);
	});

	it('throws RangeError for an infinite bound', () => {
		expect(() => assertStringConstraints({ maxLength: Number.POSITIVE_INFINITY })).toThrow(
			RangeError,
		);
	});

	it('throws RangeError when minLength exceeds maxLength', () => {
		expect(() => assertStringConstraints({ minLength: 5, maxLength: 2 })).toThrow(RangeError);
	});

	it('names the offending field in the message', () => {
		expect(() => assertStringConstraints({ minLength: -1 })).toThrow(/'minLength'/);
		expect(() => assertStringConstraints({ maxLength: 1.5 })).toThrow(/'maxLength'/);
	});

	it('reports both bounds for an inverted range', () => {
		expect(() => assertStringConstraints({ minLength: 5, maxLength: 2 })).toThrow(
			"string constraint 'minLength' (5) must not exceed 'maxLength' (2)",
		);
	});
});

// === describeStringConstraintViolation — human-readable wording

describe('describeStringConstraintViolation()', () => {
	it('nonEmpty — must not be empty', () => {
		const violation: StringConstraintViolation = { kind: 'nonEmpty' };
		expect(describeStringConstraintViolation(violation)).toBe('must not be empty');
	});

	it('minLength — must be at least N characters', () => {
		const violation: StringConstraintViolation = { kind: 'minLength', bound: 3 };
		expect(describeStringConstraintViolation(violation)).toBe('must be at least 3 characters');
	});

	it('maxLength — must be at most N characters', () => {
		const violation: StringConstraintViolation = { kind: 'maxLength', bound: 8 };
		expect(describeStringConstraintViolation(violation)).toBe('must be at most 8 characters');
	});

	it('pattern — must match the rendered regex', () => {
		const violation: StringConstraintViolation = { kind: 'pattern', pattern: '/^ghp_/' };
		expect(describeStringConstraintViolation(violation)).toBe('must match /^ghp_/');
	});
});

// === stringConstraintDetails — shared error-detail fragment

describe('stringConstraintDetails()', () => {
	it('names the rule for a nonEmpty violation', () => {
		expect(stringConstraintDetails({ kind: 'nonEmpty' })).toEqual({ constraint: 'nonEmpty' });
	});

	it('carries the bound for a length violation', () => {
		expect(stringConstraintDetails({ kind: 'minLength', bound: 3 })).toEqual({
			constraint: 'minLength',
			bound: 3,
		});
		expect(stringConstraintDetails({ kind: 'maxLength', bound: 8 })).toEqual({
			constraint: 'maxLength',
			bound: 8,
		});
	});

	it('carries the rendered source for a pattern violation', () => {
		expect(stringConstraintDetails({ kind: 'pattern', pattern: '/^ghp_/' })).toEqual({
			constraint: 'pattern',
			pattern: '/^ghp_/',
		});
	});
});

// === flag.string() — builder integration

describe('flag.string() constraints options', () => {
	it('has no constraints by default', () => {
		expect(flag.string().schema.stringConstraints).toBeUndefined();
	});

	it('stores constraints from the options object', () => {
		const f = flag.string({ nonEmpty: true, minLength: 2, maxLength: 8, pattern: /^ghp_/ });
		expect(f.schema.stringConstraints).toEqual({
			nonEmpty: true,
			minLength: 2,
			maxLength: 8,
			pattern: /^ghp_/,
		});
	});

	it('keeps the resolved value type as string regardless of constraints', () => {
		const f = flag.string({ nonEmpty: true, minLength: 2 });
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string | undefined>();
	});

	it('throws RangeError for a negative bound in the options object', () => {
		expect(() => flag.string({ minLength: -1 })).toThrow(RangeError);
	});

	it('throws RangeError for a fractional bound in the options object', () => {
		expect(() => flag.string({ maxLength: 2.5 })).toThrow(RangeError);
	});

	it('throws RangeError for an inverted range in the options object', () => {
		expect(() => flag.string({ minLength: 5, maxLength: 2 })).toThrow(RangeError);
	});
});

describe('flag.string() chained constraint methods', () => {
	it('.nonEmpty() sets nonEmpty true', () => {
		expect(flag.string().nonEmpty().schema.stringConstraints).toEqual({ nonEmpty: true });
	});

	it('.nonEmpty(false) sets nonEmpty false', () => {
		expect(flag.string().nonEmpty(false).schema.stringConstraints).toEqual({ nonEmpty: false });
	});

	it('.minLength()/.maxLength() set inclusive bounds', () => {
		expect(flag.string().minLength(2).maxLength(8).schema.stringConstraints).toEqual({
			minLength: 2,
			maxLength: 8,
		});
	});

	it('.pattern() stores the regex', () => {
		expect(flag.string().pattern(/^ghp_/).schema.stringConstraints).toEqual({
			pattern: /^ghp_/,
		});
	});

	it('chained methods merge onto the options object', () => {
		const f = flag.string({ nonEmpty: true }).minLength(2).maxLength(8).pattern(/^a/);
		expect(f.schema.stringConstraints).toEqual({
			nonEmpty: true,
			minLength: 2,
			maxLength: 8,
			pattern: /^a/,
		});
	});

	it('a later chained .minLength() overrides an earlier value', () => {
		const f = flag.string({ minLength: 1 }).minLength(5);
		expect(f.schema.stringConstraints).toEqual({ minLength: 5 });
	});

	it('a later chained .pattern() overrides an earlier pattern', () => {
		const f = flag.string({ pattern: /^a/ }).pattern(/^b/);
		expect(f.schema.stringConstraints).toEqual({ pattern: /^b/ });
	});

	it('.nonEmpty(false) overrides nonEmpty from the options object', () => {
		const f = flag.string({ nonEmpty: true }).nonEmpty(false);
		expect(f.schema.stringConstraints).toEqual({ nonEmpty: false });
	});

	it('throws RangeError for a negative chained bound', () => {
		expect(() => flag.string().minLength(-1)).toThrow(RangeError);
		expect(() => flag.string().maxLength(-1)).toThrow(RangeError);
	});

	it('throws RangeError when a chained bound inverts the range', () => {
		expect(() => flag.string({ maxLength: 2 }).minLength(5)).toThrow(RangeError);
		expect(() => flag.string().minLength(5).maxLength(2)).toThrow(RangeError);
	});

	it('preserves presence through the chain', () => {
		const f = flag.string().required().nonEmpty().minLength(2);
		expect(f.schema.presence).toBe('required');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('does not mutate the source builder (immutability)', () => {
		const base = flag.string({ minLength: 2 });
		base.maxLength(8);
		base.nonEmpty();
		expect(base.schema.stringConstraints).toEqual({ minLength: 2 });
	});

	it('constraint methods are string-kind only at compile time', () => {
		// @ts-expect-error — .nonEmpty() is not available on number flags
		flag.number().nonEmpty();
		// @ts-expect-error — .minLength() is not available on number flags
		flag.number().minLength(1);
		// @ts-expect-error — .maxLength() is not available on boolean flags
		flag.boolean().maxLength(2);
		// @ts-expect-error — .pattern() is not available on enum flags
		flag.enum(['a', 'b']).pattern(/^a/);
		expect(true).toBe(true);
	});
});

// === arg.string() — builder integration

describe('arg.string() constraints options', () => {
	it('has no constraints by default', () => {
		expect(arg.string().schema.stringConstraints).toBeUndefined();
	});

	it('stores constraints from the options object', () => {
		const a = arg.string({ nonEmpty: true, minLength: 2, maxLength: 8, pattern: /^ghp_/ });
		expect(a.schema.stringConstraints).toEqual({
			nonEmpty: true,
			minLength: 2,
			maxLength: 8,
			pattern: /^ghp_/,
		});
	});

	it('keeps the resolved value type as string regardless of constraints', () => {
		const a = arg.string({ nonEmpty: true, minLength: 2 });
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string>();
	});

	it('throws RangeError for malformed bounds in the options object', () => {
		expect(() => arg.string({ minLength: -1 })).toThrow(RangeError);
		expect(() => arg.string({ maxLength: 2.5 })).toThrow(RangeError);
		expect(() => arg.string({ minLength: 5, maxLength: 2 })).toThrow(RangeError);
	});
});

describe('arg.string() chained constraint methods', () => {
	it('.nonEmpty() sets nonEmpty true, .nonEmpty(false) sets it false', () => {
		expect(arg.string().nonEmpty().schema.stringConstraints).toEqual({ nonEmpty: true });
		expect(arg.string().nonEmpty(false).schema.stringConstraints).toEqual({ nonEmpty: false });
	});

	it('.minLength()/.maxLength() set inclusive bounds', () => {
		expect(arg.string().minLength(2).maxLength(8).schema.stringConstraints).toEqual({
			minLength: 2,
			maxLength: 8,
		});
	});

	it('.pattern() stores the regex', () => {
		expect(arg.string().pattern(/^ghp_/).schema.stringConstraints).toEqual({ pattern: /^ghp_/ });
	});

	it('chained methods merge onto the options object', () => {
		const a = arg.string({ nonEmpty: true }).minLength(2).maxLength(8).pattern(/^a/);
		expect(a.schema.stringConstraints).toEqual({
			nonEmpty: true,
			minLength: 2,
			maxLength: 8,
			pattern: /^a/,
		});
	});

	it('a later chained call overrides an earlier value', () => {
		expect(arg.string({ minLength: 1 }).minLength(5).schema.stringConstraints).toEqual({
			minLength: 5,
		});
		expect(arg.string({ pattern: /^a/ }).pattern(/^b/).schema.stringConstraints).toEqual({
			pattern: /^b/,
		});
	});

	it('throws RangeError for malformed chained bounds', () => {
		expect(() => arg.string().minLength(-1)).toThrow(RangeError);
		expect(() => arg.string().maxLength(-1)).toThrow(RangeError);
		expect(() => arg.string({ maxLength: 2 }).minLength(5)).toThrow(RangeError);
	});

	it('preserves presence, variadic, and stdin state through the chain', () => {
		const optional = arg.string().optional().nonEmpty().minLength(2);
		expect(optional.schema.presence).toBe('optional');
		expectTypeOf<InferArg<typeof optional>>().toEqualTypeOf<string | undefined>();

		const variadic = arg.string().variadic().pattern(/^a/);
		expect(variadic.schema.variadic).toBe(true);
		expectTypeOf<InferArg<typeof variadic>>().toEqualTypeOf<string[]>();

		const piped = arg.string().stdin().nonEmpty();
		expect(piped.schema.stdin).toEqual({
			when: 'dash-or-missing',
			consume: 'exclusive',
			trim: false,
		});
		expect(piped.schema.stringConstraints).toEqual({ nonEmpty: true });
	});

	it('does not mutate the source builder (immutability)', () => {
		const base = arg.string({ minLength: 2 });
		base.maxLength(8);
		base.nonEmpty();
		expect(base.schema.stringConstraints).toEqual({ minLength: 2 });
	});
});

// === End-to-end — constraints through the parse and resolve pipelines

describe('string constraints e2e', () => {
	it('accepts a CLI value that satisfies all constraints', async () => {
		let received: unknown;
		const cmd = command('deploy')
			.flag('token', flag.string({ nonEmpty: true, minLength: 5, pattern: /^ghp_/ }))
			.action(({ flags }) => {
				received = flags.token;
			});

		const result = await runCommand(cmd, ['--token', 'ghp_valid']);
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
		expect(received).toBe('ghp_valid');
	});

	it('rejects a CLI pattern violation with exit 2 and a must-match message', async () => {
		const cmd = command('deploy')
			.flag('token', flag.string().pattern(/^ghp_/))
			.action(() => {});

		const result = await runCommand(cmd, ['--token', 'abc']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toBe("Invalid value 'abc' for flag --token: must match /^ghp_/");
	});

	it('rejects a CLI minLength violation with the length wording', async () => {
		const cmd = command('deploy')
			.flag('token', flag.string().minLength(5))
			.action(() => {});

		const result = await runCommand(cmd, ['--token', 'abc']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toBe(
			"Invalid value 'abc' for flag --token: must be at least 5 characters",
		);
	});

	it('rejects an env-sourced violation as CONSTRAINT_VIOLATED', async () => {
		const cmd = command('deploy')
			.flag('token', flag.string().pattern(/^ghp_/).env('DEPLOY_TOKEN'))
			.action(() => {});

		const result = await runCommand(cmd, [], { env: { DEPLOY_TOKEN: 'abc' } });
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toBe(
			"Invalid value '<redacted>' from env DEPLOY_TOKEN for flag --token: must match /^ghp_/",
		);
	});

	it('accepts a config-sourced value that satisfies constraints', async () => {
		let received: unknown;
		const cmd = command('deploy')
			.flag('token', flag.string({ minLength: 5, pattern: /^ghp_/ }).config('auth.token'))
			.action(({ flags }) => {
				received = flags.token;
			});

		const result = await runCommand(cmd, [], { config: { auth: { token: 'ghp_ok' } } });
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
		expect(received).toBe('ghp_ok');
	});
});
