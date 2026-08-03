import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { arg, createArgSchema } from './arg.ts';
import type { SplitPolicy } from './cardinality.ts';
import { command, createCommandSchema } from './command.ts';
import { createFlagSchema, flag } from './flag.ts';
import { sourceBindings, stdinBindingOf } from './source.ts';

// === L15 — one exclusive stdin consumer per command

// --- helpers

const WHOLE: SplitPolicy = { format: 'whole' };
const LINES: SplitPolicy = { format: 'lines' };
const COMMAS: SplitPolicy = { format: 'delimiter', delimiter: ',' };

function schemaError(build: () => unknown): CLIError {
	try {
		build();
	} catch (error) {
		if (error instanceof CLIError) return error;
		throw error;
	}
	throw new Error('expected the schema to be rejected');
}

// --- builder construction path

describe('builder path', () => {
	it('rejects a second stdin arg', () => {
		const error = schemaError(() =>
			command('run').arg('first', arg.string().stdin()).arg('second', arg.string().stdin()),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.message).toBe(
			'Only one input may consume stdin exclusively; <first> already consumes stdin',
		);
		expect(error.details).toEqual({ command: 'run', arg: 'second', existingArg: 'first' });
	});

	it('rejects a second stdin flag', () => {
		const error = schemaError(() =>
			command('run').flag('first', flag.string().stdin()).flag('second', flag.string().stdin()),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.details).toEqual({ command: 'run', flag: 'second', existingFlag: 'first' });
	});

	it('rejects a stdin arg declared after a stdin flag', () => {
		const error = schemaError(() =>
			command('run').flag('body', flag.string().stdin()).arg('input', arg.string().stdin()),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.message).toBe(
			'Only one input may consume stdin exclusively; --body already consumes stdin',
		);
		expect(error.details).toEqual({ command: 'run', arg: 'input', existingFlag: 'body' });
	});

	it('rejects a stdin flag declared after a stdin arg', () => {
		const error = schemaError(() =>
			command('run').arg('input', arg.string().stdin()).flag('body', flag.string().stdin()),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.details).toEqual({ command: 'run', flag: 'body', existingArg: 'input' });
	});

	it('rejects an exclusive consumer beside a broadcast one', () => {
		const error = schemaError(() =>
			command('run')
				.flag('body', flag.string().stdin({ consume: 'broadcast' }))
				.arg('input', arg.string().stdin()),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.message).toBe(
			'Only one input may consume stdin exclusively; --body already consumes stdin',
		);
	});

	it('accepts several broadcast consumers across both surfaces', () => {
		const schema = command('run')
			.flag('body', flag.string().stdin({ consume: 'broadcast' }))
			.flag('note', flag.string().stdin({ consume: 'broadcast' }))
			.arg('input', arg.string().stdin({ consume: 'broadcast' }))
			.action(() => {}).schema;

		expect(schema.flags.body?.stdin).toEqual({
			when: 'dash-or-missing',
			consume: 'broadcast',
			trim: false,
		});
		expect(schema.args[0]?.schema.stdin).toEqual({
			when: 'dash-or-missing',
			consume: 'broadcast',
			trim: false,
		});
	});

	it('counts a variadic stdin arg as a stdin consumer', () => {
		const error = schemaError(() =>
			command('run')
				.flag('body', flag.string().stdin())
				.arg('files', arg.string().variadic().stdin()),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
	});
});

// --- definition construction path

describe('definition path', () => {
	it('rejects two stdin flags', () => {
		const error = schemaError(() =>
			createCommandSchema({
				name: 'run',
				flags: { first: { kind: 'string', stdin: {} }, second: { kind: 'string', stdin: {} } },
			}),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.details).toEqual({ command: 'run', flag: 'second', existingFlag: 'first' });
	});

	it('rejects a stdin flag paired with a stdin arg', () => {
		const error = schemaError(() =>
			createCommandSchema({
				name: 'run',
				flags: { body: { kind: 'string', stdin: {} } },
				args: [{ name: 'input', schema: { kind: 'string', stdin: {} } }],
			}),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.details).toEqual({ command: 'run', arg: 'input', existingFlag: 'body' });
	});

	it('rejects the same pair on a nested subcommand', () => {
		const error = schemaError(() =>
			createCommandSchema({
				name: 'db',
				commands: [
					{
						name: 'migrate',
						flags: { body: { kind: 'string', stdin: {} } },
						args: [{ name: 'input', schema: { kind: 'string', stdin: {} } }],
					},
				],
			}),
		);

		expect(error.code).toBe('DUPLICATE_STDIN_INPUT');
		expect(error.details).toMatchObject({ command: 'migrate' });
	});

	it('accepts broadcast consumers on both surfaces', () => {
		const schema = createCommandSchema({
			name: 'run',
			flags: { body: { kind: 'string', stdin: { consume: 'broadcast' } } },
			args: [{ name: 'input', schema: { kind: 'string', stdin: { consume: 'broadcast' } } }],
		});

		expect(schema.flags.body?.stdin?.consume).toBe('broadcast');
	});

	it('accepts a stdin binding on a collection flag kind', () => {
		const schema = createCommandSchema({
			name: 'run',
			flags: { tags: { kind: 'array', stdin: {} } },
		});

		expect(schema.flags.tags?.stdin?.when).toBe('dash-or-missing');
	});

	it('rejects a stdin binding on a count flag', () => {
		const error = schemaError(() =>
			createCommandSchema({ name: 'run', flags: { verbose: { kind: 'count', stdin: {} } } }),
		);

		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Flag schema field 'stdin' is not available on kind 'count'");
	});

	it('rejects an unknown stdin trigger mode', () => {
		const error = schemaError(() =>
			createCommandSchema({
				name: 'run',
				// @ts-expect-error the union rejects this spelling at compile time too
				flags: { body: { kind: 'string', stdin: { when: 'always' } } },
			}),
		);

		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toBe("Unknown stdin mode 'always'");
	});

	it('re-normalizes a built schema without tripping the exclusivity rule', () => {
		const built = createCommandSchema({
			name: 'run',
			flags: { body: { kind: 'string', stdin: {} } },
		});

		expect(createCommandSchema(built)).toEqual(built);
	});
});

// --- the source projection

describe('sourceBindings()', () => {
	it('lists a flag chain in precedence order', () => {
		const schema = flag
			.string()
			.stdin()
			.env('VALUE')
			.config('deploy.value')
			.prompt({ kind: 'input', message: 'Value' })
			.default('fallback').schema;

		expect(sourceBindings(schema)).toEqual([
			{ stage: 'cli', split: WHOLE },
			{
				stage: 'stdin',
				when: 'dash-or-missing',
				consume: 'exclusive',
				trim: false,
				split: LINES,
			},
			{ stage: 'env', envVar: 'VALUE', split: COMMAS },
			{ stage: 'config', configPath: 'deploy.value', split: COMMAS },
			{ stage: 'prompt', prompt: { kind: 'input', message: 'Value' }, split: COMMAS },
			{ stage: 'default', defaultValue: 'fallback' },
		]);
	});

	it('lists an arg chain in the same order', () => {
		const schema = arg
			.string()
			.stdin({ when: 'dash' })
			.env('VALUE')
			.config('deploy.value')
			.default('fallback').schema;

		expect(sourceBindings(schema)).toEqual([
			{ stage: 'cli', split: WHOLE },
			{ stage: 'stdin', when: 'dash', consume: 'exclusive', trim: false, split: LINES },
			{ stage: 'env', envVar: 'VALUE', split: COMMAS },
			{ stage: 'config', configPath: 'deploy.value', split: COMMAS },
			{ stage: 'default', defaultValue: 'fallback' },
		]);
	});

	it('lists CLI alone for an input with no extra sources', () => {
		expect(sourceBindings(flag.string().schema)).toEqual([{ stage: 'cli', split: WHOLE }]);
	});

	it('lists a default a definition declared without the defaulted presence', () => {
		const flagSchema = createFlagSchema({ kind: 'string', defaultValue: 'x' });
		const argSchema = createArgSchema('string', { defaultValue: 'y' });

		expect(flagSchema.presence).toBe('optional');
		expect(sourceBindings(flagSchema)).toEqual([
			{ stage: 'cli', split: WHOLE },
			{ stage: 'default', defaultValue: 'x' },
		]);
		expect(sourceBindings(argSchema)).toEqual([
			{ stage: 'cli', split: WHOLE },
			{ stage: 'default', defaultValue: 'y' },
		]);
	});

	it('carries each source its own split policy', () => {
		const schema = flag
			.array(flag.string())
			.separator(',')
			.split({ env: 'json', stdin: ';' })
			.stdin({ trim: true })
			.env('TAGS').schema;

		expect(sourceBindings(schema)).toEqual([
			{ stage: 'cli', split: COMMAS },
			{
				stage: 'stdin',
				when: 'dash-or-missing',
				consume: 'exclusive',
				trim: true,
				split: { format: 'delimiter', delimiter: ';' },
			},
			{ stage: 'env', envVar: 'TAGS', split: { format: 'json' } },
		]);
	});

	it('answers which binding carries stdin', () => {
		const withStdin = sourceBindings(flag.string().stdin({ when: 'dash' }).schema);
		expect(stdinBindingOf(withStdin)).toEqual({
			stage: 'stdin',
			when: 'dash',
			consume: 'exclusive',
			trim: false,
			split: LINES,
		});
		expect(stdinBindingOf(sourceBindings(flag.string().schema))).toBeUndefined();
	});
});
