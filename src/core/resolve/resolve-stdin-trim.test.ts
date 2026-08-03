/**
 * `.stdin({ trim: true })`: dropping the single terminator a pipe appends from a
 * value that would otherwise keep it.
 *
 * @module dreamcli/core/resolve/resolve-stdin-trim.test
 */

import { describe, expect, it } from 'vitest';
import { parse } from '#internals/core/parse/index.ts';
import { readFlags } from '#internals/core/read-flags/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { ResolveOptions } from './index.ts';
import { resolve } from './index.ts';

// --- helpers

/** Resolve one flag against the given argv and sources. */
async function resolveFlag(
	builder: FlagBuilder<FlagConfig>,
	argv: readonly string[],
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.flag('value', builder)
		.action(() => {}).schema;
	const result = await resolve(schema, parse(schema, argv), options);
	return result.flags.value;
}

/** Resolve one positional against the given argv and sources. */
async function resolveArg(
	builder: ArgBuilder<ArgConfig>,
	argv: readonly string[],
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.arg('value', builder)
		.action(() => {}).schema;
	const result = await resolve(schema, parse(schema, argv), options);
	return result.args.value;
}

// === the buffer a scalar receives

describe('trim on a scalar', () => {
	it('keeps the terminator by default', async () => {
		expect(await resolveFlag(flag.string().stdin(), [], { stdinData: 'hello\n' })).toBe('hello\n');
		expect(await resolveArg(arg.string().stdin(), [], { stdinData: 'hello\n' })).toBe('hello\n');
	});

	it('drops one trailing newline when asked', async () => {
		expect(
			await resolveFlag(flag.string().stdin({ trim: true }), [], { stdinData: 'hello\n' }),
		).toBe('hello');
		expect(await resolveArg(arg.string().stdin({ trim: true }), [], { stdinData: 'hello\n' })).toBe(
			'hello',
		);
	});

	it('drops a carriage return pair and a lone carriage return', async () => {
		const piped = flag.string().stdin({ trim: true });
		expect(await resolveFlag(piped, [], { stdinData: 'hello\r\n' })).toBe('hello');
		expect(await resolveFlag(piped, [], { stdinData: 'hello\r' })).toBe('hello');
	});

	it('drops one terminator only', async () => {
		expect(
			await resolveFlag(flag.string().stdin({ trim: true }), [], { stdinData: 'hello\n\n' }),
		).toBe('hello\n');
	});

	it('leaves a value with no terminator alone', async () => {
		expect(await resolveFlag(flag.string().stdin({ trim: true }), [], { stdinData: 'hello' })).toBe(
			'hello',
		);
	});

	it('applies to an explicit dash the same way', async () => {
		expect(
			await resolveFlag(flag.string().stdin({ trim: true }), ['--value', '-'], {
				stdinData: 'hello\n',
			}),
		).toBe('hello');
	});

	it('changes nothing for a codec that already drops the terminator', async () => {
		expect(await resolveFlag(flag.number().stdin({ trim: true }), [], { stdinData: '42\n' })).toBe(
			42,
		);
		expect(await resolveFlag(flag.number().stdin(), [], { stdinData: '42\n' })).toBe(42);
	});

	it('never takes a second terminator off a codec that drops one', async () => {
		const piped = { stdinData: 'x\n\n' };
		expect(
			await resolveFlag(flag.custom((raw: unknown) => raw).stdin({ trim: true }), [], piped),
		).toBe(await resolveFlag(flag.custom((raw: unknown) => raw).stdin(), [], piped));
		expect(
			await resolveFlag(flag.custom((raw: unknown) => raw).stdin({ trim: true }), [], piped),
		).toBe('x\n');
	});

	it('leaves the elements of a collection to the split policy', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).stdin({ trim: true }), [], {
				stdinData: 'a\nb\n',
			}),
		).toEqual(['a', 'b']);
	});

	it('does not reach a value from another source', async () => {
		expect(
			await resolveFlag(flag.string().stdin({ trim: true }).env('BODY'), [], {
				env: { BODY: 'from-env\n' },
			}),
		).toBe('from-env\n');
	});
});

// === constraints and checks see the trimmed value

describe('trim runs before everything that reads the value', () => {
	it('lets a piped path satisfy a mustExist check', async () => {
		const seen: string[] = [];
		const result = await resolveArg(arg.path({ mustExist: true }).stdin({ trim: true }), [], {
			stdinData: './dist\n',
			stat: async (path: string) => {
				seen.push(path);
				return 'directory';
			},
		});
		expect(result).toBe('./dist');
		expect(seen).toEqual(['./dist']);
	});

	it('checks the untrimmed path when trim is off', async () => {
		const seen: string[] = [];
		await resolveArg(arg.path({ mustExist: true }).stdin(), [], {
			stdinData: './dist\n',
			stat: async (path: string) => {
				seen.push(path);
				return 'directory';
			},
		});
		expect(seen).toEqual(['./dist\n']);
	});

	it('measures the trimmed value against a string constraint', async () => {
		expect(
			await resolveFlag(flag.string({ maxLength: 5 }).stdin({ trim: true }), [], {
				stdinData: 'hello\n',
			}),
		).toBe('hello');
	});
});

// === the surfaces outside a command

describe('trim reaches every entry point', () => {
	it('applies through readFlags()', async () => {
		const options = await readFlags(
			{ body: flag.string().stdin({ trim: true }) },
			{ argv: [], stdinData: 'piped\n', env: {} },
		);
		expect(options.body).toBe('piped');
	});

	it('applies through runCommand()', async () => {
		let seen: unknown;
		const cmd = command('run')
			.arg('input', arg.string().stdin({ trim: true }))
			.action(({ args }) => {
				seen = args.input;
			});

		const result = await runCommand(cmd, [], { stdinData: 'piped\n' });

		expect(result.exitCode).toBe(0);
		expect(seen).toBe('piped');
	});
});
