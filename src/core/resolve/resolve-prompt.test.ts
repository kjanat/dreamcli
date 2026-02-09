/**
 * Tests for prompt resolution in the resolve chain.
 *
 * Validates: CLI → env → config → **prompt** → default ordering,
 * prompt cancellation fallthrough, coercion of prompt values,
 * non-interactive mode (no prompter), and error handling.
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import type { ParseResult } from '../parse/index.js';
import { createTestPrompter, PROMPT_CANCEL } from '../prompt/index.js';
import type { CommandSchema } from '../schema/index.js';
import { createSchema } from '../schema/index.js';
import type { ResolveOptions } from './index.js';
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
// Prompt resolution — basic
// ========================================================================

describe('resolve — prompt resolution', () => {
	it('resolves flag from prompt when no CLI/env/config value', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu', 'ap'],
					prompt: { kind: 'select', message: 'Select region' },
					presence: 'required',
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter(['eu']);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('resolves confirm prompt as boolean', async () => {
		const schema = makeSchema({
			flags: {
				force: createSchema('boolean', {
					prompt: { kind: 'confirm', message: 'Force deploy?' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([true]);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ force: true });
	});

	it('resolves input prompt as string', async () => {
		const schema = makeSchema({
			flags: {
				name: createSchema('string', {
					prompt: { kind: 'input', message: 'Enter name' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter(['Alice']);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ name: 'Alice' });
	});

	it('resolves multiselect prompt as array', async () => {
		const schema = makeSchema({
			flags: {
				tags: createSchema('array', {
					prompt: {
						kind: 'multiselect',
						message: 'Select tags',
						choices: [{ value: 'v1' }, { value: 'v2' }, { value: 'v3' }],
					},
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([['v1', 'v3']]);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ tags: ['v1', 'v3'] });
	});

	it('coerces input prompt value to number for number flags', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', {
					prompt: { kind: 'input', message: 'Enter port' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter(['8080']);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ port: 8080 });
	});
});

// ========================================================================
// Prompt resolution — precedence
// ========================================================================

describe('resolve — prompt precedence', () => {
	it('CLI value takes priority over prompt', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed({ flags: { region: 'us' } });
		// Prompter should NOT be called
		const prompter = createTestPrompter([]);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('env value takes priority over prompt', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					envVar: 'REGION',
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([]);

		const result = await resolve(schema, parsed, {
			env: { REGION: 'eu' },
			prompter,
		});
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('config value takes priority over prompt', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					configPath: 'deploy.region',
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([]);

		const result = await resolve(schema, parsed, {
			config: { deploy: { region: 'us' } },
			prompter,
		});
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('prompt takes priority over default', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					defaultValue: 'us',
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter(['eu']);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ region: 'eu' });
	});

	it('full chain: CLI > env > config > prompt > default', async () => {
		const schema = makeSchema({
			flags: {
				a: createSchema('string', {
					prompt: { kind: 'input', message: 'Enter A' },
					defaultValue: 'def-a',
				}),
				b: createSchema('string', {
					envVar: 'B',
					prompt: { kind: 'input', message: 'Enter B' },
					defaultValue: 'def-b',
				}),
				c: createSchema('string', {
					configPath: 'c',
					prompt: { kind: 'input', message: 'Enter C' },
					defaultValue: 'def-c',
				}),
				d: createSchema('string', {
					prompt: { kind: 'input', message: 'Enter D' },
					defaultValue: 'def-d',
				}),
				e: createSchema('string', {
					defaultValue: 'def-e',
				}),
			},
		});
		const parsed = makeParsed({ flags: { a: 'cli-a' } });
		// Only d should be prompted (a=CLI, b=env, c=config, e=no prompt config)
		const prompter = createTestPrompter(['prompt-d']);

		const result = await resolve(schema, parsed, {
			env: { B: 'env-b' },
			config: { c: 'config-c' },
			prompter,
		});
		expect(result.flags).toEqual({
			a: 'cli-a',
			b: 'env-b',
			c: 'config-c',
			d: 'prompt-d',
			e: 'def-e',
		});
	});
});

// ========================================================================
// Prompt resolution — cancellation and fallthrough
// ========================================================================

describe('resolve — prompt cancellation', () => {
	it('falls through to default when prompt is cancelled', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					defaultValue: 'us',
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([PROMPT_CANCEL]);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('throws for required flag when prompt is cancelled and no default', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					presence: 'required',
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([PROMPT_CANCEL]);

		await expect(resolve(schema, parsed, { prompter })).rejects.toThrow(ValidationError);
	});

	it('optional flag resolves to undefined when prompt cancelled and no default', async () => {
		const schema = makeSchema({
			flags: {
				name: createSchema('string', {
					prompt: { kind: 'input', message: 'Enter name' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([PROMPT_CANCEL]);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ name: undefined });
	});
});

// ========================================================================
// Non-interactive mode — no prompter
// ========================================================================

describe('resolve — non-interactive (no prompter)', () => {
	it('skips prompt when no prompter provided', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					defaultValue: 'us',
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed();

		// No prompter — should fall through to default
		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ region: 'us' });
	});

	it('required flag with prompt but no prompter throws', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					presence: 'required',
					prompt: { kind: 'select', message: 'Select region' },
				}),
			},
		});
		const parsed = makeParsed();

		// No prompter, no default → required error
		await expect(resolve(schema, parsed)).rejects.toThrow(ValidationError);
	});

	it('prompter provided but flag has no prompt config — skips', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					defaultValue: 'us',
					// No prompt config
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([]);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ region: 'us' });
	});
});

// ========================================================================
// Prompt coercion errors
// ========================================================================

describe('resolve — prompt coercion errors', () => {
	it('throws for invalid number from prompt', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', {
					prompt: { kind: 'input', message: 'Enter port' },
					presence: 'required',
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter([{ invalid: true }]);

		await expect(resolve(schema, parsed, { prompter })).rejects.toThrow(ValidationError);
	});

	it('throws for invalid enum from prompt', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Select region' },
					presence: 'required',
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter(['invalid-region']);

		await expect(resolve(schema, parsed, { prompter })).rejects.toThrow(ValidationError);
	});
});

// ========================================================================
// Backward compatibility — existing tests should still pass
// ========================================================================

describe('resolve — backward compatibility', () => {
	it('works without options (sync-like behavior)', async () => {
		const schema = makeSchema({
			flags: {
				name: createSchema('string', { defaultValue: 'world' }),
			},
		});
		const parsed = makeParsed();

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ name: 'world' });
	});

	it('works with env/config but no prompter', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', { envVar: 'REGION' }),
			},
		});
		const parsed = makeParsed();
		const options: ResolveOptions = { env: { REGION: 'eu' } };

		const result = await resolve(schema, parsed, options);
		expect(result.flags).toEqual({ region: 'eu' });
	});
});

// ========================================================================
// Multiple flags with prompts
// ========================================================================

describe('resolve — multiple prompted flags', () => {
	it('prompts multiple flags in schema order', async () => {
		const schema = makeSchema({
			flags: {
				name: createSchema('string', {
					prompt: { kind: 'input', message: 'Name?' },
					presence: 'required',
				}),
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Region?' },
					presence: 'required',
				}),
				force: createSchema('boolean', {
					prompt: { kind: 'confirm', message: 'Force?' },
				}),
			},
		});
		const parsed = makeParsed();
		const prompter = createTestPrompter(['Alice', 'eu', true]);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({
			name: 'Alice',
			region: 'eu',
			force: true,
		});
	});

	it('only prompts flags that need it (some resolved from CLI)', async () => {
		const schema = makeSchema({
			flags: {
				name: createSchema('string', {
					prompt: { kind: 'input', message: 'Name?' },
					presence: 'required',
				}),
				region: createSchema('enum', {
					enumValues: ['us', 'eu'],
					prompt: { kind: 'select', message: 'Region?' },
					presence: 'required',
				}),
			},
		});
		const parsed = makeParsed({ flags: { name: 'Bob' } });
		// Only region should be prompted
		const prompter = createTestPrompter(['us']);

		const result = await resolve(schema, parsed, { prompter });
		expect(result.flags).toEqual({ name: 'Bob', region: 'us' });
	});
});
