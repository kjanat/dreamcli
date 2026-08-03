/**
 * Parity between the value-level members of `flag` and `arg`.
 *
 * Every raw value is pushed through both factories and the verdicts, error
 * codes, and messages are compared. A flag and an arg differ only in how the
 * subject is named (`flag --x` vs `argument <x>`), so a message that differs
 * anywhere else is drift.
 */

import { describe, expect, it } from 'vitest';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { ArgBuilder, ArgConfig } from './arg.ts';
import { arg } from './arg.ts';
import { command } from './command.ts';
import type { FlagBuilder, FlagConfig } from './flag.ts';
import { flag } from './flag.ts';
import type { StandardSchemaV1 } from './standard.ts';
import type { ValueInput, ValueSchema } from './value.ts';
import { argValueSchema, decodeValue, flagValueSchema, valueEnumValues } from './value.ts';

/** What one factory did with one raw value. */
interface Verdict {
	readonly accepted: boolean;
	readonly code: string | undefined;
	/** Message with the subject normalized away, so only the reason remains. */
	readonly reason: string | undefined;
	readonly value: unknown;
}

/**
 * Strip the subject from a message so a flag verdict and an arg verdict are
 * directly comparable.
 */
function withoutSubject(message: string | undefined): string | undefined {
	return message
		?.replaceAll('for flag --x', '<subject>')
		.replaceAll('for argument <x>', '<subject>')
		.replaceAll('parse flag --x', 'parse <subject>')
		.replaceAll('parse argument <x>', 'parse <subject>');
}

/** Push `raw` through a flag on the CLI and report the verdict. */
async function flagVerdict<C extends FlagConfig>(
	builder: FlagBuilder<C>,
	raw: string,
): Promise<Verdict> {
	let value: unknown;
	const cmd = command('subject')
		.flag('x', builder)
		.action(({ flags }) => {
			value = flags.x;
		});
	const result = await runCommand(cmd, ['--x', raw]);
	return {
		accepted: result.exitCode === 0,
		code: result.error?.code,
		reason: withoutSubject(result.error?.message),
		value,
	};
}

/** Push `raw` through a positional arg on the CLI and report the verdict. */
async function argVerdict<C extends ArgConfig>(
	builder: ArgBuilder<C>,
	raw: string,
): Promise<Verdict> {
	let value: unknown;
	const cmd = command('subject')
		.arg('x', builder)
		.action(({ args }) => {
			value = args.x;
		});
	const result = await runCommand(cmd, [raw]);
	return {
		accepted: result.exitCode === 0,
		code: result.error?.code,
		reason: withoutSubject(result.error?.message),
		value,
	};
}

/** Assert both factories reached the same verdict for `raw`. */
async function expectParity<F extends FlagConfig, A extends ArgConfig>(
	flagBuilder: FlagBuilder<F>,
	argBuilder: ArgBuilder<A>,
	raw: string,
): Promise<Verdict> {
	const forFlag = await flagVerdict(flagBuilder, raw);
	const forArg = await argVerdict(argBuilder, raw);
	expect(forArg.accepted).toBe(forFlag.accepted);
	expect(forArg.code).toBe(forFlag.code);
	expect(forArg.reason).toBe(forFlag.reason);
	expect(forArg.value).toEqual(forFlag.value);
	return forArg;
}

// === url

describe('flag.url() / arg.url() parity', () => {
	it('accepts the same URL and produces the same value', async () => {
		const verdict = await expectParity(flag.url(), arg.url(), 'https://example.com/api');
		expect(verdict.accepted).toBe(true);
		expect(verdict.value).toEqual(new URL('https://example.com/api'));
	});

	it('rejects a malformed URL with the same code and reason', async () => {
		const verdict = await expectParity(flag.url(), arg.url(), 'not-a-url');
		expect(verdict.accepted).toBe(false);
		expect(verdict.code).toBe('INVALID_VALUE');
		expect(verdict.reason).toBe("Failed to parse <subject>: Invalid URL 'not-a-url'");
	});

	it('rejects a disallowed protocol with the same reason', async () => {
		const options = { protocols: ['https'] } as const;
		const verdict = await expectParity(flag.url(options), arg.url(options), 'http://example.com/');
		expect(verdict.accepted).toBe(false);
		expect(verdict.reason).toBe(
			"Failed to parse <subject>: URL protocol 'http' is not allowed. Allowed: https",
		);
	});
});

// === date

describe('flag.date() / arg.date() parity', () => {
	it('accepts the same ISO date', async () => {
		const verdict = await expectParity(flag.date(), arg.date(), '2026-07-10');
		expect(verdict.accepted).toBe(true);
		expect(verdict.value).toEqual(new Date(Date.UTC(2026, 6, 10)));
	});

	it('rejects a lenient Date.parse input with the same reason', async () => {
		const verdict = await expectParity(flag.date(), arg.date(), 'March 5');
		expect(verdict.accepted).toBe(false);
		expect(verdict.code).toBe('INVALID_VALUE');
		expect(verdict.reason).toContain("Invalid date 'March 5'");
	});

	it('rejects a calendar-invalid date with the same reason', async () => {
		const verdict = await expectParity(flag.date(), arg.date(), '2026-02-31');
		expect(verdict.reason).toBe(
			"Failed to parse <subject>: Invalid date '2026-02-31': not a real calendar date",
		);
	});

	it('rejects a value outside the declared bounds with the same reason', async () => {
		const options = { min: new Date('2026-01-01T00:00:00.000Z') };
		const verdict = await expectParity(flag.date(options), arg.date(options), '2025-06-01');
		expect(verdict.accepted).toBe(false);
		expect(verdict.reason).toBe(
			"Failed to parse <subject>: Date '2025-06-01' is before the earliest allowed 2026-01-01T00:00:00.000Z",
		);
	});
});

// === duration

describe('flag.duration() / arg.duration() parity', () => {
	it('accepts a compound duration and resolves to the same milliseconds', async () => {
		const verdict = await expectParity(flag.duration(), arg.duration(), '1h30m');
		expect(verdict.value).toBe(5_400_000);
	});

	it('accepts a bare millisecond count', async () => {
		const verdict = await expectParity(flag.duration(), arg.duration(), '1500');
		expect(verdict.value).toBe(1500);
	});

	it('rejects a malformed duration with the same reason', async () => {
		const verdict = await expectParity(flag.duration(), arg.duration(), '5 parsecs');
		expect(verdict.accepted).toBe(false);
		expect(verdict.reason).toBe(
			"Failed to parse <subject>: Invalid duration '5 parsecs': expected e.g. 30s, 5m, 1h30m, or 250ms",
		);
	});
});

// === bytes

describe('flag.bytes() / arg.bytes() parity', () => {
	it('accepts a binary size and resolves to the same byte count', async () => {
		const verdict = await expectParity(flag.bytes(), arg.bytes(), '512kb');
		expect(verdict.value).toBe(524_288);
	});

	it('rejects a malformed size with the same reason', async () => {
		const verdict = await expectParity(flag.bytes(), arg.bytes(), '512 furlongs');
		expect(verdict.accepted).toBe(false);
		expect(verdict.reason).toBe(
			"Failed to parse <subject>: Invalid size '512 furlongs': expected e.g. 512mb, 1.5gb, or 64kb",
		);
	});
});

// === path

describe('flag.path() / arg.path() parity', () => {
	it('accepts any string and keeps it a string', async () => {
		const verdict = await expectParity(flag.path(), arg.path(), './out');
		expect(verdict.accepted).toBe(true);
		expect(verdict.value).toBe('./out');
	});

	it('stores the same checks and hint for the same options', () => {
		const options = { type: 'directory', create: true } as const;
		expect(arg.path(options).schema.pathChecks).toEqual(flag.path(options).schema.pathChecks);
		expect(arg.path().schema.valueHint).toBe(flag.path().schema.valueHint);
	});

	it('reports a missing path with the same code and reason', async () => {
		const stat = (): Promise<null> => Promise.resolve(null);
		const flagCmd = command('subject')
			.flag('x', flag.path({ mustExist: true }))
			.action(() => {});
		const argCmd = command('subject')
			.arg('x', arg.path({ mustExist: true }))
			.action(() => {});

		const forFlag = await runCommand(flagCmd, ['--x', '/nope'], { stat });
		const forArg = await runCommand(argCmd, ['/nope'], { stat });

		expect(forArg.exitCode).toBe(forFlag.exitCode);
		expect(forArg.error?.code).toBe(forFlag.error?.code);
		expect(forFlag.error?.message).toBe("Path '/nope' for flag --x does not exist");
		expect(forArg.error?.message).toBe("Path '/nope' for argument <x> does not exist");
		expect(withoutSubject(forArg.error?.message)).toBe(withoutSubject(forFlag.error?.message));
	});
});

// === string constraints

describe('flag.string() / arg.string() constraint parity', () => {
	it('accepts a value satisfying every constraint', async () => {
		const constraints = { nonEmpty: true, minLength: 5, pattern: /^ghp_/ } as const;
		const verdict = await expectParity(
			flag.string(constraints),
			arg.string(constraints),
			'ghp_valid',
		);
		expect(verdict.accepted).toBe(true);
		expect(verdict.value).toBe('ghp_valid');
	});

	it('rejects a pattern violation with the same code and reason', async () => {
		const verdict = await expectParity(
			flag.string().pattern(/^ghp_/),
			arg.string().pattern(/^ghp_/),
			'abc',
		);
		expect(verdict.accepted).toBe(false);
		expect(verdict.code).toBe('INVALID_VALUE');
		expect(verdict.reason).toBe("Invalid value 'abc' <subject>: must match /^ghp_/");
	});

	it('rejects a minLength violation with the same reason', async () => {
		const verdict = await expectParity(
			flag.string().minLength(5),
			arg.string().minLength(5),
			'abc',
		);
		expect(verdict.reason).toBe("Invalid value 'abc' <subject>: must be at least 5 characters");
	});

	it('rejects a maxLength violation with the same reason', async () => {
		const verdict = await expectParity(
			flag.string().maxLength(2),
			arg.string().maxLength(2),
			'abc',
		);
		expect(verdict.reason).toBe("Invalid value 'abc' <subject>: must be at most 2 characters");
	});

	it('rejects an empty value under nonEmpty with the same reason', async () => {
		const verdict = await expectParity(flag.string().nonEmpty(), arg.string().nonEmpty(), '');
		expect(verdict.reason).toBe("Invalid value '' <subject>: must not be empty");
	});

	it('carries the same constraint details on both surfaces', async () => {
		const flagCmd = command('subject')
			.flag('x', flag.string().minLength(5))
			.action(() => {});
		const argCmd = command('subject')
			.arg('x', arg.string().minLength(5))
			.action(() => {});

		const forFlag = await runCommand(flagCmd, ['--x', 'abc']);
		const forArg = await runCommand(argCmd, ['abc']);

		expect(forFlag.error?.details).toEqual({
			flag: 'x',
			input: '--x',
			value: 'abc',
			expected: 'string',
			constraint: 'minLength',
			bound: 5,
		});
		expect(forArg.error?.details).toEqual({
			arg: 'x',
			value: 'abc',
			expected: 'string',
			constraint: 'minLength',
			bound: 5,
		});
	});
});

// === presence defaults — the one deliberate difference

describe('presence defaults', () => {
	it('keeps args required by default and flags optional by default', () => {
		expect(arg.url().schema.presence).toBe('required');
		expect(arg.path().schema.presence).toBe('required');
		expect(arg.date().schema.presence).toBe('required');
		expect(arg.duration().schema.presence).toBe('required');
		expect(arg.bytes().schema.presence).toBe('required');

		expect(flag.url().schema.presence).toBe('optional');
		expect(flag.path().schema.presence).toBe('optional');
		expect(flag.date().schema.presence).toBe('optional');
		expect(flag.duration().schema.presence).toBe('optional');
		expect(flag.bytes().schema.presence).toBe('optional');
	});

	it('gives the sugar factories the same kind and hint on both surfaces', () => {
		expect(arg.url().schema.kind).toBe(flag.url().schema.kind);
		expect(arg.url().schema.valueHint).toBe(flag.url().schema.valueHint);
		expect(arg.path().schema.kind).toBe(flag.path().schema.kind);
		expect(arg.date().schema.kind).toBe(flag.date().schema.kind);
		expect(arg.date().schema.valueHint).toBe(flag.date().schema.valueHint);
		expect(arg.duration().schema.valueHint).toBe(flag.duration().schema.valueHint);
		expect(arg.bytes().schema.valueHint).toBe(flag.bytes().schema.valueHint);
	});
});

// === value projection

/** The value axis with closure identity stripped, so two factories are comparable. */
function valueShape(value: ValueSchema): Readonly<Record<string, unknown>> {
	return {
		codec: value.codec.name,
		enumValues: valueEnumValues(value),
		constraints: value.constraints,
		standard: value.standard,
		pathChecks: value.pathChecks,
		valueHint: value.valueHint,
	};
}

/** What one value schema did with one raw input, reduced to comparable data. */
function decodeShape(value: ValueSchema, raw: unknown, input: ValueInput): unknown {
	const result = decodeValue(value, raw, input);
	if (result.ok) return { ok: true, value: result.value };
	if (result.failure.kind === 'thrown') {
		const error = result.failure.error;
		return { ok: false, kind: 'thrown', message: error instanceof Error ? error.message : error };
	}
	return { ok: false, failure: result.failure };
}

/** Assert both factories project onto the same value and decode the same way. */
function expectValueParity<F extends FlagConfig, A extends ArgConfig>(
	flagBuilder: FlagBuilder<F>,
	argBuilder: ArgBuilder<A>,
	raws: readonly unknown[],
): void {
	const forFlag = flagValueSchema(flagBuilder.schema);
	const forArg = argValueSchema(argBuilder.schema);
	expect(forFlag).toBeDefined();
	if (forFlag === undefined) return;

	expect(valueShape(forArg)).toEqual(valueShape(forFlag));
	for (const raw of raws) {
		for (const input of ['token', 'env', 'config', 'prompt'] as const) {
			expect(decodeShape(forArg, raw, input)).toEqual(decodeShape(forFlag, raw, input));
		}
	}
}

describe('value projection parity', () => {
	it('projects string declarations onto one identical value', () => {
		const constraints = { nonEmpty: true, minLength: 3, pattern: /^ghp_/ } as const;
		expect(argValueSchema(arg.string(constraints).schema)).toEqual(
			flagValueSchema(flag.string(constraints).schema),
		);
		expectValueParity(flag.string(constraints), arg.string(constraints), [
			'ghp_valid',
			'ab',
			'',
			42,
		]);
	});

	it('projects number declarations onto one identical value', () => {
		const constraints = { int: true, min: 0, max: 10 } as const;
		expect(argValueSchema(arg.number(constraints).schema)).toEqual(
			flagValueSchema(flag.number(constraints).schema),
		);
		expectValueParity(flag.number(constraints), arg.number(constraints), [
			'5',
			'3.7',
			'11',
			Number.NaN,
		]);
	});

	it('projects enum declarations onto the same literals', () => {
		const values = ['us', 'eu', 'ap'] as const;
		expectValueParity(flag.enum(values), arg.enum(values), ['eu', 'nope', 7]);
		expect(valueEnumValues(argValueSchema(arg.enum(values).schema))).toEqual([...values]);
		expect(valueEnumValues(flagValueSchema(flag.enum(values).schema))).toEqual([...values]);
	});

	it('projects a Standard Schema declaration onto one identical value', () => {
		const standard: StandardSchemaV1<unknown, string> = {
			'~standard': {
				version: 1,
				vendor: 'parity',
				validate: (value) =>
					typeof value === 'string' ? { value } : { issues: [{ message: 'not a string' }] },
			},
		};
		expect(argValueSchema(arg.custom(standard).schema)).toEqual(
			flagValueSchema(flag.custom(standard).schema),
		);
		expectValueParity(flag.custom(standard), arg.custom(standard), ['x', 7]);
	});

	it('projects a custom parse function onto the same codec and the same verdict', () => {
		const body = (raw: string): string => {
			if (raw === 'boom') throw new Error(`bad: ${raw}`);
			return `<${raw}>`;
		};
		const flagBuilder = flag.custom((raw: unknown) => body(String(raw)));
		const argBuilder = arg.custom(body);
		expectValueParity(flagBuilder, argBuilder, ['ok', 'boom', '']);
	});

	it('hands each surface its own parse function verbatim', () => {
		const flagParse = (raw: unknown): string => String(raw);
		const argParse = (raw: string): string => raw;
		expect(flag.custom(flagParse).schema.parseFn).toBe(flagParse);
		expect(arg.custom(argParse).schema.parseFn).toBe(argParse);
	});

	it('projects bounded date declarations onto one identical value', () => {
		const options = {
			min: new Date('2026-01-01T00:00:00Z'),
			max: new Date('2026-12-31T00:00:00Z'),
		};
		expectValueParity(flag.date(options), arg.date(options), [
			'2026-07-10',
			'2025-12-31',
			'2027-01-01',
		]);
	});

	it('projects every sugar member onto the same value', () => {
		expectValueParity(flag.url(), arg.url(), ['https://example.com/', 'not-a-url']);
		expectValueParity(flag.url({ protocols: ['https'] }), arg.url({ protocols: ['https'] }), [
			'http://example.com/',
		]);
		expectValueParity(flag.date(), arg.date(), ['2026-07-10', '2026-02-31', 'March 5']);
		expectValueParity(flag.duration(), arg.duration(), ['1h30m', '1500', '5 parsecs']);
		expectValueParity(flag.bytes(), arg.bytes(), ['512kb', '512 furlongs']);
		expectValueParity(flag.path(), arg.path(), ['./out']);
	});

	it('projects path options onto the same checks and hint', () => {
		const options = { type: 'directory', create: true } as const;
		expect(argValueSchema(arg.path(options).schema)).toEqual(
			flagValueSchema(flag.path(options).schema),
		);
	});
});
