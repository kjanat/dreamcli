/**
 * Standard Schema v1 interop — validators attached via `flag.custom()` /
 * `arg.custom()` are applied after resolution, source-agnostically, for both
 * sync and async validators.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag, type InferFlag } from '#internals/core/schema/flag.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import { runCommand } from '#internals/core/testkit/index.ts';

// === Test helpers

/** Minimal hand-rolled Standard Schema validator — no external dependency. */
function standard<Output>(
	validate: StandardSchemaV1<unknown, Output>['~standard']['validate'],
	vendor = 'test',
): StandardSchemaV1<unknown, Output> {
	return { '~standard': { version: 1, vendor, validate } };
}

/** Sync validator: coerces to an even integer or reports an issue. */
const evenInt = standard<number>((value) => {
	const n = Number(value);
	if (!Number.isInteger(n) || n % 2 !== 0) {
		return { issues: [{ message: 'must be an even integer' }] };
	}
	return { value: n };
});

/** Sync validator: accepts an odd integer, so the count factory's own default of 0 fails it. */
const oddInt = standard<number>((value) => {
	const n = Number(value);
	if (!Number.isInteger(n) || n % 2 === 0) {
		return { issues: [{ message: 'must be an odd integer' }] };
	}
	return { value: n };
});

/** Async validator: accepts a string longer than two chars. */
const asyncName = standard<string>(async (value) => {
	if (typeof value !== 'string' || value.length <= 2) {
		return { issues: [{ message: 'must be longer than two characters' }] };
	}
	return { value };
});

// === Flags

describe('Standard Schema v1 interop — flags', () => {
	it('passes and transforms a valid CLI value', async () => {
		const cmd = command('run')
			.flag('count', flag.custom(evenInt))
			.action(({ flags, out }) =>
				out.log(`count=${String(flags.count)} type=${typeof flags.count}`),
			);

		const result = await runCommand(cmd, ['--count', '4']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toBe('count=4 type=number\n');
	});

	it('rejects an invalid CLI value with CONSTRAINT_VIOLATED', async () => {
		const cmd = command('run')
			.flag('count', flag.custom(evenInt))
			.action(({ out }) => out.log('unreachable'));

		const result = await runCommand(cmd, ['--count', '3']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toContain('--count failed validation');
		expect(result.error?.message).toContain('must be an even integer');
	});

	it('validates values from env, not just CLI (source-agnostic)', async () => {
		const cmd = command('run')
			.flag('count', flag.custom(evenInt).env('COUNT'))
			.action(({ flags, out }) => out.log(`count=${String(flags.count)}`));

		const ok = await runCommand(cmd, [], { env: { COUNT: '8' } });
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout[0]).toBe('count=8\n');

		const bad = await runCommand(cmd, [], { env: { COUNT: '7' } });
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(bad.error?.details).toEqual({
			value: '7',
			issues: ['must be an even integer'],
		});
	});

	it('omits a sensitive value and validator issue path', async () => {
		const rejectsAtSecretPath = standard(() => ({
			issues: [{ message: 'rejected', path: ['private-segment'] }],
		}));
		const cmd = command('run')
			.flag('token', flag.custom(rejectsAtSecretPath).sensitive())
			.action(() => {});

		const result = await runCommand(cmd, ['--token', 'private-value']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toBe('--token failed validation: rejected');
		expect(result.error?.details).toEqual({ issues: ['rejected'] });
		expect(JSON.stringify(result.error)).not.toContain('private-value');
		expect(JSON.stringify(result.error)).not.toContain('private-segment');
	});

	it('omits a sensitive record key from the element label', async () => {
		const cmd = command('run')
			.flag(
				'vars',
				flag
					.keyValue(flag.custom(standard(() => ({ issues: [{ message: 'rejected' }] }))))
					.sensitive(),
			)
			.action(() => {});

		const result = await runCommand(cmd, ['--vars', 'private-key=value']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toBe('--vars failed validation: rejected');
		expect(JSON.stringify(result.error)).not.toContain('private-key');
	});

	it('keeps a sensitive collection index because it is framework metadata', async () => {
		const cmd = command('run')
			.flag('values', flag.array(flag.custom(evenInt)).sensitive())
			.action(() => {});

		const result = await runCommand(cmd, ['--values', '3']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toBe('--values[0] failed validation: must be an even integer');
		expect(result.error?.details).toEqual({ issues: ['must be an even integer'] });
		expect(JSON.stringify(result.error)).not.toContain('3');
	});

	it('skips validation for an absent optional flag', async () => {
		const cmd = command('run')
			.flag('count', flag.custom(evenInt))
			.action(({ flags, out }) => out.log(`count=${String(flags.count)}`));

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toBe('count=undefined\n');
	});

	it('awaits an async validator', async () => {
		const cmd = command('run')
			.flag('name', flag.custom(asyncName))
			.action(({ flags, out }) => out.log(`name=${String(flags.name)}`));

		const ok = await runCommand(cmd, ['--name', 'booga']);
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout[0]).toBe('name=booga\n');

		const bad = await runCommand(cmd, ['--name', 'no']);
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.message).toContain('must be longer than two characters');
	});

	it('collects thrown and rejected validator failures', async () => {
		const throws = standard(() => {
			throw new Error('sync validator failed');
		});
		const rejects = standard(async () => {
			throw new Error('async validator failed');
		});
		const cmd = command('run')
			.flag('first', flag.custom(throws))
			.flag('second', flag.custom(rejects))
			.action(({ out }) => out.log('unreachable'));

		const result = await runCommand(cmd, ['--first', 'one', '--second', 'two']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toContain('sync validator failed');
		expect(result.error?.message).toContain('async validator failed');
		expect(result.error?.details).toMatchObject({ count: 2 });
	});

	it('validates and transforms Standard Schema array elements', async () => {
		const cmd = command('run')
			.flag('count', flag.array(flag.custom(evenInt)))
			.action(({ flags, out }) => out.log(flags.count.join(',')));

		const ok = await runCommand(cmd, ['--count', '2', '--count', '4']);
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout[0]).toBe('2,4\n');

		const bad = await runCommand(cmd, ['--count', '2', '--count', '3']);
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.message).toContain('--count[1] failed validation');
	});

	it('validates a count flag, whose scalar value carries the element validator', async () => {
		const cmd = command('run')
			.flag('verbose', flag.count().alias('v').standard(evenInt))
			.action(({ flags, out }) => out.log(`verbose=${String(flags.verbose)}`));

		const ok = await runCommand(cmd, ['-v', '-v']);
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout[0]).toBe('verbose=2\n');

		const bad = await runCommand(cmd, ['-v']);
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(bad.error?.message).toBe('--verbose failed validation: must be an even integer');
	});

	it('validates a count flag resolved from env', async () => {
		const cmd = command('run')
			.flag('verbose', flag.count().env('VERBOSE').standard(evenInt))
			.action(({ out }) => out.log('unreachable'));

		const result = await runCommand(cmd, [], { env: { VERBOSE: '3' } });

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toBe('--verbose failed validation: must be an even integer');
	});

	it('validates a count flag left at the factory default', async () => {
		const cmd = command('run')
			.flag('verbose', flag.count().standard(oddInt))
			.action(({ out }) => out.log('unreachable'));

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toBe('--verbose failed validation: must be an odd integer');
	});
});

// === Args

describe('Standard Schema v1 interop — args', () => {
	it('validates and transforms a positional arg', async () => {
		const cmd = command('run')
			.arg('n', arg.custom(evenInt))
			.action(({ args, out }) => out.log(`n=${String(args.n)} type=${typeof args.n}`));

		const ok = await runCommand(cmd, ['6']);
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout[0]).toBe('n=6 type=number\n');

		const bad = await runCommand(cmd, ['5']);
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(bad.error?.message).toContain('<n> failed validation');
	});

	it('awaits an async validator for a positional arg', async () => {
		const cmd = command('run')
			.arg('name', arg.custom(asyncName))
			.action(({ args, out }) => out.log(`name=${String(args.name)}`));

		const ok = await runCommand(cmd, ['booga']);
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout[0]).toBe('name=booga\n');

		const bad = await runCommand(cmd, ['no']);
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(bad.error?.message).toContain('must be longer than two characters');
	});

	it('validates and transforms every variadic positional value', async () => {
		const cmd = command('run')
			.arg('n', arg.custom(evenInt).variadic())
			.action(({ args, out }) => out.log(args.n.join(',')));

		const ok = await runCommand(cmd, ['2', '4']);
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout[0]).toBe('2,4\n');

		const bad = await runCommand(cmd, ['2', '3']);
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.message).toContain('<n>[1] failed validation');
	});
});

// === Names that an Object.prototype member also carries

describe('Standard Schema v1 interop — Object.prototype member names', () => {
	it('skips a validator on an unresolved flag named after a prototype member', async () => {
		const cmd = command('run')
			.flag('toString', flag.custom(asyncName))
			.flag('needed', flag.string().required())
			.action(({ out }) => out.log('unreachable'));

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('REQUIRED_FLAG');
		expect(result.error?.message).toBe('Missing required flag --needed');
	});

	it('skips a validator on an unresolved arg named after a prototype member', async () => {
		const cmd = command('run')
			.arg('needed', arg.string())
			.arg('valueOf', arg.custom(asyncName).optional())
			.action(({ out }) => out.log('unreachable'));

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('REQUIRED_ARG');
		expect(result.error?.message).toBe('Missing required argument <needed>');
	});

	it('still validates such a flag once a value resolves', async () => {
		const cmd = command('run')
			.flag('toString', flag.custom(asyncName))
			.action(({ out }) => out.log('ok'));

		const bad = await runCommand(cmd, ['--toString', 'no']);
		expect(bad.exitCode).toBe(2);
		expect(bad.error?.message).toContain('--toString failed validation');

		const ok = await runCommand(cmd, ['--toString', 'yes']);
		expect(ok.exitCode).toBe(0);
	});
});

// === Type inference

describe('Standard Schema v1 interop — types', () => {
	it('infers the validator output type on flags', () => {
		const typed = standard<number>((value) => ({ value: Number(value) }));
		const built = flag.custom(typed);
		expectTypeOf<InferFlag<typeof built>>().toEqualTypeOf<number | undefined>();
	});

	it('still infers a parse function return type on flags', () => {
		const built = flag.custom((raw) => new URL(String(raw)));
		expectTypeOf<InferFlag<typeof built>>().toEqualTypeOf<URL | undefined>();
	});
});
