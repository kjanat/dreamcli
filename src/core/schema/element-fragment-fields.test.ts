/**
 * The fields supported by collection element schemas.
 *
 * Array flag elements retain the legacy flag fragment except input privacy and
 * default-presentation metadata. Key-value arg elements retain only value
 * fields; input settings are rejected instead of being accepted and ignored.
 *
 * @module dreamcli/core/schema/element-fragment-fields.test
 */

import { describe, expect, it } from 'vitest';
import type { CLIError } from '#internals/core/errors/index.ts';
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

describe('a flag element definition', () => {
	it('rejects input-level sensitivity metadata', () => {
		expect(() =>
			createFlagSchema('array', { elementSchema: { kind: 'string', sensitive: true } }),
		).toThrow(
			expect.objectContaining<Partial<CLIError>>({
				code: 'INVALID_SCHEMA',
				details: { kind: 'string', field: 'sensitive' },
			}),
		);
	});

	it('rejects input-level default presentation metadata', () => {
		expect(() =>
			createFlagSchema('array', {
				elementSchema: { kind: 'string', defaultDescription: false },
			}),
		).toThrow(
			expect.objectContaining<Partial<CLIError>>({
				code: 'INVALID_SCHEMA',
				details: { kind: 'string', field: 'defaultDescription' },
			}),
		);
	});

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
	it('builds with value fields set', () => {
		const schema = createArgSchema('keyValue', {
			elementSchema: {
				kind: 'string',
				stringConstraints: { nonEmpty: true },
				valueHint: 'entry-value',
			},
		});

		expect(schema.elementSchema).toMatchObject({
			kind: 'string',
			presence: 'required',
			variadic: false,
			stringConstraints: { nonEmpty: true },
			valueHint: 'entry-value',
		});
	});

	describe('positional-only fields', () => {
		it.each([
			['presence', { presence: 'optional' }],
			['variadic', { variadic: true }],
			['stdin', { stdin: {} }],
			['defaultValue', { defaultValue: 'element-default' }],
			['defaultDescription', { defaultDescription: false }],
			['sensitive', { sensitive: true }],
			['description', { description: 'an element' }],
			['envVar', { envVar: 'ELEMENT_ENV' }],
			['configPath', { configPath: 'element.path' }],
			['prompt', { prompt: { kind: 'input', message: 'Element?' } }],
			['deprecated', { deprecated: 'element deprecation' }],
		] as const)('rejects %s', (field, fields) => {
			expect(() =>
				createArgSchema('keyValue', { elementSchema: { kind: 'string', ...fields } }),
			).toThrow(
				expect.objectContaining<Partial<CLIError>>({
					code: 'INVALID_SCHEMA',
					details: { kind: 'string', field },
				}),
			);
		});
	});

	it('applies value fields while reading the positional own source', async () => {
		const schema = createCommandSchema({
			name: 'deploy',
			args: [
				{
					name: 'vars',
					schema: {
						kind: 'keyValue',
						envVar: 'VARS',
						elementSchema: {
							kind: 'string',
							stringConstraints: { pattern: /^\d+$/ },
						},
					},
				},
			],
		});

		const resolved = await resolve(schema, parse(schema, []), {
			env: { VARS: 'A=1' },
		});

		expect(resolved.args.vars).toEqual({ A: '1' });
		expect(resolved.provenance.args.vars).toEqual({ stage: 'env', envVar: 'VARS' });
	});

	it('keeps the element value schema out of positional allocation', async () => {
		const schema = createCommandSchema({
			name: 'deploy',
			args: [
				{
					name: 'vars',
					schema: { kind: 'keyValue', elementSchema: { kind: 'string' } },
				},
				{ name: 'target', schema: { kind: 'string' } },
			],
		});

		const resolved = await resolve(schema, parse(schema, ['A=1', 'prod']), {});

		expect(resolved.args).toEqual({ vars: { A: '1' }, target: 'prod' });
	});
});

// === the definition document carries the supported fragment

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
