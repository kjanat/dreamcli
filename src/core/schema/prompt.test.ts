import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
	ConfirmPromptConfig,
	FlagSchema,
	InferFlag,
	InputPromptConfig,
	MultiselectPromptConfig,
	PromptConfig,
	PromptKind,
	PromptResult,
	SelectChoice,
	SelectPromptConfig,
} from './flag.ts';
import { flag } from './flag.ts';

// ---------------------------------------------------------------------------
// PromptConfig discriminated union — type-level tests
// ---------------------------------------------------------------------------

describe('PromptConfig types', () => {
	it('PromptKind covers all four kinds', () => {
		expectTypeOf<PromptKind>().toEqualTypeOf<'confirm' | 'input' | 'select' | 'multiselect'>();
	});

	it('PromptConfig discriminates on kind', () => {
		function narrowPrompt(config: PromptConfig) {
			if (config.kind === 'confirm') {
				expectTypeOf(config).toEqualTypeOf<ConfirmPromptConfig>();
			}
			if (config.kind === 'input') {
				expectTypeOf(config).toEqualTypeOf<InputPromptConfig>();
			}
			if (config.kind === 'select') {
				expectTypeOf(config).toEqualTypeOf<SelectPromptConfig>();
			}
			if (config.kind === 'multiselect') {
				expectTypeOf(config).toEqualTypeOf<MultiselectPromptConfig>();
			}
		}
		narrowPrompt({ kind: 'confirm', message: 'Continue?' });
	});

	it('ConfirmPromptConfig has message and kind only', () => {
		const config: ConfirmPromptConfig = { kind: 'confirm', message: 'Sure?' };
		expect(config.kind).toBe('confirm');
		expect(config.message).toBe('Sure?');
	});

	it('InputPromptConfig has optional placeholder and validate', () => {
		const config: InputPromptConfig = {
			kind: 'input',
			message: 'Enter name',
			placeholder: 'e.g. my-project',
			validate: (v) => (v.length > 0 ? true : 'Required'),
		};
		expect(config.kind).toBe('input');
		expect(config.placeholder).toBe('e.g. my-project');
		expect(config.validate?.('hello')).toBe(true);
		expect(config.validate?.('')).toBe('Required');
	});

	it('InputPromptConfig works without optional fields', () => {
		const config: InputPromptConfig = { kind: 'input', message: 'Enter value' };
		expect(config.placeholder).toBeUndefined();
		expect(config.validate).toBeUndefined();
	});

	it('SelectPromptConfig has optional choices', () => {
		const choices: readonly SelectChoice[] = [
			{ value: 'us', label: 'United States' },
			{ value: 'eu', label: 'Europe', description: 'EU region' },
		];
		const config: SelectPromptConfig = {
			kind: 'select',
			message: 'Pick region',
			choices,
		};
		expect(config.choices).toHaveLength(2);
		expect(config.choices?.[0]?.value).toBe('us');
		expect(config.choices?.[1]?.description).toBe('EU region');
	});

	it('SelectChoice defaults label to value when label omitted', () => {
		const choice: SelectChoice = { value: 'ap' };
		expect(choice.value).toBe('ap');
		expect(choice.label).toBeUndefined();
	});

	it('MultiselectPromptConfig has optional min/max', () => {
		const config: MultiselectPromptConfig = {
			kind: 'multiselect',
			message: 'Select tags',
			choices: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
			min: 1,
			max: 2,
		};
		expect(config.min).toBe(1);
		expect(config.max).toBe(2);
		expect(config.choices).toHaveLength(3);
	});

	it('MultiselectPromptConfig works without optional fields', () => {
		const config: MultiselectPromptConfig = {
			kind: 'multiselect',
			message: 'Select items',
		};
		expect(config.choices).toBeUndefined();
		expect(config.min).toBeUndefined();
		expect(config.max).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// PromptResult — type-level tests
// ---------------------------------------------------------------------------

describe('PromptResult types', () => {
	it('discriminates on answered field', () => {
		const answered: PromptResult = { answered: true, value: 'hello' };
		const cancelled: PromptResult = { answered: false };

		if (answered.answered) {
			expectTypeOf(answered.value).toEqualTypeOf<unknown>();
		}
		expect(answered.answered).toBe(true);
		expect(cancelled.answered).toBe(false);
	});

	it('answered: true requires value', () => {
		const result: PromptResult = { answered: true, value: 42 };
		if (result.answered) {
			expect(result.value).toBe(42);
		}
	});

	it('answered: false has no value', () => {
		const result: PromptResult = { answered: false };
		expect(result.answered).toBe(false);
		if (!result.answered) {
			// @ts-expect-error — 'value' does not exist on cancelled result
			void result.value;
		}
	});
});

// ---------------------------------------------------------------------------
// FlagSchema.prompt field
// ---------------------------------------------------------------------------

describe('FlagSchema.prompt', () => {
	it('defaults to undefined in createSchema', () => {
		const f = flag.string();
		expect(f.schema.prompt).toBeUndefined();
	});

	it('exists on all flag kinds', () => {
		expect(flag.string().schema.prompt).toBeUndefined();
		expect(flag.number().schema.prompt).toBeUndefined();
		expect(flag.boolean().schema.prompt).toBeUndefined();
		expect(flag.enum(['a', 'b']).schema.prompt).toBeUndefined();
		expect(flag.array(flag.string()).schema.prompt).toBeUndefined();
	});

	it('is typed as PromptConfig | undefined on FlagSchema', () => {
		const schema: FlagSchema = flag.string().schema;
		expectTypeOf(schema.prompt).toEqualTypeOf<PromptConfig | undefined>();
	});
});

// ---------------------------------------------------------------------------
// FlagBuilder.prompt() method
// ---------------------------------------------------------------------------

describe('FlagBuilder.prompt()', () => {
	it('stores confirm prompt config on schema', () => {
		const f = flag.boolean().prompt({ kind: 'confirm', message: 'Continue?' });
		expect(f.schema.prompt).toEqual({ kind: 'confirm', message: 'Continue?' });
	});

	it('stores input prompt config on schema', () => {
		const f = flag.string().prompt({
			kind: 'input',
			message: 'Enter name',
			placeholder: 'my-project',
		});
		expect(f.schema.prompt).toEqual({
			kind: 'input',
			message: 'Enter name',
			placeholder: 'my-project',
		});
	});

	it('stores select prompt config on schema', () => {
		const f = flag.enum(['us', 'eu']).prompt({
			kind: 'select',
			message: 'Pick region',
		});
		expect(f.schema.prompt).toEqual({
			kind: 'select',
			message: 'Pick region',
		});
	});

	it('stores select prompt config with explicit choices', () => {
		const f = flag.string().prompt({
			kind: 'select',
			message: 'Pick format',
			choices: [
				{ value: 'json', label: 'JSON', description: 'Standard format' },
				{ value: 'yaml', label: 'YAML' },
			],
		});
		expect(f.schema.prompt?.kind).toBe('select');
		if (f.schema.prompt?.kind === 'select') {
			expect(f.schema.prompt.choices).toHaveLength(2);
			expect(f.schema.prompt.choices?.[0]?.description).toBe('Standard format');
		}
	});

	it('stores multiselect prompt config on schema', () => {
		const f = flag.array(flag.string()).prompt({
			kind: 'multiselect',
			message: 'Select tags',
			choices: [{ value: 'a' }, { value: 'b' }],
			min: 1,
			max: 3,
		});
		expect(f.schema.prompt?.kind).toBe('multiselect');
		if (f.schema.prompt?.kind === 'multiselect') {
			expect(f.schema.prompt.min).toBe(1);
			expect(f.schema.prompt.max).toBe(3);
		}
	});

	it('returns a new FlagBuilder (immutability)', () => {
		const original = flag.string();
		const withPrompt = original.prompt({ kind: 'input', message: 'Enter' });
		expect(original.schema.prompt).toBeUndefined();
		expect(withPrompt.schema.prompt).toBeDefined();
		expect(withPrompt).not.toBe(original);
	});

	it('preserves all other schema fields', () => {
		const f = flag
			.string()
			.alias('n')
			.env('NAME')
			.config('app.name')
			.describe('Your name')
			.prompt({ kind: 'input', message: 'Enter name' });

		expect(f.schema.kind).toBe('string');
		expect(f.schema.aliases).toEqual(['n']);
		expect(f.schema.envVar).toBe('NAME');
		expect(f.schema.configPath).toBe('app.name');
		expect(f.schema.description).toBe('Your name');
		expect(f.schema.prompt).toEqual({ kind: 'input', message: 'Enter name' });
	});

	it('can be overwritten by calling prompt() again', () => {
		const f = flag
			.string()
			.prompt({ kind: 'input', message: 'First' })
			.prompt({ kind: 'input', message: 'Second' });

		expect(f.schema.prompt).toEqual({ kind: 'input', message: 'Second' });
	});

	it('preserves type inference through prompt()', () => {
		const f = flag.enum(['us', 'eu', 'ap']).prompt({
			kind: 'select',
			message: 'Pick region',
		});
		// Type should still be 'us' | 'eu' | 'ap' | undefined
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<'us' | 'eu' | 'ap' | undefined>();
	});

	it('preserves required presence through prompt()', () => {
		const f = flag.string().required().prompt({ kind: 'input', message: 'Enter value' });
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('preserves defaulted presence through prompt()', () => {
		const f = flag.string().default('hello').prompt({ kind: 'input', message: 'Enter value' });
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('works with boolean + confirm prompt', () => {
		const f = flag.boolean().prompt({ kind: 'confirm', message: 'Force?' });
		expect(f.schema.kind).toBe('boolean');
		expect(f.schema.prompt?.kind).toBe('confirm');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<boolean>();
	});

	it('works with array + multiselect prompt', () => {
		const f = flag.array(flag.string()).prompt({
			kind: 'multiselect',
			message: 'Pick tags',
			choices: [{ value: 'alpha' }, { value: 'beta' }],
		});
		expect(f.schema.kind).toBe('array');
		expect(f.schema.prompt?.kind).toBe('multiselect');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string[]>();
	});
});

// ---------------------------------------------------------------------------
// InputPromptConfig.validate — runtime behavior
// ---------------------------------------------------------------------------

describe('InputPromptConfig.validate', () => {
	it('validate returns true for valid input', () => {
		const config: InputPromptConfig = {
			kind: 'input',
			message: 'Port',
			validate: (v) => (/^\d+$/.test(v) ? true : 'Must be a number'),
		};
		expect(config.validate?.('8080')).toBe(true);
	});

	it('validate returns error string for invalid input', () => {
		const config: InputPromptConfig = {
			kind: 'input',
			message: 'Port',
			validate: (v) => (/^\d+$/.test(v) ? true : 'Must be a number'),
		};
		expect(config.validate?.('abc')).toBe('Must be a number');
	});
});

// ---------------------------------------------------------------------------
// Chaining with other builder methods
// ---------------------------------------------------------------------------

describe('prompt() chaining order', () => {
	it('prompt before other modifiers', () => {
		const f = flag
			.string()
			.prompt({ kind: 'input', message: 'Name' })
			.alias('n')
			.env('NAME')
			.required();

		expect(f.schema.prompt).toEqual({ kind: 'input', message: 'Name' });
		expect(f.schema.aliases).toEqual(['n']);
		expect(f.schema.envVar).toBe('NAME');
		expect(f.schema.presence).toBe('required');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('prompt after other modifiers', () => {
		const f = flag
			.string()
			.alias('n')
			.env('NAME')
			.required()
			.prompt({ kind: 'input', message: 'Name' });

		expect(f.schema.prompt).toEqual({ kind: 'input', message: 'Name' });
		expect(f.schema.aliases).toEqual(['n']);
		expect(f.schema.envVar).toBe('NAME');
		expect(f.schema.presence).toBe('required');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('full resolution chain configuration', () => {
		const f = flag
			.enum(['us', 'eu', 'ap'])
			.env('DEPLOY_REGION')
			.config('deploy.region')
			.prompt({ kind: 'select', message: 'Select region' })
			.describe('Deployment region');

		expect(f.schema.kind).toBe('enum');
		expect(f.schema.envVar).toBe('DEPLOY_REGION');
		expect(f.schema.configPath).toBe('deploy.region');
		expect(f.schema.prompt).toEqual({
			kind: 'select',
			message: 'Select region',
		});
		expect(f.schema.description).toBe('Deployment region');
	});
});

// ---------------------------------------------------------------------------
// Integration: command builder with prompted flags
// ---------------------------------------------------------------------------

describe('command builder with prompted flags', () => {
	// Importing here to avoid circular — these tests validate integration
	// but the command module doesn't need to know about prompts
	it('command with prompted flags compiles and builds schema', async () => {
		const { command } = await import('./command.ts');

		const deploy = command('deploy')
			.flag(
				'region',
				flag
					.enum(['us', 'eu', 'ap'])
					.env('DEPLOY_REGION')
					.prompt({ kind: 'select', message: 'Select region' }),
			)
			.flag('force', flag.boolean().prompt({ kind: 'confirm', message: 'Force deploy?' }))
			.flag('name', flag.string().required().prompt({ kind: 'input', message: 'Project name' }));

		expect(deploy.schema.flags.region?.prompt).toEqual({
			kind: 'select',
			message: 'Select region',
		});
		expect(deploy.schema.flags.force?.prompt).toEqual({
			kind: 'confirm',
			message: 'Force deploy?',
		});
		expect(deploy.schema.flags.name?.prompt).toEqual({
			kind: 'input',
			message: 'Project name',
		});
	});
});

// ---------------------------------------------------------------------------
// Public surface exports
// ---------------------------------------------------------------------------

describe('public surface exports', () => {
	it('prompt types are re-exported from schema barrel', async () => {
		const schema = await import('./index.ts');
		// Type-only exports can't be checked at runtime, but we can verify
		// the module loads without errors and the re-exports compile
		expect(schema).toBeDefined();
	});

	it('prompt types are re-exported from public surface', async () => {
		const dreamcli = await import('#dreamcli');
		expect(dreamcli).toBeDefined();
	});
});
