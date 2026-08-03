/**
 * Source fields on an element schema: what V1 admits and what nothing reads.
 *
 * An element definition accepts every field a whole input accepts, because V1
 * describes elements with the same fragment shape. No element reader consumes
 * the source half of that shape, so the fields validate, survive the definition
 * document, and change nothing at resolution.
 *
 * @module dreamcli/core/schema/element-fragment-fields.test
 */

import { describe, expect, it } from 'vitest';
import { generateCommandSchema } from '#internals/core/json-schema/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import { arg, createArgSchema } from './arg.ts';
import { createCommandSchema } from './command.ts';
import { createFlagSchema, flag } from './flag.ts';

// === the fields an element definition admits

/** Every source field a flag element definition may carry. */
const FLAG_ELEMENT_SOURCES = {
	presence: 'required',
	defaultValue: 'element-default',
	envVar: 'ELEMENT_ENV',
	configPath: 'element.path',
	stdin: {},
	prompt: { kind: 'input', message: 'Element?' },
	description: 'an element',
	deprecated: 'element deprecation',
} as const;

/** Every source field an arg element definition may carry. */
const ARG_ELEMENT_SOURCES = {
	presence: 'required',
	defaultValue: 'element-default',
	envVar: 'ELEMENT_ENV',
	configPath: 'element.path',
	stdin: {},
	prompt: { kind: 'input', message: 'Element?' },
	description: 'an element',
	deprecated: 'element deprecation',
} as const;

describe('a flag element definition', () => {
	it('builds with every source field set', () => {
		const schema = createFlagSchema('array', {
			elementSchema: { kind: 'string', ...FLAG_ELEMENT_SOURCES },
		});

		expect(schema.elementSchema).toMatchObject({
			kind: 'string',
			presence: 'required',
			defaultValue: 'element-default',
			envVar: 'ELEMENT_ENV',
			configPath: 'element.path',
			stdin: { when: 'dash-or-missing', consume: 'exclusive', trim: false },
			prompt: { kind: 'input', message: 'Element?' },
		});
	});

	it('leaves resolution reading the collection own sources alone', async () => {
		const schema = createCommandSchema({
			name: 'deploy',
			flags: {
				tags: {
					kind: 'array',
					envVar: 'TAGS',
					elementSchema: { kind: 'string', ...FLAG_ELEMENT_SOURCES },
				},
			},
		});

		const resolved = await resolve(schema, parse(schema, []), {
			env: { TAGS: 'a,b', ELEMENT_ENV: 'from-the-element' },
			config: { element: { path: 'from-the-element' } },
		});

		expect(resolved.flags.tags).toEqual(['a', 'b']);
		expect(resolved.provenance.flags.tags).toEqual({ stage: 'env', envVar: 'TAGS' });
	});

	it('leaves an absent collection at its own default, not the element one', async () => {
		const schema = createCommandSchema({
			name: 'deploy',
			flags: {
				tags: {
					kind: 'array',
					defaultValue: ['collection-default'],
					elementSchema: { kind: 'string', ...FLAG_ELEMENT_SOURCES },
				},
			},
		});

		const resolved = await resolve(schema, parse(schema, []), {});

		expect(resolved.flags.tags).toEqual(['collection-default']);
	});

	it('keeps an element stdin binding out of the exclusivity rule and out of the pipe', async () => {
		const schema = createCommandSchema({
			name: 'deploy',
			flags: {
				tags: { kind: 'array', elementSchema: { kind: 'string', stdin: {} } },
				body: { kind: 'string', stdin: {} },
			},
		});

		const resolved = await resolve(schema, parse(schema, []), { stdinData: 'piped' });

		expect(resolved.flags).toEqual({ body: 'piped', tags: [] });
		expect(resolved.provenance.flags.tags).toEqual({ stage: 'default' });
	});
});

describe('an arg element definition', () => {
	it('builds with every source field set', () => {
		const schema = createArgSchema('keyValue', {
			elementSchema: { kind: 'string', ...ARG_ELEMENT_SOURCES },
		});

		expect(schema.elementSchema).toMatchObject({
			kind: 'string',
			presence: 'required',
			defaultValue: 'element-default',
			envVar: 'ELEMENT_ENV',
			configPath: 'element.path',
			stdin: { when: 'dash-or-missing', consume: 'exclusive', trim: false },
		});
	});

	it('validates an element in isolation, so a variadic marker demands an array default', () => {
		expect(() =>
			createArgSchema('keyValue', {
				elementSchema: { kind: 'string', variadic: true, defaultValue: 'element-default' },
			}),
		).toThrow(/Default value for a string argument is invalid: expected an array/);

		expect(
			createArgSchema('keyValue', {
				elementSchema: { kind: 'string', variadic: true, defaultValue: ['element-default'] },
			}).elementSchema,
		).toMatchObject({ variadic: true, defaultValue: ['element-default'] });
	});

	it('leaves resolution reading the positional own sources alone', async () => {
		const schema = createCommandSchema({
			name: 'deploy',
			args: [
				{
					name: 'vars',
					schema: {
						kind: 'keyValue',
						envVar: 'VARS',
						elementSchema: { kind: 'string', ...ARG_ELEMENT_SOURCES },
					},
				},
			],
		});

		const resolved = await resolve(schema, parse(schema, []), {
			env: { VARS: 'A=1', ELEMENT_ENV: 'from-the-element' },
		});

		expect(resolved.args.vars).toEqual({ A: '1' });
		expect(resolved.provenance.args.vars).toEqual({ stage: 'env', envVar: 'VARS' });
	});

	it('keeps an element variadic marker off the positional allocation', async () => {
		const schema = createCommandSchema({
			name: 'deploy',
			args: [
				{
					name: 'vars',
					schema: { kind: 'keyValue', elementSchema: { kind: 'string', variadic: true } },
				},
				{ name: 'target', schema: { kind: 'string' } },
			],
		});

		const resolved = await resolve(schema, parse(schema, ['A=1', 'prod']), {});

		expect(resolved.args).toEqual({ vars: { A: '1' }, target: 'prod' });
	});
});

// === the definition document carries them, and a rebuild keeps them

describe('the definition document', () => {
	it('emits the element source fields a flag definition declared', () => {
		const schema = createCommandSchema({
			name: 'deploy',
			flags: {
				tags: { kind: 'array', elementSchema: { kind: 'string', ...FLAG_ELEMENT_SOURCES } },
			},
		});

		expect(generateCommandSchema(schema).flags.tags?.elementSchema).toEqual({
			kind: 'string',
			presence: 'required',
			defaultValue: 'element-default',
			envVar: 'ELEMENT_ENV',
			configPath: 'element.path',
			stdin: { when: 'dash-or-missing', consume: 'exclusive', trim: false },
			prompt: { kind: 'input', message: 'Element?' },
			description: 'an element',
			deprecated: 'element deprecation',
		});
	});

	it('rebuilds the same element from what it emitted', () => {
		const built = createFlagSchema('array', {
			elementSchema: { kind: 'string', ...FLAG_ELEMENT_SOURCES },
		});
		const document = generateCommandSchema(
			createCommandSchema({ name: 'deploy', flags: { tags: built } }),
		);
		const fragment = document.flags.tags?.elementSchema;
		if (fragment === undefined) throw new Error('the document emitted no element');

		expect(fragment.prompt).toEqual(FLAG_ELEMENT_SOURCES.prompt);
		const rebuilt = createFlagSchema('array', {
			elementSchema: {
				kind: 'string',
				presence: fragment.presence,
				defaultValue: fragment.defaultValue,
				envVar: fragment.envVar,
				configPath: fragment.configPath,
				stdin: fragment.stdin,
				description: fragment.description,
				deprecated: fragment.deprecated,
				prompt: FLAG_ELEMENT_SOURCES.prompt,
			},
		});

		expect(rebuilt).toEqual(built);
	});

	it('emits kind and presence alone for an element a builder produced, which carries no sources', () => {
		const schema = createCommandSchema({
			name: 'deploy',
			flags: { tags: flag.array(flag.string()).schema },
		});

		expect(generateCommandSchema(schema).flags.tags?.elementSchema).toEqual({
			kind: 'string',
			presence: 'optional',
		});
	});

	it('emits kind and presence alone for an arg element a builder produced too', () => {
		const schema = createCommandSchema({
			name: 'deploy',
			args: [{ name: 'vars', schema: arg.keyValue(arg.number()).schema }],
		});

		expect(generateCommandSchema(schema).args[0]?.elementSchema).toEqual({
			kind: 'number',
			presence: 'required',
		});
	});
});
