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
