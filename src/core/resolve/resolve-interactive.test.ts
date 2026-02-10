import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ValidationError } from '../errors/index.js';
import type { ParseResult } from '../parse/index.js';
import { createTestPrompter, PROMPT_CANCEL } from '../prompt/index.js';
import type { CommandSchema, InteractiveParams } from '../schema/command.js';
import { command } from '../schema/command.js';
import type { FlagBuilder, FlagConfig } from '../schema/flag.js';
import { createSchema, flag } from '../schema/flag.js';
import { resolve } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSchema(overrides?: Partial<CommandSchema>): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: true,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

function makeParsed(overrides?: Partial<ParseResult>): ParseResult {
	return {
		flags: {},
		args: {},
		...overrides,
	};
}

// ========================================================================
// CommandBuilder.interactive() — schema storage and chaining
// ========================================================================

describe('CommandBuilder.interactive()', () => {
	it('stores interactive resolver on schema', () => {
		const resolver = vi.fn(() => ({}));
		const cmd = command('test')
			.flag('region', flag.enum(['us', 'eu']))
			.interactive(resolver);

		expect(cmd.schema.interactive).toBeDefined();
	});

	it('returns a new builder (immutable)', () => {
		const original = command('test').flag('region', flag.enum(['us', 'eu']));
		const resolver = vi.fn(() => ({}));
		const withInteractive = original.interactive(resolver);

		expect(withInteractive).not.toBe(original);
		expect(original.schema.interactive).toBeUndefined();
		expect(withInteractive.schema.interactive).toBeDefined();
	});

	it('preserves existing handler', () => {
		const handler = vi.fn();
		const cmd = command('test')
			.flag('region', flag.enum(['us', 'eu']))
			.action(handler)
			.interactive(() => ({}));

		expect(cmd.handler).toBe(handler);
		expect(cmd.schema.hasAction).toBe(true);
	});

	it('preserves existing flags and args', () => {
		const cmd = command('test')
			.flag('region', flag.enum(['us', 'eu']))
			.flag('force', flag.boolean())
			.interactive(() => ({}));

		expect(Object.keys(cmd.schema.flags)).toEqual(['region', 'force']);
	});

	it('can be overwritten by chaining another .interactive()', () => {
		const resolver1 = vi.fn(() => ({}));
		const resolver2 = vi.fn(() => ({}));
		const cmd = command('test')
			.flag('region', flag.enum(['us', 'eu']))
			.interactive(resolver1)
			.interactive(resolver2);

		// The second resolver should be stored
		expect(cmd.schema.interactive).toBeDefined();
		expect(cmd.schema.interactive).not.toBe(resolver1 as unknown);
	});

	it('schema.interactive is undefined by default', () => {
		const cmd = command('test').flag('region', flag.enum(['us', 'eu']));
		expect(cmd.schema.interactive).toBeUndefined();
	});

	it('can chain .interactive() before .action()', () => {
		const cmd = command('test')
			.flag('region', flag.enum(['us', 'eu']))
			.interactive(() => ({}))
			.action(({ flags }) => {
				// Type inference still works
				flags.region;
			});

		expect(cmd.handler).toBeDefined();
		expect(cmd.schema.interactive).toBeDefined();
	});
});

// ========================================================================
// Resolution chain with interactive resolver
// ========================================================================

describe('resolve with interactive resolver', () => {
	it('interactive resolver prompt config overrides per-flag prompt', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu', 'ap'],
					prompt: { kind: 'select', message: 'Per-flag message' },
				}),
			},
			interactive: ({ flags }) => ({
				region: !flags.region && {
					kind: 'select' as const,
					message: 'Interactive message',
				},
			}),
		});

		const prompter = createTestPrompter(['eu']);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.region).toBe('eu');
	});

	it('interactive resolver receives partially resolved flags', async () => {
		const receivedFlags: Record<string, unknown>[] = [];

		const schema = makeSchema({
			flags: {
				region: createSchema('enum', { enumValues: ['us', 'eu'] }),
				force: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
			},
			interactive: ({ flags }) => {
				receivedFlags.push({ ...flags });
				return {
					region: {
						kind: 'select' as const,
						message: 'Select region',
					},
				};
			},
		});

		const prompter = createTestPrompter(['eu']);
		await resolve(schema, makeParsed({ flags: { force: true } }), { prompter });

		expect(receivedFlags).toHaveLength(1);
		// force was provided via CLI, region was not
		expect(receivedFlags[0]).toEqual({ force: true });
	});

	it('interactive resolver sees env-resolved values', async () => {
		const receivedFlags: Record<string, unknown>[] = [];

		const schema = makeSchema({
			flags: {
				region: createSchema('enum', { enumValues: ['us', 'eu'], envVar: 'REGION' }),
				name: createSchema('string'),
			},
			interactive: ({ flags }) => {
				receivedFlags.push({ ...flags });
				return {
					name: { kind: 'input' as const, message: 'Enter name' },
				};
			},
		});

		const prompter = createTestPrompter(['Alice']);
		await resolve(schema, makeParsed(), {
			env: { REGION: 'eu' },
			prompter,
		});

		expect(receivedFlags[0]).toEqual({ region: 'eu' });
	});

	it('interactive resolver sees config-resolved values', async () => {
		const receivedFlags: Record<string, unknown>[] = [];

		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					configPath: 'deploy.region',
				}),
				name: createSchema('string'),
			},
			interactive: ({ flags }) => {
				receivedFlags.push({ ...flags });
				return {
					name: { kind: 'input' as const, message: 'Enter name' },
				};
			},
		});

		const prompter = createTestPrompter(['Alice']);
		await resolve(schema, makeParsed(), {
			config: { deploy: { region: 'us' } },
			prompter,
		});

		expect(receivedFlags[0]).toEqual({ region: 'us' });
	});

	it('falsy return from interactive skips prompting for that flag', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Per-flag prompt' },
				}),
			},
			interactive: () => ({
				region: false, // explicitly suppress prompting
			}),
		});

		const prompter = createTestPrompter([]); // no answers expected
		const result = await resolve(schema, makeParsed(), { prompter });

		// Should fall through to undefined (optional flag, no default)
		expect(result.flags.region).toBeUndefined();
	});

	it('undefined return from interactive falls back to per-flag prompt', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Per-flag prompt' },
				}),
			},
			interactive: () => ({
				// region not mentioned — falls back to per-flag config
			}),
		});

		const prompter = createTestPrompter(['us']);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.region).toBe('us');
	});

	it('null return from interactive falls back to per-flag prompt', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Per-flag prompt' },
				}),
			},
			interactive: () => ({
				region: null,
			}),
		});

		const prompter = createTestPrompter(['eu']);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.region).toBe('eu');
	});

	it('CLI value prevents both interactive and per-flag prompts', async () => {
		const interactiveFn = vi.fn(() => ({
			region: { kind: 'select' as const, message: 'Should not see this' },
		}));

		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Per-flag' },
				}),
			},
			interactive: interactiveFn,
		});

		const prompter = createTestPrompter([]); // no answers expected
		const result = await resolve(schema, makeParsed({ flags: { region: 'us' } }), { prompter });

		expect(result.flags.region).toBe('us');
		// Interactive resolver IS called (it receives partial state),
		// but the flag is already resolved so the returned config is ignored
		expect(interactiveFn).toHaveBeenCalled();
	});

	it('multiple flags: some from interactive, some from per-flag, some from CLI', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', { enumValues: ['us', 'eu'] }),
				name: createSchema('string', {
					prompt: { kind: 'input', message: 'Per-flag name prompt' },
				}),
				force: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
			},
			interactive: ({ flags }) => ({
				region: !flags.region && {
					kind: 'select' as const,
					message: 'Interactive region prompt',
				},
				// name not mentioned — falls back to per-flag prompt
				// force already has a default, won't be prompted
			}),
		});

		// Prompter answers: first for region (interactive), second for name (per-flag)
		const prompter = createTestPrompter(['eu', 'Alice']);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.region).toBe('eu');
		expect(result.flags.name).toBe('Alice');
		expect(result.flags.force).toBe(false);
	});

	it('interactive prompt cancelled falls through to default', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					defaultValue: 'us',
				}),
			},
			interactive: () => ({
				region: { kind: 'select' as const, message: 'Select region' },
			}),
		});

		const prompter = createTestPrompter([PROMPT_CANCEL]);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.region).toBe('us');
	});

	it('interactive prompt cancelled on required flag throws', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					presence: 'required',
				}),
			},
			interactive: () => ({
				region: { kind: 'select' as const, message: 'Select region' },
			}),
		});

		const prompter = createTestPrompter([PROMPT_CANCEL]);
		await expect(resolve(schema, makeParsed(), { prompter })).rejects.toThrow(ValidationError);
	});

	it('no prompter → interactive resolver still called but prompts skipped', async () => {
		const interactiveFn = vi.fn(() => ({
			region: { kind: 'select' as const, message: 'Select region' },
		}));

		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					defaultValue: 'us',
				}),
			},
			interactive: interactiveFn,
		});

		// No prompter provided
		const result = await resolve(schema, makeParsed());

		expect(interactiveFn).toHaveBeenCalled();
		// Falls through to default since no prompter
		expect(result.flags.region).toBe('us');
	});

	it('interactive resolver for confirm prompt', async () => {
		const schema = makeSchema({
			flags: {
				proceed: createSchema('boolean', { presence: 'defaulted', defaultValue: false }),
			},
			interactive: () => ({
				proceed: { kind: 'confirm' as const, message: 'Continue?' },
			}),
		});

		const prompter = createTestPrompter([true]);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.proceed).toBe(true);
	});

	it('interactive resolver for input prompt with number coercion', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number'),
			},
			interactive: () => ({
				port: { kind: 'input' as const, message: 'Port number' },
			}),
		});

		const prompter = createTestPrompter(['8080']);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.port).toBe(8080);
	});

	it('interactive resolver for multiselect prompt', async () => {
		const schema = makeSchema({
			flags: {
				features: createSchema('array', {
					elementSchema: createSchema('string'),
				}),
			},
			interactive: () => ({
				features: {
					kind: 'multiselect' as const,
					message: 'Select features',
					choices: [{ value: 'auth' }, { value: 'db' }, { value: 'cache' }],
				},
			}),
		});

		const prompter = createTestPrompter([['auth', 'cache']]);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.features).toEqual(['auth', 'cache']);
	});

	it('without interactive resolver, per-flag prompts work normally', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
			// No interactive resolver
		});

		const prompter = createTestPrompter(['us']);
		const result = await resolve(schema, makeParsed(), { prompter });

		expect(result.flags.region).toBe('us');
	});

	it('env error prevents prompting for that flag', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT' }),
			},
			interactive: () => ({
				port: { kind: 'input' as const, message: 'Port?' },
			}),
		});

		const prompter = createTestPrompter(['8080']); // Should not be consumed
		await expect(
			resolve(schema, makeParsed(), {
				env: { PORT: 'not-a-number' },
				prompter,
			}),
		).rejects.toThrow(ValidationError);
	});

	it('full chain: CLI > env > config > interactive > per-flag > default', async () => {
		const schema = makeSchema({
			flags: {
				a: createSchema('string'), // CLI
				b: createSchema('string', { envVar: 'B_VAR' }), // env
				c: createSchema('string', { configPath: 'c.val' }), // config
				d: createSchema('string'), // interactive
				e: createSchema('string', {
					prompt: { kind: 'input', message: 'Per-flag E' },
				}), // per-flag prompt
				f: createSchema('string', { defaultValue: 'default-f' }), // default
			},
			interactive: ({ flags }) => ({
				d: !flags.d && { kind: 'input' as const, message: 'Interactive D' },
				// e not mentioned — falls back to per-flag
			}),
		});

		const prompter = createTestPrompter(['interactive-d', 'per-flag-e']);
		const result = await resolve(schema, makeParsed({ flags: { a: 'cli-a' } }), {
			env: { B_VAR: 'env-b' },
			config: { c: { val: 'config-c' } },
			prompter,
		});

		expect(result.flags.a).toBe('cli-a');
		expect(result.flags.b).toBe('env-b');
		expect(result.flags.c).toBe('config-c');
		expect(result.flags.d).toBe('interactive-d');
		expect(result.flags.e).toBe('per-flag-e');
		expect(result.flags.f).toBe('default-f');
	});
});

// ========================================================================
// Type inference
// ========================================================================

describe('InteractiveResolver type inference', () => {
	it('resolver receives typed partial flags', () => {
		const cmd = command('test')
			.flag('region', flag.enum(['us', 'eu', 'ap']))
			.flag('force', flag.boolean())
			.flag('count', flag.number().required());

		// Build a typed interactive resolver
		type Flags = typeof cmd extends { _flags: infer F } ? F : never;

		// The params type should have partial flags
		expectTypeOf<
			InteractiveParams<Flags & Record<string, FlagBuilder<FlagConfig>>>
		>().toHaveProperty('flags');
	});

	it('.interactive() preserves command type', () => {
		const cmd = command('test')
			.flag('region', flag.enum(['us', 'eu', 'ap']))
			.interactive(({ flags }) => ({
				region: !flags.region && { kind: 'select' as const, message: 'Select' },
			}))
			.action(({ flags }) => {
				// Type check: region is 'us' | 'eu' | 'ap' | undefined
				expectTypeOf(flags.region).toEqualTypeOf<'us' | 'eu' | 'ap' | undefined>();
			});

		expect(cmd.schema.interactive).toBeDefined();
	});
});

// ========================================================================
// Integration through CommandBuilder
// ========================================================================

describe('CommandBuilder interactive integration', () => {
	it('interactive resolver runs through command.schema in resolve()', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu', 'ap']))
			.flag('force', flag.boolean())
			.interactive(({ flags }) => ({
				region: !flags.region && {
					kind: 'select' as const,
					message: 'Select deployment region',
				},
			}))
			.action(({ flags, out }) => {
				out.log(`Deploying to ${flags.region} (force: ${flags.force})`);
			});

		const prompter = createTestPrompter(['ap']);
		const result = await resolve(cmd.schema, makeParsed(), { prompter });

		expect(result.flags.region).toBe('ap');
		expect(result.flags.force).toBe(false); // boolean default
	});

	it('matches PRD API pattern', async () => {
		// This test mirrors the PRD example as closely as possible
		const deploy = command('deploy')
			.description('Deploy to an environment')
			.flag('region', flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION').config('deploy.region'))
			.flag('force', flag.boolean().alias('f').default(false))
			.interactive(({ flags }) => ({
				region: !flags.region && {
					kind: 'select' as const,
					message: 'Select region',
				},
			}))
			.action(async ({ flags, out }) => {
				out.log(`Deploying to ${flags.region} (force: ${flags.force})`);
			});

		// Interactive scenario: no CLI/env/config → prompt fires
		const prompter1 = createTestPrompter(['eu']);
		const r1 = await resolve(deploy.schema, makeParsed(), { prompter: prompter1 });
		expect(r1.flags.region).toBe('eu');

		// Env resolves before interactive → no prompt
		const prompter2 = createTestPrompter([]); // should not be consumed
		const r2 = await resolve(deploy.schema, makeParsed(), {
			env: { DEPLOY_REGION: 'us' },
			prompter: prompter2,
		});
		expect(r2.flags.region).toBe('us');

		// Config resolves before interactive → no prompt
		const prompter3 = createTestPrompter([]); // should not be consumed
		const r3 = await resolve(deploy.schema, makeParsed(), {
			config: { deploy: { region: 'ap' } },
			prompter: prompter3,
		});
		expect(r3.flags.region).toBe('ap');

		// CLI resolves before everything → no prompt
		const prompter4 = createTestPrompter([]); // should not be consumed
		const r4 = await resolve(deploy.schema, makeParsed({ flags: { region: 'eu' } }), {
			prompter: prompter4,
		});
		expect(r4.flags.region).toBe('eu');
	});
});
