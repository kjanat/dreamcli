import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { arg } from './arg.js';
import type { ActionParams, CommandArgEntry, CommandSchema, Out } from './command.js';
import { CommandBuilder, command } from './command.js';
import { flag } from './flag.js';

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe('command()', () => {
	it('creates a command builder with the given name', () => {
		const cmd = command('deploy');
		expect(cmd).toBeInstanceOf(CommandBuilder);
		expect(cmd.schema.name).toBe('deploy');
	});

	it('starts with empty defaults', () => {
		const cmd = command('test');
		expect(cmd.schema.description).toBeUndefined();
		expect(cmd.schema.aliases).toEqual([]);
		expect(cmd.schema.hidden).toBe(false);
		expect(cmd.schema.examples).toEqual([]);
		expect(cmd.schema.flags).toEqual({});
		expect(cmd.schema.args).toEqual([]);
		expect(cmd.schema.hasAction).toBe(false);
		expect(cmd.handler).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Metadata modifiers
// ---------------------------------------------------------------------------

describe('.description()', () => {
	it('sets the description', () => {
		const cmd = command('deploy').description('Deploy the app');
		expect(cmd.schema.description).toBe('Deploy the app');
	});

	it('returns a new builder (immutability)', () => {
		const a = command('deploy');
		const b = a.description('Deploy');
		expect(a).not.toBe(b);
		expect(a.schema.description).toBeUndefined();
	});
});

describe('.alias()', () => {
	it('adds an alias', () => {
		const cmd = command('deploy').alias('d');
		expect(cmd.schema.aliases).toEqual(['d']);
	});

	it('accumulates multiple aliases', () => {
		const cmd = command('deploy').alias('d').alias('dep');
		expect(cmd.schema.aliases).toEqual(['d', 'dep']);
	});

	it('returns a new builder (immutability)', () => {
		const a = command('deploy');
		const b = a.alias('d');
		expect(a).not.toBe(b);
		expect(a.schema.aliases).toEqual([]);
	});
});

describe('.hidden()', () => {
	it('marks the command as hidden', () => {
		const cmd = command('internal').hidden();
		expect(cmd.schema.hidden).toBe(true);
	});

	it('returns a new builder (immutability)', () => {
		const a = command('internal');
		const b = a.hidden();
		expect(a).not.toBe(b);
		expect(a.schema.hidden).toBe(false);
	});
});

describe('.example()', () => {
	it('adds an example with command only', () => {
		const cmd = command('deploy').example('deploy production');
		expect(cmd.schema.examples).toEqual([{ command: 'deploy production' }]);
	});

	it('adds an example with description', () => {
		const cmd = command('deploy').example('deploy prod --force', 'Force deploy to prod');
		expect(cmd.schema.examples).toEqual([
			{ command: 'deploy prod --force', description: 'Force deploy to prod' },
		]);
	});

	it('accumulates multiple examples', () => {
		const cmd = command('deploy').example('deploy staging').example('deploy production --force');
		expect(cmd.schema.examples).toHaveLength(2);
	});

	it('returns a new builder (immutability)', () => {
		const a = command('deploy');
		const b = a.example('deploy staging');
		expect(a).not.toBe(b);
		expect(a.schema.examples).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Flag accumulation — runtime
// ---------------------------------------------------------------------------

describe('.flag()', () => {
	it('adds a flag schema to the command', () => {
		const cmd = command('deploy').flag('force', flag.boolean());
		expect(cmd.schema.flags.force).toBeDefined();
		expect(cmd.schema.flags.force?.kind).toBe('boolean');
	});

	it('accumulates multiple flags', () => {
		const cmd = command('deploy')
			.flag('force', flag.boolean())
			.flag('region', flag.enum(['us', 'eu']))
			.flag('port', flag.number().default(8080));

		expect(Object.keys(cmd.schema.flags)).toEqual(['force', 'region', 'port']);
		expect(cmd.schema.flags.region?.kind).toBe('enum');
		expect(cmd.schema.flags.port?.defaultValue).toBe(8080);
	});

	it('preserves existing metadata when adding flags', () => {
		const cmd = command('deploy')
			.description('Deploy the app')
			.alias('d')
			.flag('force', flag.boolean());

		expect(cmd.schema.description).toBe('Deploy the app');
		expect(cmd.schema.aliases).toEqual(['d']);
	});

	it('returns a new builder (immutability)', () => {
		const a = command('deploy');
		const b = a.flag('force', flag.boolean());
		expect(a).not.toBe(b);
		expect(a.schema.flags).toEqual({});
	});

	it('drops previous handler when adding a flag (type safety)', () => {
		const handler = vi.fn();
		const a = command('deploy').action(handler);
		expect(a.handler).toBe(handler);

		const b = a.flag('force', flag.boolean());
		expect(b.handler).toBeUndefined();
		expect(b.schema.hasAction).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Arg accumulation — runtime
// ---------------------------------------------------------------------------

describe('.arg()', () => {
	it('adds an arg entry to the command', () => {
		const cmd = command('deploy').arg('target', arg.string());
		expect(cmd.schema.args).toHaveLength(1);
		expect(cmd.schema.args[0]?.name).toBe('target');
		expect(cmd.schema.args[0]?.schema.kind).toBe('string');
	});

	it('accumulates args in order', () => {
		const cmd = command('copy').arg('source', arg.string()).arg('dest', arg.string());

		expect(cmd.schema.args).toHaveLength(2);
		expect(cmd.schema.args[0]?.name).toBe('source');
		expect(cmd.schema.args[1]?.name).toBe('dest');
	});

	it('preserves existing metadata and flags', () => {
		const cmd = command('deploy')
			.description('Deploy the app')
			.flag('force', flag.boolean())
			.arg('target', arg.string());

		expect(cmd.schema.description).toBe('Deploy the app');
		expect(cmd.schema.flags.force).toBeDefined();
		expect(cmd.schema.args).toHaveLength(1);
	});

	it('returns a new builder (immutability)', () => {
		const a = command('deploy');
		const b = a.arg('target', arg.string());
		expect(a).not.toBe(b);
		expect(a.schema.args).toEqual([]);
	});

	it('drops previous handler when adding an arg (type safety)', () => {
		const handler = vi.fn();
		const a = command('deploy').action(handler);
		const b = a.arg('target', arg.string());
		expect(b.handler).toBeUndefined();
		expect(b.schema.hasAction).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Action handler — runtime
// ---------------------------------------------------------------------------

describe('.action()', () => {
	it('registers the handler', () => {
		const handler = vi.fn();
		const cmd = command('deploy').action(handler);
		expect(cmd.handler).toBe(handler);
		expect(cmd.schema.hasAction).toBe(true);
	});

	it('returns a new builder (immutability)', () => {
		const handler = vi.fn();
		const a = command('deploy');
		const b = a.action(handler);
		expect(a).not.toBe(b);
		expect(a.handler).toBeUndefined();
		expect(a.schema.hasAction).toBe(false);
	});

	it('replaces a previous handler', () => {
		const h1 = vi.fn();
		const h2 = vi.fn();
		const cmd = command('deploy').action(h1).action(h2);
		expect(cmd.handler).toBe(h2);
	});
});

// ---------------------------------------------------------------------------
// Full composition — runtime
// ---------------------------------------------------------------------------

describe('full command composition', () => {
	it('builds a complete command schema', () => {
		const cmd = command('deploy')
			.description('Deploy to an environment')
			.alias('d')
			.example('deploy production', 'Deploy to prod')
			.arg('target', arg.string().describe('Deploy target'))
			.flag('force', flag.boolean().alias('f'))
			.flag('region', flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION'))
			.flag('timeout', flag.number().default(30))
			.action(({ args, flags, out }) => {
				out.log(`${args.target} → ${flags.region}`);
			});

		expect(cmd.schema.name).toBe('deploy');
		expect(cmd.schema.description).toBe('Deploy to an environment');
		expect(cmd.schema.aliases).toEqual(['d']);
		expect(cmd.schema.examples).toHaveLength(1);
		expect(cmd.schema.hidden).toBe(false);
		expect(cmd.schema.hasAction).toBe(true);

		// Flags
		expect(Object.keys(cmd.schema.flags)).toEqual(['force', 'region', 'timeout']);
		expect(cmd.schema.flags.force?.kind).toBe('boolean');
		expect(cmd.schema.flags.region?.enumValues).toEqual(['us', 'eu', 'ap']);
		expect(cmd.schema.flags.timeout?.defaultValue).toBe(30);

		// Args
		expect(cmd.schema.args).toHaveLength(1);
		expect(cmd.schema.args[0]?.name).toBe('target');
		expect(cmd.schema.args[0]?.schema.kind).toBe('string');
	});

	it('handler receives correct params shape', async () => {
		const handler = vi.fn();

		const cmd = command('greet')
			.arg('name', arg.string())
			.flag('loud', flag.boolean())
			.action(handler);

		const mockOut: Out = {
			log: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			json: vi.fn(),
			table: vi.fn(),
			jsonMode: false,
		};

		// Simulate what the runtime will do
		const params: ActionParams<
			{ loud: ReturnType<typeof flag.boolean> },
			{ name: ReturnType<typeof arg.string> }
		> = {
			args: { name: 'world' },
			flags: { loud: true },
			ctx: {},
			out: mockOut,
		};

		await cmd.handler?.(params);
		expect(handler).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledWith(params);
	});
});

// ---------------------------------------------------------------------------
// Chaining order independence
// ---------------------------------------------------------------------------

describe('chaining order', () => {
	it('metadata before flags/args', () => {
		const cmd = command('deploy')
			.description('Deploy')
			.alias('d')
			.hidden()
			.flag('force', flag.boolean())
			.arg('target', arg.string())
			.action(() => {});

		expect(cmd.schema.description).toBe('Deploy');
		expect(cmd.schema.aliases).toEqual(['d']);
		expect(cmd.schema.hidden).toBe(true);
		expect(cmd.schema.hasAction).toBe(true);
	});

	it('flags before metadata', () => {
		const cmd = command('deploy').flag('force', flag.boolean()).description('Deploy').alias('d');

		expect(cmd.schema.description).toBe('Deploy');
		expect(cmd.schema.flags.force).toBeDefined();
	});

	it('args before flags', () => {
		const cmd = command('deploy').arg('target', arg.string()).flag('force', flag.boolean());

		expect(cmd.schema.args).toHaveLength(1);
		expect(cmd.schema.flags.force).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Type inference — compile-time checks via expectTypeOf
// ---------------------------------------------------------------------------

describe('type inference', () => {
	it('infers empty flags and args for bare command', () => {
		const cmd = command('test').action(({ args, flags }) => {
			// biome-ignore lint/complexity/noBannedTypes: testing that empty accumulator yields {}
			type Empty = {};
			expectTypeOf(args).toEqualTypeOf<Readonly<Empty>>();
			expectTypeOf(flags).toEqualTypeOf<Readonly<Empty>>();
		});

		// Confirm hasAction
		expect(cmd.schema.hasAction).toBe(true);
	});

	it('infers string flag as string | undefined', () => {
		command('test')
			.flag('name', flag.string())
			.action(({ flags }) => {
				expectTypeOf(flags.name).toEqualTypeOf<string | undefined>();
			});
	});

	it('infers required string flag as string', () => {
		command('test')
			.flag('name', flag.string().required())
			.action(({ flags }) => {
				expectTypeOf(flags.name).toEqualTypeOf<string>();
			});
	});

	it('infers defaulted number flag as number', () => {
		command('test')
			.flag('port', flag.number().default(8080))
			.action(({ flags }) => {
				expectTypeOf(flags.port).toEqualTypeOf<number>();
			});
	});

	it('infers boolean flag as boolean (always defaulted)', () => {
		command('test')
			.flag('force', flag.boolean())
			.action(({ flags }) => {
				expectTypeOf(flags.force).toEqualTypeOf<boolean>();
			});
	});

	it('infers enum flag as literal union | undefined', () => {
		command('test')
			.flag('region', flag.enum(['us', 'eu', 'ap']))
			.action(({ flags }) => {
				expectTypeOf(flags.region).toEqualTypeOf<'us' | 'eu' | 'ap' | undefined>();
			});
	});

	it('infers required enum flag as literal union', () => {
		command('test')
			.flag('region', flag.enum(['us', 'eu']).required())
			.action(({ flags }) => {
				expectTypeOf(flags.region).toEqualTypeOf<'us' | 'eu'>();
			});
	});

	it('infers array flag as element[] | undefined', () => {
		command('test')
			.flag('tags', flag.array(flag.string()))
			.action(({ flags }) => {
				expectTypeOf(flags.tags).toEqualTypeOf<string[] | undefined>();
			});
	});

	it('infers required string arg as string', () => {
		command('test')
			.arg('target', arg.string())
			.action(({ args }) => {
				expectTypeOf(args.target).toEqualTypeOf<string>();
			});
	});

	it('infers optional arg as string | undefined', () => {
		command('test')
			.arg('target', arg.string().optional())
			.action(({ args }) => {
				expectTypeOf(args.target).toEqualTypeOf<string | undefined>();
			});
	});

	it('infers variadic arg as string[]', () => {
		command('test')
			.arg('files', arg.string().variadic())
			.action(({ args }) => {
				expectTypeOf(args.files).toEqualTypeOf<string[]>();
			});
	});

	it('infers number arg', () => {
		command('test')
			.arg('count', arg.number())
			.action(({ args }) => {
				expectTypeOf(args.count).toEqualTypeOf<number>();
			});
	});

	it('infers custom arg type', () => {
		command('test')
			.arg(
				'hex',
				arg.custom((raw) => Number.parseInt(raw, 16)),
			)
			.action(({ args }) => {
				expectTypeOf(args.hex).toEqualTypeOf<number>();
			});
	});

	it('infers mixed flags and args together', () => {
		command('deploy')
			.arg('target', arg.string())
			.arg('env', arg.string().optional())
			.flag('force', flag.boolean())
			.flag('region', flag.enum(['us', 'eu']).required())
			.flag('timeout', flag.number().default(30))
			.flag('tags', flag.array(flag.string()))
			.action(({ args, flags }) => {
				expectTypeOf(args.target).toEqualTypeOf<string>();
				expectTypeOf(args.env).toEqualTypeOf<string | undefined>();
				expectTypeOf(flags.force).toEqualTypeOf<boolean>();
				expectTypeOf(flags.region).toEqualTypeOf<'us' | 'eu'>();
				expectTypeOf(flags.timeout).toEqualTypeOf<number>();
				expectTypeOf(flags.tags).toEqualTypeOf<string[] | undefined>();
			});
	});

	it('ctx is Record<string, never> (empty until middleware)', () => {
		command('test').action(({ ctx }) => {
			expectTypeOf(ctx).toEqualTypeOf<Readonly<Record<string, never>>>();
		});
	});

	it('ctx property access yields never without middleware', () => {
		command('test').action(({ ctx }) => {
			// Accessing any property on Readonly<Record<string, never>> yields never —
			// a type error at usage sites until middleware widens the type.
			type CtxValue = (typeof ctx)[string];
			expectTypeOf<CtxValue>().toBeNever();
		});
	});

	it('third type parameter C defaults to Record<string, never>', () => {
		// CommandBuilder with no middleware has C = Record<string, never>
		const cmd = command('test');
		expectTypeOf(cmd).toMatchTypeOf<CommandBuilder>();
		expectTypeOf(cmd._ctx).toEqualTypeOf<Record<string, never>>();
	});

	it('ActionParams C parameter types ctx correctly', () => {
		// Verify ActionParams with explicit C types ctx
		type TestParams = ActionParams<
			{ name: ReturnType<typeof flag.string> },
			// biome-ignore lint/complexity/noBannedTypes: test needs empty args
			{},
			{ user: string }
		>;
		expectTypeOf<TestParams['ctx']>().toEqualTypeOf<Readonly<{ user: string }>>();
	});

	it('ActionParams default C makes ctx Record<string, never>', () => {
		// Without explicit C, ctx is Readonly<Record<string, never>>
		type DefaultParams = ActionParams<
			{ name: ReturnType<typeof flag.string> },
			// biome-ignore lint/complexity/noBannedTypes: test needs empty args
			{}
		>;
		expectTypeOf<DefaultParams['ctx']>().toEqualTypeOf<Readonly<Record<string, never>>>();
	});

	it('out has log/info/warn/error methods', () => {
		command('test').action(({ out }) => {
			expectTypeOf(out.log).toEqualTypeOf<(message: string) => void>();
			expectTypeOf(out.info).toEqualTypeOf<(message: string) => void>();
			expectTypeOf(out.warn).toEqualTypeOf<(message: string) => void>();
			expectTypeOf(out.error).toEqualTypeOf<(message: string) => void>();
		});
	});

	it('handler can be async', () => {
		const cmd = command('test').action(async ({ out }) => {
			out.log('async');
		});

		expectTypeOf(cmd.handler).not.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// CommandSchema shape
// ---------------------------------------------------------------------------

describe('CommandSchema', () => {
	it('satisfies the CommandSchema interface', () => {
		const cmd = command('deploy')
			.description('Deploy')
			.alias('d')
			.example('deploy prod')
			.flag('force', flag.boolean())
			.arg('target', arg.string());

		const schema: CommandSchema = cmd.schema;
		expectTypeOf(schema.name).toBeString();
		expectTypeOf(schema.description).toEqualTypeOf<string | undefined>();
		expectTypeOf(schema.aliases).toEqualTypeOf<readonly string[]>();
		expectTypeOf(schema.hidden).toBeBoolean();
		expectTypeOf(schema.examples).toMatchTypeOf<readonly { command: string }[]>();
		expectTypeOf(schema.flags).toMatchTypeOf<Record<string, unknown>>();
		expectTypeOf(schema.args).toMatchTypeOf<readonly CommandArgEntry[]>();
		expectTypeOf(schema.hasAction).toBeBoolean();
	});
});
