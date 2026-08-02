import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CLISchema, ConfigSettings } from '#internals/core/cli/index.ts';
import { createCLISchema } from '#internals/core/cli/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import type { ArgSchema } from './arg.ts';
import { createArgSchema } from './arg.ts';
import type { schemaBrand } from './brand.ts';
import type { CommandSchema, ErasedInteractiveResolver } from './command.ts';
import { createCommandSchema } from './command.ts';
import type { FlagSchema } from './flag.ts';
import { createFlagSchema } from './flag.ts';

/** {@link FlagSchema} with the type-only brand removed. */
type UnbrandedFlagSchema = Omit<FlagSchema, typeof schemaBrand>;

/** {@link ArgSchema} with the type-only brand removed. */
type UnbrandedArgSchema = Omit<ArgSchema, typeof schemaBrand>;

/** {@link CommandSchema} with the type-only brand removed. */
type UnbrandedCommandSchema = Omit<CommandSchema, typeof schemaBrand>;

/** {@link ConfigSettings} with the type-only brand removed. */
type UnbrandedConfigSettings = Omit<ConfigSettings, typeof schemaBrand>;

/** {@link CLISchema} with the type-only brands removed, nested settings included. */
type UnbrandedCLISchema = Omit<CLISchema, typeof schemaBrand | 'configSettings'> & {
	readonly configSettings: UnbrandedConfigSettings | undefined;
};

const spelledFlagFields: UnbrandedFlagSchema = {
	kind: 'string',
	presence: 'optional',
	defaultValue: undefined,
	aliases: [],
	envVar: undefined,
	configPath: undefined,
	description: undefined,
	enumValues: undefined,
	numberConstraints: undefined,
	stringConstraints: undefined,
	elementSchema: undefined,
	separator: undefined,
	unique: false,
	pathChecks: undefined,
	valueHint: undefined,
	prompt: undefined,
	parseFn: undefined,
	standard: undefined,
	deprecated: undefined,
	propagate: false,
	negation: undefined,
	duplicates: 'last',
};

const spelledArgFields: UnbrandedArgSchema = {
	kind: 'string',
	presence: 'required',
	variadic: false,
	stdinMode: false,
	defaultValue: undefined,
	description: undefined,
	envVar: undefined,
	enumValues: undefined,
	numberConstraints: undefined,
	parseFn: undefined,
	standard: undefined,
	deprecated: undefined,
};

const spelledCommandFields: UnbrandedCommandSchema = {
	name: 'deploy',
	description: undefined,
	aliases: [],
	hidden: false,
	examples: [],
	flags: {},
	args: [],
	hasAction: false,
	interactive: undefined,
	commands: [],
};

const spelledConfigSettingsFields: UnbrandedConfigSettings = {
	appName: 'mycli',
	loaders: undefined,
};

const spelledCLIFields: UnbrandedCLISchema = {
	name: 'mycli',
	inheritName: false,
	version: undefined,
	description: undefined,
	commands: [],
	defaultCommand: undefined,
	defaultCommandRouted: false,
	configSettings: undefined,
	packageJsonSettings: undefined,
	helpLinks: undefined,
	hasBuiltInCompletions: false,
	completionsFlag: undefined,
	helpConfig: undefined,
	flagSettings: undefined,
};

/**
 * Run a factory call that is expected to fail and report its error code.
 *
 * @param build - Factory call under test.
 * @returns The {@link CLIError} code the call threw.
 * @throws When the call succeeds or throws a non-{@link CLIError} value.
 */
function schemaErrorCode(build: () => unknown): string {
	try {
		build();
	} catch (error) {
		if (error instanceof CLIError) return error.code;
		throw error;
	}

	throw new Error('Expected the factory to throw a CLIError');
}

// === schema sealing

describe('schema sealing', () => {
	// --- structural literals

	describe('structural literals', () => {
		it('spells every flag field a caller can reach', () => {
			expect(spelledFlagFields).toEqual(createFlagSchema('string'));
		});

		it('rejects a fully spelled flag literal', () => {
			// @ts-expect-error the flag brand key is unspellable outside createFlagSchema
			const sealed: FlagSchema = spelledFlagFields;
			expect(sealed.kind).toBe('string');
		});

		it('spells every arg field a caller can reach', () => {
			expect(spelledArgFields).toEqual(createArgSchema('string'));
		});

		it('rejects a fully spelled arg literal', () => {
			// @ts-expect-error the arg brand key is unspellable outside createArgSchema
			const sealed: ArgSchema = spelledArgFields;
			expect(sealed.kind).toBe('string');
		});

		it('spells every command field a caller can reach', () => {
			expect(spelledCommandFields).toEqual(createCommandSchema({ name: 'deploy' }));
		});

		it('rejects a fully spelled command literal', () => {
			// @ts-expect-error the command brand key is unspellable outside createCommandSchema
			const sealed: CommandSchema = spelledCommandFields;
			expect(sealed.name).toBe('deploy');
		});

		it('spells every config settings field a caller can reach', () => {
			expect(
				createCLISchema({ name: 'mycli', configSettings: { appName: 'mycli' } }).configSettings,
			).toEqual(spelledConfigSettingsFields);
		});

		it('rejects a fully spelled config settings literal', () => {
			// @ts-expect-error the config brand key is unspellable outside createCLISchema
			const sealed: ConfigSettings = spelledConfigSettingsFields;
			expect(sealed.appName).toBe('mycli');
		});

		it('spells every CLI field a caller can reach', () => {
			expect(spelledCLIFields).toEqual(createCLISchema({ name: 'mycli' }));
		});

		it('rejects a fully spelled CLI literal', () => {
			// @ts-expect-error the cli brand key is unspellable outside createCLISchema
			const sealed: CLISchema = spelledCLIFields;
			expect(sealed.name).toBe('mycli');
		});

		it('leaves the brand as the only obstacle to structural assignment', () => {
			expectTypeOf<FlagSchema>().toExtend<UnbrandedFlagSchema>();
			expectTypeOf<UnbrandedFlagSchema>().not.toExtend<FlagSchema>();
			expectTypeOf<ArgSchema>().toExtend<UnbrandedArgSchema>();
			expectTypeOf<UnbrandedArgSchema>().not.toExtend<ArgSchema>();
			expectTypeOf<CommandSchema>().toExtend<UnbrandedCommandSchema>();
			expectTypeOf<UnbrandedCommandSchema>().not.toExtend<CommandSchema>();
			expectTypeOf<ConfigSettings>().toExtend<UnbrandedConfigSettings>();
			expectTypeOf<UnbrandedConfigSettings>().not.toExtend<ConfigSettings>();
			expectTypeOf<CLISchema>().toExtend<UnbrandedCLISchema>();
			expectTypeOf<UnbrandedCLISchema>().not.toExtend<CLISchema>();
		});
	});

	// --- spread propagation

	describe('spread propagation', () => {
		it('carries the flag brand through a spread', () => {
			const built = createFlagSchema('string');
			const widened: FlagSchema = { ...built, description: 'Target host' };
			expectTypeOf({ ...built, description: 'Target host' }).toExtend<FlagSchema>();
			expect(widened.description).toBe('Target host');
		});

		it('carries the arg brand through a spread', () => {
			const built = createArgSchema('string');
			const widened: ArgSchema = { ...built, description: 'Target host' };
			expectTypeOf({ ...built, description: 'Target host' }).toExtend<ArgSchema>();
			expect(widened.description).toBe('Target host');
		});

		it('carries the command brand through a spread', () => {
			const built = createCommandSchema({ name: 'deploy' });
			const widened: CommandSchema = { ...built, description: 'Ship the build' };
			expectTypeOf({ ...built, description: 'Ship the build' }).toExtend<CommandSchema>();
			expect(widened.description).toBe('Ship the build');
		});

		it('carries the CLI brand through a spread', () => {
			const built = createCLISchema({ name: 'mycli' });
			const widened: CLISchema = { ...built, description: 'Ship the build' };
			expectTypeOf({ ...built, description: 'Ship the build' }).toExtend<CLISchema>();
			expect(widened.description).toBe('Ship the build');
		});
	});

	// --- normalization idempotence

	describe('normalization idempotence', () => {
		it('rebuilds a deep-equal command schema from its own output', () => {
			const built = createCommandSchema({
				name: 'deploy',
				description: 'Ship the build',
				flags: {
					force: { kind: 'boolean' },
					tag: { kind: 'array', elementSchema: { kind: 'string' }, separator: ',' },
				},
				args: [
					{ name: 'target', schema: { kind: 'string' } },
					{ name: 'region', schema: { kind: 'enum', enumValues: ['us', 'eu'] } },
				],
				commands: [{ name: 'status', flags: { json: { kind: 'boolean' } } }],
			});

			expect(createCommandSchema(built)).toEqual(built);
		});

		it('rebuilds a deep-equal command schema carrying nested commands and interactive', () => {
			const resolver: ErasedInteractiveResolver = () => ({});
			const built = createCommandSchema({
				name: 'deploy',
				interactive: resolver,
				commands: [{ name: 'status', interactive: resolver }],
			});

			expect(built.interactive).toBe(resolver);
			expect(built.commands[0]?.interactive).toBe(resolver);
			expect(createCommandSchema(built)).toEqual(built);
		});

		it('rebuilds a deep-equal array flag schema with a definition element', () => {
			const built = createFlagSchema({
				kind: 'array',
				elementSchema: { kind: 'string' },
				separator: ',',
				unique: true,
			});

			expect(built.elementSchema).toEqual(createFlagSchema('string'));
			expect(createFlagSchema(built)).toEqual(built);
		});

		it('rebuilds a deep-equal arg schema from its own output', () => {
			const built = createArgSchema('enum', { enumValues: ['us', 'eu'], description: 'Region' });
			expect(createArgSchema(built)).toEqual(built);
		});

		it('re-normalizes a flag whose kind-specific fields are explicitly undefined', () => {
			const built = createFlagSchema('string', { description: 'Target host' });
			expect(built.enumValues).toBeUndefined();
			expect(createFlagSchema(built)).toEqual(built);
		});

		it('re-normalizes an arg whose kind-specific fields are explicitly undefined', () => {
			const built = createArgSchema('string', { description: 'Target host' });
			expect(built.numberConstraints).toBeUndefined();
			expect(createArgSchema(built)).toEqual(built);
		});

		it('rebuilds a deep-equal CLI schema from its own output', () => {
			const built = createCLISchema({
				name: 'mycli',
				version: '1.0.0',
				description: 'Ship the build',
				inheritName: true,
				defaultCommandRouted: true,
				hasBuiltInCompletions: true,
				configSettings: { appName: 'mycli' },
				commands: [{ name: 'deploy', flags: { force: { kind: 'boolean' } } }],
				defaultCommand: { name: 'serve' },
			});

			expect(createCLISchema(built)).toEqual(built);
		});

		it('re-normalizes a CLI schema whose optional fields are explicitly undefined', () => {
			const built = createCLISchema({ name: 'mycli' });
			expect(built.configSettings).toBeUndefined();
			expect(createCLISchema(built)).toEqual(built);
		});
	});

	// --- factory validation

	describe('factory validation', () => {
		it('rejects a flag field belonging to another kind', () => {
			// @ts-expect-error enumValues requires kind 'enum'
			const build = () => createFlagSchema('boolean', { enumValues: ['x'] });
			expect(schemaErrorCode(build)).toBe('INVALID_SCHEMA');
		});

		it('rejects an arg field belonging to another kind', () => {
			// @ts-expect-error enumValues requires kind 'enum'
			const build = () => createArgSchema('string', { enumValues: ['x'] });
			expect(schemaErrorCode(build)).toBe('INVALID_SCHEMA');
		});

		it('requires enumValues for positional enum flag definitions', () => {
			// @ts-expect-error enum flag definitions require enumValues
			const build = () => createFlagSchema('enum');
			expect(schemaErrorCode(build)).toBe('INVALID_SCHEMA');
		});

		it('requires enumValues for positional enum arg definitions', () => {
			// @ts-expect-error enum arg definitions require enumValues
			const build = () => createArgSchema('enum');
			expect(schemaErrorCode(build)).toBe('INVALID_SCHEMA');
		});

		it('rejects duplicate policies on accumulating flag kinds', () => {
			const build = () => createFlagSchema('array', { duplicates: 'error' });
			expect(schemaErrorCode(build)).toBe('INVALID_SCHEMA');
		});

		it('rejects a command schema without a name', () => {
			const build = () => createCommandSchema({ name: '' });
			expect(schemaErrorCode(build)).toBe('INVALID_SCHEMA');
		});

		it('rejects command names containing whitespace at any depth', () => {
			expect(schemaErrorCode(() => createCommandSchema({ name: '   ' }))).toBe('INVALID_SCHEMA');
			expect(schemaErrorCode(() => createCommandSchema({ name: 'my command' }))).toBe(
				'INVALID_SCHEMA',
			);
			expect(
				schemaErrorCode(() =>
					createCommandSchema({ name: 'root', commands: [{ name: 'nested command' }] }),
				),
			).toBe('INVALID_SCHEMA');
		});

		it('validates stdin invariants in command definitions', () => {
			expect(
				schemaErrorCode(() =>
					createCommandSchema({
						name: 'copy',
						args: [{ name: 'input', schema: { kind: 'string', stdinMode: true, variadic: true } }],
					}),
				),
			).toBe('INVALID_BUILDER_STATE');

			expect(
				schemaErrorCode(() =>
					createCommandSchema({
						name: 'copy',
						args: [
							{ name: 'source', schema: { kind: 'string', stdinMode: true } },
							{ name: 'dest', schema: { kind: 'string', stdinMode: true } },
						],
					}),
				),
			).toBe('DUPLICATE_STDIN_ARG');
		});

		it('validates flag collisions across command definition trees', () => {
			const build = () =>
				createCommandSchema({
					name: 'db',
					flags: { verbose: { kind: 'boolean', aliases: ['v'], propagate: true } },
					commands: [{ name: 'migrate', flags: { version: { kind: 'boolean', aliases: ['v'] } } }],
				});
			expect(schemaErrorCode(build)).toBe('PROPAGATED_FLAG_COLLISION');
		});

		it('rejects a CLI schema without a name', () => {
			const build = () => createCLISchema({ name: '' });
			expect(schemaErrorCode(build)).toBe('INVALID_SCHEMA');
		});

		it('builds identical flag schemas from the positional and object forms', () => {
			expect(createFlagSchema('enum', { enumValues: ['us', 'eu'], description: 'Region' })).toEqual(
				createFlagSchema({ kind: 'enum', enumValues: ['us', 'eu'], description: 'Region' }),
			);
		});

		it('builds identical arg schemas from the positional and object forms', () => {
			expect(
				createArgSchema('number', { numberConstraints: { min: 1 }, presence: 'optional' }),
			).toEqual(
				createArgSchema({ kind: 'number', numberConstraints: { min: 1 }, presence: 'optional' }),
			);
		});
	});
});
