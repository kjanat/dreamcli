/**
 * Tests for JSON Schema generation — definition metadata and input validation.
 */

import { describe, expect, it } from 'vitest';
import type { CLISchema } from '#internals/core/cli/index.ts';
import { createCLISchema } from '#internals/core/cli/index.ts';
import { createArgSchema } from '#internals/core/schema/arg.ts';
import { createCommandSchema } from '#internals/core/schema/command.ts';
import { createFlagSchema } from '#internals/core/schema/flag.ts';
import type {
	CommandArgEntry,
	CommandSchema,
	FlagDefinitionOverrides,
	FlagKind,
	FlagSchema,
} from '#internals/core/schema/index.ts';
import {
	definitionMetaSchema,
	generateCommandSchema,
	generateInputSchema,
	generateSchema,
} from './index.ts';

// === Test helpers

/** Definition fields for any flag kind, with the kind discriminator optional. */
type FlagDefOverrides = {
	[K in FlagKind]: FlagDefinitionOverrides<K> & { readonly kind?: K };
}[FlagKind];

/** Minimal FlagSchema with all required fields. */
function flagDef(overrides: FlagDefOverrides = {}): FlagSchema {
	return createFlagSchema(overrides.kind ?? 'string', overrides);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new TypeError('expected a record');
	}
	return value;
}

/** Minimal CommandSchema with all required fields. */
function commandDef(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return createCommandSchema({
		name: 'test',
		hasAction: true,
		...overrides,
	});
}

/** Options for minimalCLI — all fields optional. */
interface MinimalCLIOverrides {
	readonly name?: string;
	readonly version?: string | undefined;
	readonly description?: string | undefined;
	readonly commands?: CLISchema['commands'];
	readonly defaultCommand?: CLISchema['defaultCommand'];
}

/** Create a minimal CLISchema. */
function minimalCLI(overrides: MinimalCLIOverrides = {}): CLISchema {
	return createCLISchema({
		name: overrides.name ?? 'test-cli',
		version: overrides.version,
		description: overrides.description,
		commands: overrides.commands ?? [],
		defaultCommand: overrides.defaultCommand,
	});
}

/** Shorthand for creating a CommandArgEntry. */
function argEntry(
	name: string,
	overrides: Partial<import('#internals/core/schema/index.ts').ArgSchema> = {},
): CommandArgEntry {
	return {
		name,
		schema: createArgSchema(overrides.kind ?? 'string', overrides),
	};
}

// === generateSchema — definition metadata

describe('generateSchema — definition metadata', () => {
	// -------------------------------------------------------------------
	// CLI-level fields
	// -------------------------------------------------------------------

	it('emits $schema, schemaVersion, name, and empty commands for minimal CLI', () => {
		const result = generateSchema(minimalCLI());
		expect(result).toEqual({
			$schema: 'https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json',
			schemaVersion: 1,
			name: 'test-cli',
			commands: [],
		});
	});

	// -------------------------------------------------------------------
	// Document versioning
	// -------------------------------------------------------------------

	it('emits schemaVersion directly after $schema', () => {
		const result = generateSchema(minimalCLI());
		expect(Object.keys(result).slice(0, 2)).toEqual(['$schema', 'schemaVersion']);
		expect(result.schemaVersion).toBe(1);
	});

	it('emits schemaVersion on standalone command documents', () => {
		const document = generateCommandSchema(commandDef({ name: 'deploy' }));
		expect(document.schemaVersion).toBe(1);
		expect(Object.keys(document)[0]).toBe('schemaVersion');
	});

	it('omits schemaVersion from nested command fragments', () => {
		const rollback = commandDef({ name: 'rollback' });
		const deploy = commandDef({ name: 'deploy', commands: [rollback] });
		const result = generateSchema(minimalCLI({ commands: [deploy], defaultCommand: deploy }));
		const [topLevel] = result.commands;
		const nested = topLevel?.commands[0];
		const standalone = generateCommandSchema(deploy);

		expect(topLevel).toBeDefined();
		expect(topLevel).not.toHaveProperty('schemaVersion');
		expect(result.defaultCommand).toBeDefined();
		expect(result.defaultCommand).not.toHaveProperty('schemaVersion');
		expect(nested).toBeDefined();
		expect(nested).not.toHaveProperty('schemaVersion');
		expect(standalone.commands[0]).toBeDefined();
		expect(standalone.commands[0]).not.toHaveProperty('schemaVersion');
	});

	it('stays assignable to the Record<string, unknown> consumer pattern', () => {
		const definition: Record<string, unknown> = generateSchema(minimalCLI());
		const command: Record<string, unknown> = generateCommandSchema(commandDef());
		const input: Record<string, unknown> = generateInputSchema(commandDef());

		expect(definition.schemaVersion).toBe(1);
		expect(command.schemaVersion).toBe(1);
		expect(input.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
	});

	it('pins schemaVersion as a required const in the meta-schema', () => {
		expect(definitionMetaSchema).toHaveProperty(['properties', 'schemaVersion', 'const'], 1);
		expect(definitionMetaSchema).toHaveProperty('required', [
			'$schema',
			'schemaVersion',
			'name',
			'commands',
		]);
	});

	it('accepts standalone command documents via a dedicated def', () => {
		const defs = expectRecord(definitionMetaSchema.$defs);
		const command = expectRecord(defs.command);
		const commandDocument = expectRecord(defs.commandDocument);
		expect(Object.keys(expectRecord(commandDocument.properties))).toEqual([
			'schemaVersion',
			...Object.keys(expectRecord(command.properties)),
		]);
		expect(commandDocument.required).toEqual([
			'schemaVersion',
			'name',
			'flags',
			'args',
			'commands',
		]);
		expect(commandDocument).toHaveProperty(['properties', 'schemaVersion', 'const'], 1);

		const doc: Record<string, unknown> = generateCommandSchema(
			createCommandSchema({ name: 'deploy', hasAction: true }),
		);
		const allowed = new Set(Object.keys(expectRecord(commandDocument.properties)));
		for (const key of Object.keys(doc)) {
			expect(allowed).toContain(key);
		}
		for (const required of ['schemaVersion', 'name', 'flags', 'args', 'commands']) {
			expect(doc).toHaveProperty(required);
		}
	});

	it('includes version and description when present', () => {
		const result = generateSchema(minimalCLI({ version: '2.0.0', description: 'A CLI tool' }));
		expect(result).toHaveProperty('version', '2.0.0');
		expect(result).toHaveProperty('description', 'A CLI tool');
	});

	it('includes the defaultCommand as a full command definition', () => {
		const deploy = commandDef({ name: 'deploy' });
		const result = generateSchema(
			minimalCLI({
				commands: [deploy],
				defaultCommand: deploy,
			}),
		);
		expect(result).toHaveProperty('defaultCommand');
		expect(result.defaultCommand).toMatchObject({ name: 'deploy', flags: {}, args: [] });
	});

	it('omits hidden defaultCommand when includeHidden is false', () => {
		const hiddenDefault = commandDef({ name: 'secret', hidden: true });
		const visible = commandDef({ name: 'visible' });
		const result = generateSchema(
			minimalCLI({
				commands: [hiddenDefault, visible],
				defaultCommand: hiddenDefault,
			}),
			{ includeHidden: false },
		);

		expect(result).not.toHaveProperty('defaultCommand');
		expect(result).toHaveProperty(['commands', 'length'], 1);
		expect(result).toHaveProperty(['commands', 0, 'name'], 'visible');
	});

	// -------------------------------------------------------------------
	// Command serialization
	// -------------------------------------------------------------------

	it('serializes a command with name and description', () => {
		const cmd = commandDef({ name: 'deploy', description: 'Deploy stuff' });
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'name'], 'deploy');
		expect(result).toHaveProperty(['commands', 0, 'description'], 'Deploy stuff');
	});

	it('includes command aliases when non-empty', () => {
		const cmd = commandDef({ name: 'deploy', aliases: ['d', 'dep'] });
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'aliases'], ['d', 'dep']);
	});

	it('omits aliases when empty', () => {
		const cmd = commandDef({ name: 'deploy', aliases: [] });
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).not.toHaveProperty(['commands', 0, 'aliases']);
	});

	it('includes hidden: true when command is hidden', () => {
		const cmd = commandDef({ name: 'secret', hidden: true });
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'hidden'], true);
	});

	it('omits hidden when false', () => {
		const cmd = commandDef({ name: 'visible', hidden: false });
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).not.toHaveProperty(['commands', 0, 'hidden']);
	});

	it('serializes examples with command and optional description', () => {
		const cmd = commandDef({
			name: 'deploy',
			examples: [
				{ command: 'deploy prod', description: 'Deploy to production' },
				{ command: 'deploy staging' },
			],
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(
			['commands', 0, 'examples'],
			[
				{ command: 'deploy prod', description: 'Deploy to production' },
				{ command: 'deploy staging' },
			],
		);
	});

	it('resolves function-form example commands against the program meta', () => {
		const cmd = commandDef({
			name: 'deploy',
			examples: [{ command: (m) => `${m.name}@${m.version ?? 'dev'} deploy` }],
		});
		const result = generateSchema(minimalCLI({ name: 'mycli', version: '2.0.0', commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'examples'], [{ command: 'mycli@2.0.0 deploy' }]);
	});

	// -------------------------------------------------------------------
	// Flag serialization
	// -------------------------------------------------------------------

	it('serializes a string flag with minimal fields', () => {
		const cmd = commandDef({
			name: 'test',
			flags: { output: flagDef({ kind: 'string' }) },
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'output', 'kind'], 'string');
		expect(result).toHaveProperty(['commands', 0, 'flags', 'output', 'presence'], 'optional');
		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'output', 'defaultValue']);
		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'output', 'aliases']);
	});

	it('serializes all flag kinds', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				s: flagDef({ kind: 'string' }),
				n: flagDef({ kind: 'number' }),
				b: flagDef({ kind: 'boolean', presence: 'defaulted', defaultValue: false }),
				e: flagDef({ kind: 'enum', enumValues: ['a', 'b'] }),
				a: flagDef({
					kind: 'array',
					elementSchema: flagDef({ kind: 'string' }),
				}),
				c: flagDef({ kind: 'custom' }),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 's', 'kind'], 'string');
		expect(result).toHaveProperty(['commands', 0, 'flags', 'n', 'kind'], 'number');
		expect(result).toHaveProperty(['commands', 0, 'flags', 'b', 'kind'], 'boolean');
		expect(result).toHaveProperty(['commands', 0, 'flags', 'e', 'kind'], 'enum');
		expect(result).toHaveProperty(['commands', 0, 'flags', 'e', 'enumValues'], ['a', 'b']);
		expect(result).toHaveProperty(['commands', 0, 'flags', 'a', 'kind'], 'array');
		expect(result).toHaveProperty(['commands', 0, 'flags', 'a', 'elementSchema'], {
			kind: 'string',
			presence: 'optional',
		});
		expect(result).toHaveProperty(['commands', 0, 'flags', 'c', 'kind'], 'custom');
	});

	it('serializes constrained and hinted flag fields', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				retries: flagDef({
					kind: 'number',
					numberConstraints: { min: 1, max: 5, int: true, finite: false },
				}),
				tag: flagDef({
					kind: 'string',
					stringConstraints: {
						nonEmpty: true,
						minLength: 2,
						maxLength: 12,
						pattern: /^v\d+$/i,
					},
				}),
				files: flagDef({
					kind: 'array',
					elementSchema: flagDef({ kind: 'string' }),
					separator: ',',
					unique: true,
				}),
				path: flagDef({
					kind: 'string',
					pathChecks: { mustExist: true, type: 'file', create: false },
					valueHint: 'path',
				}),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));

		expect(result).toHaveProperty(['commands', 0, 'flags', 'retries'], {
			kind: 'number',
			presence: 'optional',
			numberConstraints: { min: 1, max: 5, int: true, finite: false },
		});
		expect(result).toHaveProperty(['commands', 0, 'flags', 'tag'], {
			kind: 'string',
			presence: 'optional',
			stringConstraints: {
				nonEmpty: true,
				minLength: 2,
				maxLength: 12,
				pattern: { source: '^v\\d+$', flags: 'i' },
			},
		});
		expect(result).toHaveProperty(['commands', 0, 'flags', 'files'], {
			kind: 'array',
			presence: 'optional',
			elementSchema: { kind: 'string', presence: 'optional' },
			separator: ',',
			unique: true,
		});
		expect(result).toHaveProperty(['commands', 0, 'flags', 'path'], {
			kind: 'string',
			presence: 'optional',
			pathChecks: { mustExist: true, type: 'file' },
			valueHint: 'path',
		});
	});

	it('includes flag defaultValue when defaulted and serializable', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				region: flagDef({ kind: 'string', presence: 'defaulted', defaultValue: 'us' }),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'region', 'defaultValue'], 'us');
	});

	it('omits flag defaultValue when not serializable', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				custom: flagDef({ kind: 'custom', presence: 'defaulted', defaultValue: () => 42 }),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'custom', 'defaultValue']);
	});

	it('omits non-finite numeric defaults from definition schema output', () => {
		const cases = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

		for (const defaultValue of cases) {
			const cmd = commandDef({
				name: 'test',
				flags: {
					count: flagDef({ kind: 'number', presence: 'defaulted', defaultValue }),
				},
				args: [argEntry('target', { kind: 'number', presence: 'defaulted', defaultValue })],
			});
			const result = generateSchema(minimalCLI({ commands: [cmd] }));

			expect(result).not.toHaveProperty(['commands', 0, 'flags', 'count', 'defaultValue']);
			expect(result).not.toHaveProperty(['commands', 0, 'args', 0, 'defaultValue']);
		}
	});

	it('includes flag aliases, envVar, configPath, description', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				region: flagDef({
					aliases: ['r'],
					envVar: 'REGION',
					configPath: 'deploy.region',
					description: 'Target region',
				}),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'region', 'aliases'], ['r']);
		expect(result).toHaveProperty(['commands', 0, 'flags', 'region', 'envVar'], 'REGION');
		expect(result).toHaveProperty(
			['commands', 0, 'flags', 'region', 'configPath'],
			'deploy.region',
		);
		expect(result).toHaveProperty(
			['commands', 0, 'flags', 'region', 'description'],
			'Target region',
		);
	});

	it('omits hidden flag aliases from generated schema', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				'skip-pass': flagDef({
					aliases: [
						{ name: 'skipPass', hidden: true },
						{ name: 'x', hidden: false },
					],
				}),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'skip-pass', 'aliases'], ['x']);
	});

	it('includes flag deprecation markers', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				old: flagDef({ deprecated: true }),
				legacy: flagDef({ deprecated: 'use --new instead' }),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'old', 'deprecated'], true);
		expect(result).toHaveProperty(
			['commands', 0, 'flags', 'legacy', 'deprecated'],
			'use --new instead',
		);
	});

	it('includes propagate: true when flag propagates', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				verbose: flagDef({ propagate: true }),
				silent: flagDef({ propagate: false }),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'verbose', 'propagate'], true);
		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'silent', 'propagate']);
	});

	it('serializes negation settings on negatable flags', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				sandbox: flagDef({
					kind: 'boolean',
					negation: { alias: undefined, hidden: false },
				}),
				color: flagDef({
					kind: 'boolean',
					negation: { alias: 'monochrome', hidden: true },
				}),
				force: flagDef({ kind: 'boolean' }),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'sandbox', 'negation'], {});
		expect(result).toHaveProperty(['commands', 0, 'flags', 'color', 'negation'], {
			alias: 'monochrome',
			hidden: true,
		});
		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'force', 'negation']);
	});

	it('includes duplicates only when the policy is non-default', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				spawn: flagDef({ kind: 'enum', enumValues: ['a', 'b'], duplicates: 'error' }),
				once: flagDef({ duplicates: 'first' }),
				region: flagDef({ duplicates: 'last' }),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'spawn', 'duplicates'], 'error');
		expect(result).toHaveProperty(['commands', 0, 'flags', 'once', 'duplicates'], 'first');
		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'region', 'duplicates']);
	});

	it('serializes prompt config on flags', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				region: flagDef({
					prompt: {
						kind: 'select',
						message: 'Choose region',
						choices: [{ value: 'us', label: 'US East', description: 'Virginia' }, { value: 'eu' }],
					},
				}),
				confirm: flagDef({
					prompt: { kind: 'confirm', message: 'Are you sure?' },
				}),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'region', 'prompt'], {
			kind: 'select',
			message: 'Choose region',
			choices: [{ value: 'us', label: 'US East', description: 'Virginia' }, { value: 'eu' }],
		});
		expect(result).toHaveProperty(['commands', 0, 'flags', 'confirm', 'prompt'], {
			kind: 'confirm',
			message: 'Are you sure?',
		});
	});

	it('omits prompt config when includePrompts is false', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				region: flagDef({
					prompt: { kind: 'input', message: 'Region?' },
				}),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }), {
			includePrompts: false,
		});
		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'region', 'prompt']);
	});

	it('serializes multiselect prompt with min/max', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				tags: flagDef({
					prompt: {
						kind: 'multiselect',
						message: 'Pick tags',
						choices: [{ value: 'a' }, { value: 'b' }],
						min: 1,
						max: 3,
					},
				}),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'flags', 'tags', 'prompt', 'min'], 1);
		expect(result).toHaveProperty(['commands', 0, 'flags', 'tags', 'prompt', 'max'], 3);
	});

	it('serializes input prompt with placeholder', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				name: flagDef({
					prompt: {
						kind: 'input',
						message: 'Your name?',
						placeholder: 'John',
					},
				}),
			},
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(
			['commands', 0, 'flags', 'name', 'prompt', 'placeholder'],
			'John',
		);
	});

	// -------------------------------------------------------------------
	// Arg serialization
	// -------------------------------------------------------------------

	it('serializes positional args with name, kind, presence', () => {
		const cmd = commandDef({
			name: 'test',
			args: [argEntry('target'), argEntry('count', { kind: 'number' })],
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(
			['commands', 0, 'args'],
			[
				{ name: 'target', kind: 'string', presence: 'required' },
				{ name: 'count', kind: 'number', presence: 'required' },
			],
		);
	});

	it('includes variadic, description, envVar, enumValues on args', () => {
		const cmd = commandDef({
			name: 'test',
			args: [
				argEntry('files', { variadic: true, description: 'Files to process' }),
				argEntry('region', { kind: 'enum', enumValues: ['us', 'eu'], envVar: 'REGION' }),
			],
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'args', 0, 'variadic'], true);
		expect(result).toHaveProperty(['commands', 0, 'args', 0, 'description'], 'Files to process');
		expect(result).toHaveProperty(['commands', 0, 'args', 1, 'enumValues'], ['us', 'eu']);
		expect(result).toHaveProperty(['commands', 0, 'args', 1, 'envVar'], 'REGION');
	});

	it('includes arg defaultValue when defaulted', () => {
		const cmd = commandDef({
			name: 'test',
			args: [argEntry('target', { presence: 'defaulted', defaultValue: 'prod' })],
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'args', 0, 'defaultValue'], 'prod');
	});

	it('omits cyclic defaultValue objects', () => {
		const cycle: Record<string, unknown> = {};
		cycle['self'] = cycle;
		const cmd = commandDef({
			name: 'test',
			flags: { meta: flagDef({ presence: 'defaulted', defaultValue: cycle }) },
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));

		expect(result).not.toHaveProperty(['commands', 0, 'flags', 'meta', 'defaultValue']);
	});

	it('keeps shared-reference defaultValue objects', () => {
		const shared = { region: 'eu' };
		const graph = { primary: shared, secondary: shared };
		const cmd = commandDef({
			name: 'test',
			flags: { meta: flagDef({ presence: 'defaulted', defaultValue: graph }) },
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));

		expect(result).toHaveProperty(['commands', 0, 'flags', 'meta', 'defaultValue'], graph);
	});

	it('omits lossy object instances from defaultValue', () => {
		class ConfigShape {
			readonly region = 'eu';
		}

		const cases = [
			new Date('2026-01-01T00:00:00.000Z'),
			new Map([['region', 'eu']]),
			/region/i,
			new ConfigShape(),
		];

		for (const defaultValue of cases) {
			const cmd = commandDef({
				name: 'test',
				flags: { meta: flagDef({ presence: 'defaulted', defaultValue }) },
			});
			const result = generateSchema(minimalCLI({ commands: [cmd] }));

			expect(result).not.toHaveProperty(['commands', 0, 'flags', 'meta', 'defaultValue']);
		}
	});

	it('includes arg deprecation marker', () => {
		const cmd = commandDef({
			name: 'test',
			args: [argEntry('old', { deprecated: 'use flags instead' })],
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 0, 'args', 0, 'deprecated'], 'use flags instead');
	});

	// -------------------------------------------------------------------
	// Subcommands
	// -------------------------------------------------------------------

	it('recursively serializes subcommands', () => {
		const rollback = commandDef({ name: 'rollback', description: 'Undo deploy' });
		const deploy = commandDef({ name: 'deploy', commands: [rollback] });
		const result = generateSchema(minimalCLI({ commands: [deploy] }));
		expect(result).toHaveProperty(['commands', 0, 'commands', 0, 'name'], 'rollback');
		expect(result).toHaveProperty(['commands', 0, 'commands', 0, 'description'], 'Undo deploy');
	});

	it('handles three levels of nesting', () => {
		const leaf = commandDef({ name: 'leaf' });
		const mid = commandDef({ name: 'mid', commands: [leaf] });
		const top = commandDef({ name: 'top', commands: [mid] });
		const result = generateSchema(minimalCLI({ commands: [top] }));
		expect(result).toHaveProperty(['commands', 0, 'commands', 0, 'commands', 0, 'name'], 'leaf');
	});

	// -------------------------------------------------------------------
	// Hidden command filtering
	// -------------------------------------------------------------------

	it('includes hidden commands by default', () => {
		const cmd = commandDef({ name: 'secret', hidden: true });
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		expect(result).toHaveProperty(['commands', 'length'], 1);
	});

	it('excludes hidden commands when includeHidden is false', () => {
		const visible = commandDef({ name: 'visible', hidden: false });
		const hidden = commandDef({ name: 'hidden', hidden: true });
		const result = generateSchema(minimalCLI({ commands: [visible, hidden] }), {
			includeHidden: false,
		});
		expect(result).toHaveProperty(['commands', 'length'], 1);
		expect(result).toHaveProperty(['commands', 0, 'name'], 'visible');
	});

	it('excludes hidden subcommands when includeHidden is false', () => {
		const parent = commandDef({
			name: 'parent',
			commands: [commandDef({ name: 'visible' }), commandDef({ name: 'hidden', hidden: true })],
		});
		const result = generateSchema(minimalCLI({ commands: [parent] }), {
			includeHidden: false,
		});
		expect(result).toHaveProperty(['commands', 0, 'commands', 'length'], 1);
		expect(result).toHaveProperty(['commands', 0, 'commands', 0, 'name'], 'visible');
	});

	// -------------------------------------------------------------------
	// Non-serializable fields omitted
	// -------------------------------------------------------------------

	it('omits parseFn and interactive from output', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				custom: flagDef({ kind: 'custom', parseFn: (v) => String(v) }),
			},
			interactive: () => ({}),
		});
		const result = generateSchema(minimalCLI({ commands: [cmd] }));
		const output = JSON.stringify(result);
		expect(output).not.toContain('parseFn');
		expect(output).not.toContain('interactive');
		expect(output).not.toContain('_execute');
		expect(output).not.toContain('hasAction');
	});

	it('annotates the definition meta-schema with source-backed descriptions', () => {
		expect(definitionMetaSchema).toHaveProperty(
			['properties', 'name', 'description'],
			'Program name (used in help text, usage lines, and completion scripts).',
		);
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'flag', 'properties', 'configPath', 'description'],
			"Dotted config path for v0.2+ resolution (e.g. `'deploy.region'`).",
		);
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'prompt', 'properties', 'message', 'description'],
			'The question displayed to the user.',
		);
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'example', 'properties', 'command', 'description'],
			"The command invocation (e.g. `'deploy production --force'`).",
		);
	});

	it('describes flag negation and duplicate policy in the meta-schema', () => {
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'flag', 'properties', 'negation', '$ref'],
			'#/$defs/negation',
		);
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'flag', 'properties', 'duplicates', 'enum'],
			['last', 'first', 'error'],
		);
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'negation', 'properties', 'alias', 'type'],
			'string',
		);
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'negation', 'properties', 'hidden', 'const'],
			true,
		);
		// Both fields are optional — negation/duplicates only appear when set.
		expect(definitionMetaSchema).toHaveProperty(
			['$defs', 'flag', 'required'],
			['kind', 'presence'],
		);
	});

	it('describes constrained flag fixtures in the meta-schema', () => {
		expect(definitionMetaSchema).toMatchObject({
			$defs: {
				flag: {
					properties: {
						numberConstraints: {
							type: 'object',
							additionalProperties: false,
							properties: {
								min: { type: 'number' },
								max: { type: 'number' },
								int: { type: 'boolean' },
								finite: { type: 'boolean' },
							},
						},
						stringConstraints: {
							type: 'object',
							additionalProperties: false,
							properties: {
								nonEmpty: { type: 'boolean' },
								minLength: { type: 'integer', minimum: 0 },
								maxLength: { type: 'integer', minimum: 0 },
								pattern: {
									type: 'object',
									additionalProperties: false,
									properties: {
										source: { type: 'string' },
										flags: { type: 'string' },
									},
									required: ['source', 'flags'],
								},
							},
						},
						separator: { type: 'string', minLength: 1 },
						unique: { type: 'boolean' },
						pathChecks: {
							type: 'object',
							additionalProperties: false,
							properties: {
								mustExist: { type: 'boolean' },
								type: { enum: ['file', 'directory'] },
							},
							required: ['mustExist'],
						},
						valueHint: { type: 'string' },
					},
				},
			},
		});
	});

	it('keeps serialized FlagSchema fields exhaustive against the meta-schema', () => {
		const allFieldsFlags: Readonly<Record<string, FlagSchema>> = {
			region: flagDef({
				kind: 'enum',
				presence: 'defaulted',
				defaultValue: 'us',
				aliases: [{ name: 'r', hidden: false }],
				envVar: 'REGION',
				configPath: 'release.region',
				description: 'Release region',
				enumValues: ['us', 'eu'],
				valueHint: 'region',
				prompt: { kind: 'input', message: 'Region?', placeholder: 'us' },
				deprecated: 'use --release',
				propagate: true,
				duplicates: 'error',
			}),
			port: flagDef({
				kind: 'number',
				numberConstraints: { min: 1, max: 5, int: true, finite: false },
			}),
			source: flagDef({
				kind: 'string',
				stringConstraints: {
					nonEmpty: true,
					minLength: 2,
					maxLength: 12,
					pattern: /^v\d+$/,
				},
				pathChecks: { mustExist: true, type: 'directory', create: true },
			}),
			versions: flagDef({
				kind: 'array',
				elementSchema: flagDef({ kind: 'string' }),
				separator: ',',
				unique: true,
			}),
			force: flagDef({
				kind: 'boolean',
				negation: { alias: 'no-force', hidden: true },
			}),
			parser: flagDef({
				kind: 'custom',
				parseFn: (value: unknown) => value,
				standard: {
					'~standard': {
						version: 1,
						vendor: 'test',
						validate: (value: unknown) => ({ value }),
					},
				},
			}),
		};
		const result = generateSchema(
			minimalCLI({
				commands: [commandDef({ flags: allFieldsFlags })],
			}),
		);
		const commands = expectRecord(result).commands;
		if (!Array.isArray(commands)) {
			throw new TypeError('expected commands');
		}
		const command = expectRecord(commands[0]);
		const flags = expectRecord(command.flags);
		const defs = expectRecord(definitionMetaSchema.$defs);
		const flagMetaSchema = expectRecord(defs.flag);
		const flagMetaProperties = expectRecord(flagMetaSchema.properties);
		const serializedFields = new Set<string>();
		for (const name of Object.keys(allFieldsFlags)) {
			for (const field of Object.keys(expectRecord(flags[name]))) {
				serializedFields.add(field);
			}
		}

		expect([...serializedFields].sort()).toEqual(Object.keys(flagMetaProperties).sort());
		expect(expectRecord(flags.source)).toHaveProperty(['stringConstraints', 'pattern'], {
			source: '^v\\d+$',
			flags: '',
		});
		expect(expectRecord(flags.parser)).not.toHaveProperty('parseFn');
		expect(expectRecord(flags.parser)).not.toHaveProperty('standard');
	});
});

// === generateInputSchema — JSON Schema validation

describe('generateInputSchema — input validation', () => {
	// -------------------------------------------------------------------
	// Single command (CommandSchema)
	// -------------------------------------------------------------------

	it('produces a flat object schema for a single CommandSchema', () => {
		const cmd = commandDef({
			name: 'deploy',
			flags: {
				region: flagDef({ kind: 'enum', presence: 'required', enumValues: ['us', 'eu'] }),
				force: flagDef({ kind: 'boolean' }),
			},
			args: [argEntry('target')],
		});
		const result = generateInputSchema(cmd);
		expect(result).toMatchObject({
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				region: { type: 'string', enum: ['us', 'eu'] },
				force: { type: 'boolean' },
				target: { type: 'string' },
			},
			required: ['region', 'target'],
		});
	});

	it('omits required array when no flags/args are required', () => {
		const cmd = commandDef({
			name: 'test',
			flags: { verbose: flagDef({ kind: 'boolean' }) },
		});
		const result = generateInputSchema(cmd);
		expect(result).not.toHaveProperty('required');
	});

	// -------------------------------------------------------------------
	// Flag type mapping
	// -------------------------------------------------------------------

	it('maps all flag kinds to JSON Schema types', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				s: flagDef({ kind: 'string' }),
				n: flagDef({ kind: 'number' }),
				b: flagDef({ kind: 'boolean' }),
				e: flagDef({ kind: 'enum', enumValues: ['x', 'y'] }),
				a: flagDef({ kind: 'array', elementSchema: flagDef({ kind: 'number' }) }),
				c: flagDef({ kind: 'custom' }),
			},
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 's', 'type'], 'string');
		expect(result).toHaveProperty(['properties', 'n', 'type'], 'number');
		expect(result).toHaveProperty(['properties', 'b', 'type'], 'boolean');
		expect(result).toHaveProperty(['properties', 'e'], { type: 'string', enum: ['x', 'y'] });
		expect(result).toHaveProperty(['properties', 'a'], {
			type: 'array',
			items: { type: 'number' },
		});
		// custom → no type constraint
		expect(result).not.toHaveProperty(['properties', 'c', 'type']);
	});

	it('includes description and default on flag types', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				region: flagDef({
					kind: 'string',
					presence: 'defaulted',
					defaultValue: 'us',
					description: 'Target region',
				}),
			},
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'region', 'description'], 'Target region');
		expect(result).toHaveProperty(['properties', 'region', 'default'], 'us');
	});

	it('preserves deprecated string message', () => {
		const cmd = commandDef({
			name: 'test',
			flags: { old: flagDef({ deprecated: 'use --new' }) },
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'old', 'deprecated'], 'use --new');
	});

	// -------------------------------------------------------------------
	// Arg type mapping
	// -------------------------------------------------------------------

	it('maps arg kinds to JSON Schema types', () => {
		const cmd = commandDef({
			name: 'test',
			args: [
				argEntry('name', { kind: 'string' }),
				argEntry('count', { kind: 'number' }),
				argEntry('env', { kind: 'enum', enumValues: ['dev', 'prod'] }),
				argEntry('custom', { kind: 'custom' }),
			],
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'name', 'type'], 'string');
		expect(result).toHaveProperty(['properties', 'count', 'type'], 'number');
		expect(result).toHaveProperty(['properties', 'env', 'type'], 'string');
		expect(result).toHaveProperty(['properties', 'env', 'enum'], ['dev', 'prod']);
		expect(result).not.toHaveProperty(['properties', 'custom', 'type']);
	});

	it('wraps variadic args as array type', () => {
		const cmd = commandDef({
			name: 'test',
			args: [argEntry('files', { variadic: true })],
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'files', 'type'], 'array');
		expect(result).toHaveProperty(['properties', 'files', 'items'], { type: 'string' });
	});

	it('includes arg description and default', () => {
		const cmd = commandDef({
			name: 'test',
			args: [
				argEntry('target', {
					presence: 'defaulted',
					defaultValue: 'prod',
					description: 'Deploy target',
				}),
			],
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'target', 'description'], 'Deploy target');
		expect(result).toHaveProperty(['properties', 'target', 'default'], 'prod');
	});

	it('omits non-finite numeric defaults from input schema output', () => {
		const cases = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

		for (const defaultValue of cases) {
			const cmd = commandDef({
				name: 'test',
				flags: {
					count: flagDef({ kind: 'number', presence: 'defaulted', defaultValue }),
				},
				args: [argEntry('target', { kind: 'number', presence: 'defaulted', defaultValue })],
			});
			const result = generateInputSchema(cmd);

			expect(result).not.toHaveProperty(['properties', 'count', 'default']);
			expect(result).not.toHaveProperty(['properties', 'target', 'default']);
		}
	});

	// -------------------------------------------------------------------
	// Multi-command CLI (CLISchema)
	// -------------------------------------------------------------------

	it('produces oneOf discriminated union for multi-command CLI', () => {
		const deploy = commandDef({
			name: 'deploy',
			flags: { region: flagDef({ kind: 'string', presence: 'required' }) },
		});
		const status = commandDef({ name: 'status' });
		const cli = minimalCLI({ commands: [deploy, status] });
		const result = generateInputSchema(cli);

		expect(result).toHaveProperty('$schema', 'https://json-schema.org/draft/2020-12/schema');
		expect(result).toHaveProperty(['oneOf', 'length'], 2);
		// deploy branch
		expect(result).toHaveProperty(['oneOf', 0, 'properties', 'command'], { const: 'deploy' });
		expect(result).toHaveProperty(['oneOf', 0, 'properties', 'region', 'type'], 'string');
		expect(result).toHaveProperty(['oneOf', 0, 'required'], ['command', 'region']);
		// status branch
		expect(result).toHaveProperty(['oneOf', 1, 'properties', 'command'], { const: 'status' });
		expect(result).toHaveProperty(['oneOf', 1, 'required'], ['command']);
	});

	it('omits the discriminator for a visible default with siblings', () => {
		const deploy = commandDef({ name: 'deploy' });
		const status = commandDef({ name: 'status' });
		const cli = minimalCLI({
			commands: [deploy, status],
			defaultCommand: deploy,
		});
		const result = generateInputSchema(cli);

		expect(result).toHaveProperty(['oneOf', 'length'], 2);
		expect(result).not.toHaveProperty(['oneOf', 0, 'properties', 'command']);
		expect(result).not.toHaveProperty(['oneOf', 0, 'required']);
		expect(result).toHaveProperty(['oneOf', 1, 'properties', 'command'], { const: 'status' });
		expect(result).toHaveProperty(['oneOf', 1, 'required'], ['command']);
	});

	it('produces flat schema for single-command CLI', () => {
		const deploy = commandDef({ name: 'deploy' });
		const cli = minimalCLI({ commands: [deploy] });
		const result = generateInputSchema(cli);

		expect(result).not.toHaveProperty('oneOf');
		expect(result).toHaveProperty('type', 'object');
		expect(result).not.toHaveProperty(['properties', 'command']);
		expect(result).toHaveProperty('additionalProperties', false);
	});

	it('uses dot-path for nested subcommands', () => {
		const rollback = commandDef({ name: 'rollback' });
		const deploy = commandDef({ name: 'deploy', commands: [rollback] });
		const cli = minimalCLI({ commands: [deploy] });
		const result = generateInputSchema(cli);

		expect(result).toHaveProperty(['oneOf', 'length'], 2);
		expect(result).toHaveProperty(['oneOf', 0, 'properties', 'command'], { const: 'deploy' });
		expect(result).toHaveProperty(['oneOf', 1, 'properties', 'command'], {
			const: 'deploy.rollback',
		});
	});

	it('skips group commands without actions', () => {
		const leaf = commandDef({ name: 'leaf' });
		const groupCmd = commandDef({ name: 'group', hasAction: false, commands: [leaf] });
		const cli = minimalCLI({ commands: [groupCmd] });
		const result = generateInputSchema(cli);

		// Single invocable command — flat schema
		expect(result).not.toHaveProperty('oneOf');
		expect(result).toHaveProperty('type', 'object');
		expect(result).not.toHaveProperty(['properties', 'command']);
		expect(result).toHaveProperty('additionalProperties', false);
	});

	it('handles deep nesting with dot-paths', () => {
		const c = commandDef({ name: 'c' });
		const b = commandDef({ name: 'b', hasAction: false, commands: [c] });
		const a = commandDef({ name: 'a', hasAction: false, commands: [b] });
		const cli = minimalCLI({ commands: [a] });
		const result = generateInputSchema(cli);

		expect(result).toHaveProperty('type', 'object');
		expect(result).not.toHaveProperty(['properties', 'command']);
		expect(result).toHaveProperty('additionalProperties', false);
	});

	// -------------------------------------------------------------------
	// Hidden command filtering
	// -------------------------------------------------------------------

	it('includes hidden commands in input schema by default', () => {
		const visible = commandDef({ name: 'visible' });
		const hidden = commandDef({ name: 'hidden', hidden: true });
		const cli = minimalCLI({ commands: [visible, hidden] });
		const result = generateInputSchema(cli);
		expect(result).toHaveProperty(['oneOf', 'length'], 2);
	});

	it('excludes hidden commands when includeHidden is false', () => {
		const visible = commandDef({ name: 'visible' });
		const hidden = commandDef({ name: 'hidden', hidden: true });
		const cli = minimalCLI({ commands: [visible, hidden] });
		const result = generateInputSchema(cli, { includeHidden: false });

		expect(result).not.toHaveProperty('oneOf');
		expect(result).toHaveProperty('type', 'object');
		expect(result).not.toHaveProperty(['properties', 'command']);
		expect(result).toHaveProperty('additionalProperties', false);
	});

	// -------------------------------------------------------------------
	// Edge cases
	// -------------------------------------------------------------------

	it('produces empty object schema for CLI with no invocable commands', () => {
		const cli = minimalCLI({ commands: [] });
		const result = generateInputSchema(cli);
		expect(result).toEqual({
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
		});
	});

	it('does not include command discriminator for CommandSchema input', () => {
		const cmd = commandDef({ name: 'deploy' });
		const result = generateInputSchema(cmd);
		expect(result).not.toHaveProperty(['properties', 'command']);
	});
});

// === Numeric constraints → JSON Schema

describe('numeric constraints — JSON Schema integration', () => {
	it('emits type: integer and minimum/maximum for constrained number flags', () => {
		const cmd = commandDef({
			name: 'test',
			flags: {
				times: flagDef({ kind: 'number', numberConstraints: { int: true, min: 0, max: 100 } }),
			},
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'times'], {
			type: 'integer',
			minimum: 0,
			maximum: 100,
		});
	});

	it('emits type: number (not integer) when int is not set', () => {
		const cmd = commandDef({
			name: 'test',
			flags: { ratio: flagDef({ kind: 'number', numberConstraints: { min: 0 } }) },
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'ratio', 'type'], 'number');
		expect(result).toHaveProperty(['properties', 'ratio', 'minimum'], 0);
		expect(result).not.toHaveProperty(['properties', 'ratio', 'maximum']);
	});

	it('omits minimum/maximum when no bounds are set (finite has no JSON-Schema field)', () => {
		const cmd = commandDef({
			name: 'test',
			flags: { plain: flagDef({ kind: 'number', numberConstraints: { finite: false } }) },
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'plain', 'type'], 'number');
		expect(result).not.toHaveProperty(['properties', 'plain', 'minimum']);
		expect(result).not.toHaveProperty(['properties', 'plain', 'maximum']);
	});

	it('emits constraints consistently for number args', () => {
		const cmd = commandDef({
			name: 'test',
			args: [argEntry('count', { kind: 'number', numberConstraints: { int: true, min: 1 } })],
		});
		const result = generateInputSchema(cmd);
		expect(result).toHaveProperty(['properties', 'count', 'type'], 'integer');
		expect(result).toHaveProperty(['properties', 'count', 'minimum'], 1);
	});
});
