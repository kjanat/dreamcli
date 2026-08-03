/**
 * Definition-document round trips: build, emit, rebuild, emit again, deep-equal.
 *
 * A V1 document is only worth freezing if the fields it writes are the fields a
 * definition accepts. The maximal CLI below sets every field the emitter can
 * write; the rebuild maps a fragment back to a definition and the two documents
 * must match byte for byte.
 *
 * @module dreamcli/core/json-schema/definition-round-trip.test
 */

import { describe, expect, it } from 'vitest';
import type { CLIDefinition } from '#internals/core/cli/index.ts';
import { createCLISchema } from '#internals/core/cli/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import type { ArgDefinition } from '#internals/core/schema/arg.ts';
import type { SourceSplitBinding } from '#internals/core/schema/cardinality.ts';
import type { CommandDefinition } from '#internals/core/schema/command.ts';
import type { FlagDefinition, FlagNegation } from '#internals/core/schema/flag.ts';
import type { PathChecks } from '#internals/core/schema/value-parsers.ts';
import type {
	ArgDefinitionFragmentV1,
	ArgElementFragmentV1,
	CommandDefinitionFragmentV1,
	DefinitionDocumentV1,
	FlagDefinitionFragmentV1,
	FlagNegationFragmentV1,
	FlagPathChecksFragmentV1,
	FlagStringConstraintsFragmentV1,
	SourceSplitFragmentV1,
} from './index.ts';
import { generateSchema } from './index.ts';

// === the rebuild: one fragment shape, one definition shape

/**
 * Rebuild string constraints from a fragment.
 *
 * A JSON document cannot carry a `RegExp`, so the emitter writes its source and
 * flags; this is the only field whose document shape differs from its
 * definition shape.
 */
function stringConstraintsOf(fragment: FlagStringConstraintsFragmentV1): Record<string, unknown> {
	const pattern = fragment.pattern;
	return {
		...(fragment.nonEmpty !== undefined ? { nonEmpty: fragment.nonEmpty } : {}),
		...(fragment.minLength !== undefined ? { minLength: fragment.minLength } : {}),
		...(fragment.maxLength !== undefined ? { maxLength: fragment.maxLength } : {}),
		...(pattern !== undefined ? { pattern: new RegExp(pattern.source, pattern.flags) } : {}),
	};
}

/**
 * Rebuild filesystem checks from a fragment.
 *
 * A document omits a field it has nothing to say about; a definition declares
 * every field and spells absence as `undefined`.
 */
function pathChecksOf(fragment: FlagPathChecksFragmentV1): PathChecks {
	return {
		mustExist: fragment.mustExist,
		type: fragment.type,
		create: fragment.create ?? false,
	};
}

/** Rebuild the non-CLI split policies, whose fragment leaves an unset source out. */
function splitOf(fragment: SourceSplitFragmentV1): SourceSplitBinding {
	return { env: fragment.env, stdin: fragment.stdin };
}

/** Rebuild the negated-spelling settings, whose fragment leaves the defaults out. */
function negationOf(fragment: FlagNegationFragmentV1): FlagNegation {
	return { alias: fragment.alias, hidden: fragment.hidden ?? false };
}

/** Rebuild a flag definition from the fragment the document carries. */
function flagDefinitionOf(fragment: FlagDefinitionFragmentV1): FlagDefinition {
	const { kind, stringConstraints, pathChecks, split, negation, elementSchema, ...rest } = fragment;
	const fields = {
		...rest,
		...(stringConstraints !== undefined
			? { stringConstraints: stringConstraintsOf(stringConstraints) }
			: {}),
		...(pathChecks !== undefined ? { pathChecks: pathChecksOf(pathChecks) } : {}),
		...(split !== undefined ? { split: splitOf(split) } : {}),
		...(negation !== undefined ? { negation: negationOf(negation) } : {}),
		...(elementSchema !== undefined ? { elementSchema: flagDefinitionOf(elementSchema) } : {}),
	};

	switch (kind) {
		case 'string':
			return { kind: 'string', ...fields };
		case 'number':
			return { kind: 'number', ...fields };
		case 'boolean':
			return { kind: 'boolean', ...fields };
		case 'enum':
			return { kind: 'enum', ...fields, enumValues: fragment.enumValues ?? [] };
		case 'custom':
			return { kind: 'custom', ...fields };
		case 'array':
			return { kind: 'array', ...fields };
		case 'keyValue':
			return { kind: 'keyValue', ...fields };
		case 'count':
			return { kind: 'count', ...fields };
	}
}

/** Rebuild an arg definition from the value half of a fragment. */
function argDefinitionOf(fragment: ArgElementFragmentV1): ArgDefinition {
	const { kind, stringConstraints, pathChecks, split, elementSchema, ...rest } = fragment;
	const fields = {
		...rest,
		...(stringConstraints !== undefined
			? { stringConstraints: stringConstraintsOf(stringConstraints) }
			: {}),
		...(pathChecks !== undefined ? { pathChecks: pathChecksOf(pathChecks) } : {}),
		...(split !== undefined ? { split: splitOf(split) } : {}),
		...(elementSchema !== undefined ? { elementSchema: argDefinitionOf(elementSchema) } : {}),
	};

	switch (kind) {
		case 'string':
			return { kind: 'string', ...fields };
		case 'number':
			return { kind: 'number', ...fields };
		case 'boolean':
			return { kind: 'boolean', ...fields };
		case 'enum':
			return { kind: 'enum', ...fields, enumValues: fragment.enumValues ?? [] };
		case 'custom':
			return { kind: 'custom', ...fields };
		case 'keyValue':
			return { kind: 'keyValue', ...fields };
	}
}

/** Rebuild one positional entry, whose name the array position no longer supplies. */
function argEntryOf(fragment: ArgDefinitionFragmentV1): {
	readonly name: string;
	readonly schema: ArgDefinition;
} {
	const { name, ...value } = fragment;
	return { name, schema: argDefinitionOf(value) };
}

/** Rebuild a command definition from the fragment the document carries. */
function commandDefinitionOf(fragment: CommandDefinitionFragmentV1): CommandDefinition {
	const flags: Record<string, FlagDefinition> = {};
	for (const [name, flagFragment] of Object.entries(fragment.flags)) {
		flags[name] = flagDefinitionOf(flagFragment);
	}

	return {
		name: fragment.name,
		...(fragment.description !== undefined ? { description: fragment.description } : {}),
		...(fragment.aliases !== undefined ? { aliases: fragment.aliases } : {}),
		...(fragment.hidden !== undefined ? { hidden: fragment.hidden } : {}),
		...(fragment.examples !== undefined ? { examples: fragment.examples } : {}),
		flags,
		args: fragment.args.map(argEntryOf),
		commands: fragment.commands.map(commandDefinitionOf),
		hasAction: true,
	};
}

/** Rebuild the whole CLI definition from the document. */
function cliDefinitionOf(document: DefinitionDocumentV1): CLIDefinition {
	return {
		name: document.name,
		...(document.version !== undefined ? { version: document.version } : {}),
		...(document.description !== undefined ? { description: document.description } : {}),
		...(document.defaultCommand !== undefined
			? { defaultCommand: commandDefinitionOf(document.defaultCommand) }
			: {}),
		commands: document.commands.map(commandDefinitionOf),
	};
}

// === the maximal schema

/** A CLI that sets every field the definition emitter can write. */
function maximalDefinition(): CLIDefinition {
	return {
		name: 'maximal',
		version: '4.0.0',
		description: 'Every field a V1 document carries',
		defaultCommand: {
			name: 'root',
			description: 'The default command',
			hasAction: true,
			flags: { quietly: { kind: 'boolean', presence: 'defaulted', defaultValue: false } },
		},
		commands: [
			{
				name: 'deploy',
				description: 'Ship the build',
				aliases: ['ship'],
				hidden: true,
				hasAction: true,
				examples: [
					{ command: 'deploy prod', description: 'the usual' },
					{ command: 'deploy staging' },
				],
				flags: {
					region: {
						kind: 'enum',
						presence: 'defaulted',
						defaultValue: 'us',
						enumValues: ['us', 'eu', 'ap'],
						aliases: ['r'],
						envVar: 'REGION',
						configPath: 'deploy.region',
						description: 'Target region',
						prompt: {
							kind: 'select',
							message: 'Where?',
							choices: [{ value: 'us', label: 'United States', description: 'the default' }],
						},
						deprecated: 'use --location',
						propagate: true,
						duplicates: 'error',
					},
					force: {
						kind: 'boolean',
						presence: 'optional',
						negation: { alias: 'no-force', hidden: true },
					},
					name: {
						kind: 'string',
						presence: 'required',
						stringConstraints: {
							nonEmpty: true,
							minLength: 2,
							maxLength: 32,
							pattern: /^[a-z][a-z0-9-]*$/iu,
						},
						prompt: { kind: 'input', message: 'Name?', placeholder: 'svc-1' },
					},
					out: {
						kind: 'string',
						presence: 'optional',
						pathChecks: { mustExist: true, type: 'directory', create: true },
						valueHint: 'path',
						stdin: { when: 'dash', consume: 'broadcast', trim: true },
					},
					retries: {
						kind: 'number',
						presence: 'defaulted',
						defaultValue: 3,
						numberConstraints: { min: 0, max: 10, int: true, finite: true },
					},
					tag: {
						kind: 'array',
						presence: 'optional',
						elementSchema: { kind: 'string', stringConstraints: { nonEmpty: true } },
						separator: ',',
						split: { env: { format: 'json' }, stdin: { format: 'delimiter', delimiter: ';' } },
						unique: true,
						prompt: {
							kind: 'multiselect',
							message: 'Which tags?',
							choices: [{ value: 'api' }, { value: 'web', label: 'Web' }],
							min: 1,
							max: 2,
						},
					},
					define: {
						kind: 'keyValue',
						presence: 'optional',
						elementSchema: { kind: 'number', numberConstraints: { min: 1 } },
						duplicateKeys: 'error',
					},
					verbose: { kind: 'count', presence: 'optional', aliases: ['v'] },
					confirmed: {
						kind: 'boolean',
						presence: 'optional',
						prompt: { kind: 'confirm', message: 'Sure?' },
					},
				},
				args: [
					{
						name: 'target',
						schema: {
							kind: 'enum',
							presence: 'required',
							enumValues: ['prod', 'staging'],
							description: 'Where to ship',
							envVar: 'TARGET',
							configPath: 'deploy.target',
							deprecated: true,
						},
					},
					{
						name: 'vars',
						schema: {
							kind: 'keyValue',
							presence: 'optional',
							elementSchema: { kind: 'string', presence: 'optional' },
							duplicateKeys: 'first',
							separator: ',',
							split: { env: { format: 'lines' }, stdin: undefined },
							prompt: { kind: 'input', message: 'Vars?' },
						},
					},
					{
						name: 'files',
						schema: {
							kind: 'string',
							presence: 'optional',
							variadic: true,
							defaultValue: ['a.txt'],
							pathChecks: { mustExist: true, type: undefined, create: false },
							valueHint: 'path',
							unique: true,
							stdin: { when: 'missing', consume: 'broadcast', trim: false },
						},
					},
				],
				commands: [
					{
						name: 'rollback',
						hasAction: true,
						flags: { steps: { kind: 'number', presence: 'defaulted', defaultValue: 1 } },
						args: [{ name: 'release', schema: { kind: 'string', presence: 'optional' } }],
						commands: [{ name: 'dry', hasAction: true }],
					},
				],
			},
		],
	};
}

// === the round trip

describe('a maximal definition document', () => {
	const first = generateSchema(createCLISchema(maximalDefinition()));
	const second = generateSchema(createCLISchema(cliDefinitionOf(first)));

	it('emits the same document after a rebuild', () => {
		expect(second).toEqual(first);
	});

	it('survives a JSON round trip on the way through', () => {
		const parsed: unknown = JSON.parse(JSON.stringify(first));
		expect(parsed).toEqual(first);
	});

	it('carries every field the emitter can write', () => {
		const deploy = first.commands[0];
		const flags = deploy?.flags ?? {};

		expect(Object.keys(flags).sort()).toEqual([
			'confirmed',
			'define',
			'force',
			'name',
			'out',
			'region',
			'retries',
			'tag',
			'verbose',
		]);
		expect(new Set(Object.keys(flags.region ?? {}))).toEqual(
			new Set([
				'kind',
				'presence',
				'defaultValue',
				'aliases',
				'envVar',
				'configPath',
				'description',
				'enumValues',
				'prompt',
				'deprecated',
				'propagate',
				'duplicates',
			]),
		);
		expect(new Set(Object.keys(flags.tag ?? {}))).toEqual(
			new Set(['kind', 'presence', 'elementSchema', 'separator', 'split', 'unique', 'prompt']),
		);
		expect(new Set(Object.keys(deploy?.args[2] ?? {}))).toEqual(
			new Set([
				'name',
				'kind',
				'presence',
				'variadic',
				'stdin',
				'defaultValue',
				'pathChecks',
				'valueHint',
				'unique',
			]),
		);
	});
});

// === the rebuilt schema resolves what the original resolved

describe('a rebuilt command', () => {
	/** Resolve one CLI's only command against an empty argv. */
	async function resolvedValues(
		definition: CLIDefinition,
	): Promise<{ readonly flags: unknown; readonly args: unknown }> {
		const schema = createCLISchema(definition).commands[0];
		if (schema === undefined) throw new Error('the CLI declared no command');
		const resolved = await resolve(schema, parse(schema, []), {});
		return { flags: resolved.flags, args: resolved.args };
	}

	it('keeps a default a definition declared without the defaulted presence', async () => {
		const original: CLIDefinition = {
			name: 'defaults',
			commands: [
				{
					name: 'build',
					hasAction: true,
					flags: { out: { kind: 'string', defaultValue: 'dist' } },
					args: [
						{ name: 'files', schema: { kind: 'string', variadic: true, defaultValue: ['a'] } },
					],
				},
			],
		};

		const before = await resolvedValues(original);
		const after = await resolvedValues(cliDefinitionOf(generateSchema(createCLISchema(original))));

		expect(before).toEqual({ flags: { out: 'dist' }, args: { files: ['a'] } });
		expect(after).toEqual(before);
	});
});

// === what a document deliberately drops

describe('the fields a document cannot carry', () => {
	const document = generateSchema(
		createCLISchema({
			name: 'lossy',
			commands: [
				{
					name: 'run',
					hasAction: true,
					flags: {
						hex: {
							kind: 'custom',
							parseFn: (raw) => Number.parseInt(String(raw), 16),
							standard: {
								'~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
							},
						},
						silent: { kind: 'boolean', aliases: [{ name: 's', hidden: true }] },
						sink: { kind: 'custom', presence: 'defaulted', defaultValue: () => 42 },
					},
				},
			],
		}),
	);

	it('drops the runtime callables and the hidden alias', () => {
		expect(document.commands[0]?.flags).toEqual({
			hex: { kind: 'custom', presence: 'optional' },
			silent: { kind: 'boolean', presence: 'optional' },
			sink: { kind: 'custom', presence: 'defaulted' },
		});
	});

	it('rebuilds into a schema that keeps everything the document did carry', () => {
		const rebuilt = createCLISchema(cliDefinitionOf(document));

		expect(generateSchema(rebuilt)).toEqual(document);
	});
});
