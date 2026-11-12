/** Bulk flag registration and inferred action values. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { arg } from './arg.ts';
import { command } from './command.ts';
import { flag } from './flag.ts';
import { middleware } from './middleware.ts';

describe('CommandBuilder.flags()', () => {
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
