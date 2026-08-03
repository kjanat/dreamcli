/**
 * Parity between the value-level members of `flag` and `arg`.
 *
 * Every raw value is pushed through both factories and the verdicts, error
 * codes, and messages are compared. A flag and an arg differ only in how the
 * subject is named (`flag --x` vs `argument <x>`), so a message that differs
 * anywhere else is drift.
 */

import { describe, expect, it } from 'vitest';
import { isValidationError } from '#internals/core/errors/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import type { ResolveOptions } from '#internals/core/resolve/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { ArgBuilder, ArgConfig } from './arg.ts';
import { arg, createArgSchema } from './arg.ts';
import type { CommandSchema } from './command.ts';
import { command, createCommandSchema } from './command.ts';
import type { FlagBuilder, FlagConfig } from './flag.ts';
import { createFlagSchema, flag } from './flag.ts';
import type { PromptConfig } from './prompt.ts';
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

// === the same failures, read off a source the user did not type

/**
 * Normalize the subject out of an off-argv diagnostic.
 *
 * The reference appears in the message and in the suggestion alike, and the two
 * surfaces spell it differently, so both spellings collapse onto one token.
 */
function withoutReference(text: string | undefined): string | undefined {
	return text
		?.replaceAll('flag --x', '<subject>')
		.replaceAll('argument <x>', '<subject>')
		.replaceAll('--x', '<subject>')
		.replaceAll('<x>', '<subject>');
}

/** Report what resolving one schema did, with the subject normalized away. */
async function sourcedVerdict(schema: CommandSchema, options: ResolveOptions): Promise<Verdict> {
	const error = await resolve(schema, parse(schema, []), options).then(
		() => undefined,
		(thrown: unknown) => (isValidationError(thrown) ? thrown : undefined),
	);
	return {
		accepted: error === undefined,
		code: error?.code,
		reason: withoutReference(error?.message),
		value: undefined,
	};
}

/** Resolve one flag from the environment and report the verdict. */
async function flagEnvVerdict<C extends FlagConfig>(
	builder: FlagBuilder<C>,
	raw: string,
): Promise<Verdict> {
	const schema = createCommandSchema({ name: 'subject', flags: { x: builder.env('VAR').schema } });
	return sourcedVerdict(schema, { env: { VAR: raw } });
}

/** Resolve one positional from the environment and report the verdict. */
async function argEnvVerdict<C extends ArgConfig>(
	builder: ArgBuilder<C>,
	raw: string,
): Promise<Verdict> {
	const schema = createCommandSchema({
		name: 'subject',
		args: [{ name: 'x', schema: builder.env('VAR').schema }],
	});
	return sourcedVerdict(schema, { env: { VAR: raw } });
}

/** Resolve one flag from a config value of any shape and report the verdict. */
async function flagConfigVerdict<C extends FlagConfig>(
	builder: FlagBuilder<C>,
	raw: unknown,
): Promise<Verdict> {
	const schema = createCommandSchema({ name: 'subject', flags: { x: builder.config('p').schema } });
	return sourcedVerdict(schema, { config: { p: raw } });
}

/** Resolve one positional from a config value of any shape and report the verdict. */
async function argConfigVerdict<C extends ArgConfig>(
	builder: ArgBuilder<C>,
	raw: unknown,
): Promise<Verdict> {
	const schema = createCommandSchema({
		name: 'subject',
		args: [{ name: 'x', schema: builder.config('p').schema }],
	});
	return sourcedVerdict(schema, { config: { p: raw } });
}

describe('an environment value fails the same way on both surfaces', () => {
	const cases: ReadonlyArray<
		readonly [string, () => FlagBuilder<FlagConfig>, () => ArgBuilder<ArgConfig>, string]
	> = [
		['a number', () => flag.number(), () => arg.number(), 'nope'],
		['a boolean', () => flag.boolean(), () => arg.boolean(), 'nope'],
		['an enum', () => flag.enum(['us', 'eu']), () => arg.enum(['us', 'eu']), 'mars'],
		['a length bound', () => flag.string().minLength(9), () => arg.string().minLength(9), 'short'],
		[
			'a pattern',
			() => flag.string().pattern(/^ghp_/),
			() => arg.string().pattern(/^ghp_/),
			'nope',
		],
		['a numeric bound', () => flag.number().min(1000), () => arg.number().min(1000), '5'],
		['an integer', () => flag.number().int(), () => arg.number().int(), '1.5'],
		['a url', () => flag.url(), () => arg.url(), 'nope'],
		[
			'a url protocol',
			() => flag.url({ protocols: ['https'] }),
			() => arg.url({ protocols: ['https'] }),
			'http://example.com',
		],
		['a date', () => flag.date(), () => arg.date(), 'nope'],
		['a duration', () => flag.duration(), () => arg.duration(), 'nope'],
		['a size', () => flag.bytes(), () => arg.bytes(), 'nope'],
		[
			'a thrown message holding colons',
			() =>
				flag.custom(() => {
					throw new Error('bad input: really bad');
				}),
			() =>
				arg.custom(() => {
					throw new Error('bad input: really bad');
				}),
			'anything',
		],
	];

	for (const [label, flagBuilder, argBuilder, raw] of cases) {
		it(`rejects ${label} with the same code and reason`, async () => {
			const forFlag = await flagEnvVerdict(flagBuilder(), raw);
			const forArg = await argEnvVerdict(argBuilder(), raw);

			expect(forFlag.accepted).toBe(false);
			expect(forArg.code).toBe(forFlag.code);
			expect(forArg.reason).toBe(forFlag.reason);
		});
	}

	it('rejects a config value no string codec can read with the same reason', async () => {
		const forFlag = await flagConfigVerdict(flag.string(), {});
		const forArg = await argConfigVerdict(arg.string(), {});

		expect(forArg.code).toBe(forFlag.code);
		expect(forArg.reason).toBe(forFlag.reason);
		expect(forFlag.reason).toBe('Invalid string value from config p for <subject>');
	});
});

// === a collection given the wrong shape

describe('a config value of the wrong shape fails the same way on both surfaces', () => {
	it('names the array a list wanted', async () => {
		const forFlag = await flagConfigVerdict(flag.array(flag.string()), 5);
		const forArg = await argConfigVerdict(arg.string().variadic(), 5);

		expect(forArg.code).toBe(forFlag.code);
		expect(forArg.reason).toBe(forFlag.reason);
		expect(forFlag.reason).toBe('Invalid array value from config p for <subject>');
	});

	it('names the object a key-value input wanted', async () => {
		const forFlag = await flagConfigVerdict(flag.keyValue(), 5);
		const forArg = await argConfigVerdict(arg.keyValue(), 5);

		expect(forArg.code).toBe(forFlag.code);
		expect(forArg.reason).toBe(forFlag.reason);
		expect(forFlag.reason).toBe('Invalid object value from config p for <subject>');
	});

	it('names the array a list wanted when the config value is an object', async () => {
		const forFlag = await flagConfigVerdict(flag.array(flag.string()), { a: 1 });
		const forArg = await argConfigVerdict(arg.string().variadic(), { a: 1 });

		expect(forArg.reason).toBe(forFlag.reason);
		expect(forFlag.reason).toBe('Invalid array value from config p for <subject>');
	});

	it('carries the same expected detail on both surfaces', async () => {
		const flagSchema = createCommandSchema({
			name: 'subject',
			flags: { x: flag.keyValue().config('p').schema },
		});
		const argSchema = createCommandSchema({
			name: 'subject',
			args: [{ name: 'x', schema: arg.keyValue().config('p').schema }],
		});
		const options = { config: { p: 5 } };

		const forFlag = await resolve(flagSchema, parse(flagSchema, []), options).catch(
			(thrown: unknown) => thrown,
		);
		const forArg = await resolve(argSchema, parse(argSchema, []), options).catch(
			(thrown: unknown) => thrown,
		);

		expect(isValidationError(forFlag) && forFlag.details).toEqual({
			flag: 'x',
			source: 'config',
			configPath: 'p',
			expected: 'object',
		});
		expect(isValidationError(forArg) && forArg.details).toEqual({
			arg: 'x',
			source: 'config',
			configPath: 'p',
			expected: 'object',
		});
	});
});

// === prompt kinds follow the cardinality, not the kind alone

describe('an input that collects several values takes the same prompt on both surfaces', () => {
	/** Resolve one input from a prompt answer and report the verdict. */
	async function promptVerdict(
		schema: CommandSchema,
		answer: unknown,
	): Promise<Verdict & { readonly resolved: unknown }> {
		let resolved: unknown;
		const prompter = { promptOne: () => Promise.resolve({ answered: true, value: answer }) };
		const error = await resolve(schema, parse(schema, []), { prompter }).then(
			(result) => {
				resolved = result.flags.x ?? result.args.x;
				return undefined;
			},
			(thrown: unknown) => (isValidationError(thrown) ? thrown : undefined),
		);
		return {
			accepted: error === undefined,
			code: error?.code,
			reason: withoutReference(error?.message),
			value: undefined,
			resolved,
		};
	}

	/** A command carrying one list flag with the given prompt config. */
	function flagWith(prompt: PromptConfig): CommandSchema {
		return createCommandSchema({
			name: 'subject',
			flags: {
				x: createFlagSchema('array', { elementSchema: flag.string().schema, prompt }),
			},
		});
	}

	/** A command carrying one variadic positional with the given prompt config. */
	function argWith(prompt: PromptConfig): CommandSchema {
		return createCommandSchema({
			name: 'subject',
			args: [{ name: 'x', schema: createArgSchema('string', { variadic: true, prompt }) }],
		});
	}

	it('takes a multiselect answer on both surfaces', async () => {
		const prompt: PromptConfig = {
			kind: 'multiselect',
			message: 'Pick',
			choices: [{ value: 'a' }, { value: 'b' }],
		};
		const forFlag = await promptVerdict(flagWith(prompt), ['a', 'b']);
		const forArg = await promptVerdict(argWith(prompt), ['a', 'b']);

		expect(forFlag.accepted).toBe(true);
		expect(forArg.accepted).toBe(true);
		expect(forArg.resolved).toEqual(forFlag.resolved);
		expect(forArg.resolved).toEqual(['a', 'b']);
	});

	for (const kind of ['input', 'select', 'confirm'] as const) {
		it(`rejects a ${kind} prompt with the same code and reason`, async () => {
			const prompt: PromptConfig = { kind, message: 'Pick' };
			const forFlag = await promptVerdict(flagWith(prompt), 'a');
			const forArg = await promptVerdict(argWith(prompt), 'a');

			expect(forFlag.accepted).toBe(false);
			expect(forArg.code).toBe(forFlag.code);
			expect(forArg.code).toBe('CONSTRAINT_VIOLATED');
			expect(forFlag.reason).toBe(
				`Prompt kind '${kind}' is not compatible with array <subject>. Use 'multiselect' instead`,
			);
			expect(forArg.reason).toBe(
				`Prompt kind '${kind}' is not compatible with variadic string <subject>. Use 'multiselect' instead`,
			);
		});
	}

	it('rejects prompts on key-value definitions at both factory boundaries', () => {
		const prompt: PromptConfig = { kind: 'input', message: 'Pick' };

		expect(() => createFlagSchema('keyValue', { prompt })).toThrow(
			"Flag schema field 'prompt' is not available on kind 'keyValue'",
		);
		expect(() => createArgSchema('keyValue', { prompt })).toThrow(
			"Arg schema field 'prompt' is not available on kind 'keyValue'",
		);
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
