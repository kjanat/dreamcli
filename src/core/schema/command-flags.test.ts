/** Bulk flag registration and inferred action values. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { arg } from './arg.ts';
import { command, createCommandSchema } from './command.ts';
import { flag } from './flag.ts';
import { middleware } from './middleware.ts';

describe('CommandBuilder.flags()', () => {
	it('rejects symbol keys in symbol-only and mixed records', () => {
		const port = Symbol('port');
		const symbolOnly = { [port]: flag.number().required() };
		const mixed = { host: flag.string(), [port]: flag.number().required() };
		// @ts-expect-error Flag names must be strings.
		expect(() => command('serve').flags(symbolOnly)).toThrowError(
			expect.objectContaining({ code: 'INVALID_SCHEMA', details: { command: 'serve' } }),
		);
		// @ts-expect-error String keys cannot make a symbol flag usable.
		expect(() => command('serve').flags(mixed)).toThrowError(
			expect.objectContaining({ code: 'INVALID_SCHEMA', details: { command: 'serve' } }),
		);
	});

	it('rejects symbol keys hidden by a widened type or a non-enumerable property', () => {
		const hidden = { [Symbol('port')]: flag.number().required() };
		const widened: Record<string, ReturnType<typeof flag.number>> = hidden;
		expect(() => command('serve').flags(widened)).toThrow(/flag names must be strings/);
		const generated = Object.fromEntries([[Symbol('port'), flag.number().required()]]);
		expect(() => command('serve').flags(generated)).toThrow(/flag names must be strings/);
		const nonEnumerable = { host: flag.string() };
		Object.defineProperty(nonEnumerable, Symbol('port'), { value: flag.number().required() });
		expect(() => command('serve').flags(nonEnumerable)).toThrow(/flag names must be strings/);
	});

	it('registers a required flag from a non-enumerable own string key', async () => {
		const record = { port: flag.number().required() };
		Object.defineProperty(record, 'port', { enumerable: false });
		const app = cli('app').default(
			command('serve')
				.flags(record)
				.action(({ flags, out }) => {
					expectTypeOf(flags.port).toEqualTypeOf<number>();
					out.json(flags);
				}),
		);

		const missing = await app.execute([]);
		expect(missing.exitCode).not.toBe(0);
		expect(missing.stderr.join('')).toContain('--port');

		const result = await app.execute(['--port', '3000']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('{"port":3000}\n');
	});

	it('rejects symbol keys in command definitions', () => {
		const flags = {
			host: { kind: 'string' },
			[Symbol('port')]: { kind: 'number', required: true },
		} as const;
		expect(() => createCommandSchema({ name: 'serve', flags })).toThrowError(
			expect.objectContaining({ code: 'INVALID_SCHEMA', details: { command: 'serve' } }),
		);
	});

	it('combines generated records and named flags in either order', async () => {
		const generated = Object.fromEntries(['port'].map((name) => [name, flag.number().required()]));
		const before = command('serve')
			.flag('server', flag.string().required())
			.flags(generated)
			.action(({ flags, out }) => {
				expectTypeOf(flags.server).toEqualTypeOf<string>();
				expectTypeOf(flags['generated']).toEqualTypeOf<string | number | undefined>();
				out.json(flags);
			});
		const after = command('serve')
			.flags(generated)
			.flag('server', flag.string().required())
			.action(({ flags, out }) => {
				expectTypeOf(flags.server).toEqualTypeOf<string>();
				expectTypeOf(flags['generated']).toEqualTypeOf<string | number | undefined>();
				out.json(flags);
			});
		for (const cmd of [before, after]) {
			const result = await cli('app').default(cmd).execute(['--port', '3000', '--server', 'local']);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout.join(''))).toEqual({ port: 3000, server: 'local' });
		}
	});

	it('keeps explicit types and duplicate checks through generated records', async () => {
		const numbers = Object.fromEntries(['port'].map((name) => [name, flag.number().required()]));
		const booleans = Object.fromEntries(['verbose'].map((name) => [name, flag.boolean()]));
		const cmd = command('serve')
			.flag('server', flag.string().required())
			.arg('file', arg.string())
			.middleware(middleware<{ user: string }>(async ({ next }) => next({ user: 'kaj' })))
			.flags(numbers)
			.flags({ region: flag.enum(['us', 'eu']).required() })
			.flags(booleans)
			.flag('retries', flag.number().default(3));
		// @ts-expect-error A generated record preserves an earlier explicit name.
		expect(() => cmd.flag('server', flag.boolean())).toThrow(/already defines flag/);
		// @ts-expect-error A literal record preserves its name through later generated records.
		expect(() => cmd.flags({ region: flag.string() })).toThrow(/already defines flag/);
		// @ts-expect-error A named flag added after generated records is tracked too.
		expect(() => cmd.flag('retries', flag.string())).toThrow(/already defines flag/);
		const result = await cli('app')
			.default(
				cmd.action(({ flags, args, ctx, out }) => {
					expectTypeOf(flags.server).toEqualTypeOf<string>();
					expectTypeOf(flags.region).toEqualTypeOf<'us' | 'eu'>();
					expectTypeOf(flags.retries).toEqualTypeOf<number>();
					expectTypeOf(flags['generated']).toEqualTypeOf<string | number | boolean | undefined>();
					expectTypeOf(args.file).toEqualTypeOf<string>();
					expectTypeOf(ctx.user).toEqualTypeOf<string>();
					out.json({ flags, args, user: ctx.user });
				}),
			)
			.execute(['config', '--port', '3000', '--server', 'local', '--region', 'eu']);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.join(''))).toEqual({
			flags: { port: 3000, server: 'local', region: 'eu', verbose: false, retries: 3 },
			args: { file: 'config' },
			user: 'kaj',
		});
	});

	it('checks generated name collisions at runtime in either order', () => {
		const generated = Object.fromEntries(['server'].map((name) => [name, flag.number()]));
		expect(() => command('serve').flag('server', flag.string()).flags(generated)).toThrow(
			/already defines flag/,
		);
		expect(() => command('serve').flags(generated).flag('server', flag.string())).toThrow(
			/already defines flag/,
		);
		expect(() => command('serve').flags(generated).flags(generated)).toThrow(
			/already defines flag/,
		);
	});

	it('preserves literal keys, value types, arguments, and middleware context', async () => {
		const inputs = {
			port: flag.number().default(3000),
			region: flag.enum(['us', 'eu']).required(),
		};
		const app = cli('app').default(
			command('serve')
				.flag('verbose', flag.boolean())
				.arg('file', arg.string())
				.middleware(middleware<{ user: string }>(async ({ next }) => next({ user: 'kaj' })))
				.flags(inputs)
				.flag('host', flag.string())
				.action(({ flags, args, ctx, out }) => {
					expectTypeOf(flags.port).toEqualTypeOf<number>();
					expectTypeOf(flags.region).toEqualTypeOf<'us' | 'eu'>();
					expectTypeOf(flags.host).toEqualTypeOf<string | undefined>();
					expectTypeOf(flags.verbose).toEqualTypeOf<boolean>();
					expectTypeOf(args.file).toEqualTypeOf<string>();
					expectTypeOf(ctx.user).toEqualTypeOf<string>();
					out.json({ flags, args, user: ctx.user });
				}),
		);
		const result = await app.execute(['config', '--region', 'eu', '--verbose']);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.join(''))).toEqual({
			flags: { port: 3000, region: 'eu', verbose: true },
			args: { file: 'config' },
			user: 'kaj',
		});
	});

	it('derives environment names and preserves the original builder', async () => {
		const original = command('serve')
			.description('Serve')
			.action(() => {});
		const next = original.flags({ apiToken: flag.string().env() });
		expect(original.schema.flags).toEqual({});
		expect(original.handler).toBeDefined();
		expect(next.handler).toBeUndefined();
		expect(next.schema.hasAction).toBe(false);
		expect(next.schema.description).toBe('Serve');
		const result = await cli('app')
			.default(next.action(({ flags, out }) => out.log(flags.apiToken ?? 'missing')))
			.execute([], { env: { API_TOKEN: 'token' } });
		expect(result.stdout).toEqual(['token\n']);
	});

	it('rejects names already registered by either method', () => {
		const existing = command('serve').flag('port', flag.number());
		// @ts-expect-error A bulk declaration cannot replace an existing flag.
		expect(() => existing.flags({ port: flag.string() })).toThrow(/already defines flag/);
		const bulk = command('serve').flags({ port: flag.number() });
		// @ts-expect-error A single declaration cannot replace a bulk flag.
		expect(() => bulk.flag('port', flag.string())).toThrow(/already defines flag/);
		// @ts-expect-error Two bulk declarations cannot share a name.
		expect(() => bulk.flags({ port: flag.string() })).toThrow(/already defines flag/);
	});

	it('checks alias and propagated collisions across the whole record', () => {
		expect(() =>
			command('run').flags({ first: flag.string().alias('f'), second: flag.string().alias('f') }),
		).toThrow(/collides/);
		expect(() =>
			command('run')
				.flag('force', flag.boolean())
				.flags({ first: flag.string().alias('force') }),
		).toThrow(/collides/);
		expect(() =>
			command('run')
				.command(command('child').flag('force', flag.boolean().alias('f')))
				.flags({ file: flag.string().alias('f').propagate() }),
		).toThrow(/collides/);
	});

	it('checks exclusive stdin consumers within and before the record', () => {
		expect(() =>
			command('run').flags({ first: flag.string().stdin(), second: flag.string().stdin() }),
		).toThrow(/stdin/);
		expect(() =>
			command('run').arg('input', arg.string().stdin()).flags({ second: flag.string().stdin() }),
		).toThrow(/stdin/);
	});

	it('rejects replaced prototypes and unsafe own names', () => {
		expect(() => command('run').flags({ __proto__: flag.string() })).toThrow(/prototype/);
		expect(() => command('run').flags({ ['__proto__']: flag.string() })).toThrow(/not usable/);
	});

	it('accepts prototype member names and null-prototype records', () => {
		const record = { constructor: flag.string(), toString: flag.boolean() };
		Object.setPrototypeOf(record, null);
		const cmd = command('run').flags(record);
		expect(Object.keys(cmd.schema.flags)).toEqual(['constructor', 'toString']);
	});
});
