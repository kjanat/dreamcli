/**
 * JSON Schema for validating DreamCLI definition documents.
 *
 * @module dreamcli/core/json-schema/definition-meta-schema
 */

import type { schemaBrand } from '#internals/core/schema/brand.ts';
import { DUPLICATE_KEYS } from '#internals/core/schema/cardinality.ts';
import { CONSTRAINT_KINDS } from '#internals/core/schema/constraints.ts';
import type { ArgSchema, FlagSchema, NumberConstraints } from '#internals/core/schema/index.ts';
import {
	DEFINITION_SCHEMA_URL,
	DEFINITION_SCHEMA_VERSION,
	JSON_SCHEMA_DRAFT,
} from './constants.ts';
import type {
	ArgDefinitionFragmentV1,
	ArgElementFragmentV1,
	CommandDefinitionFragmentV1,
	DefinitionDocumentV1,
	EnvIndexedFragmentV1,
	ExampleDefinitionFragmentV1,
	FlagDefinitionFragmentV1,
	FlagElementFragmentV1,
	FlagNegationFragmentV1,
	FlagPathChecksFragmentV1,
	FlagStringConstraintsFragmentV1,
	PromptChoiceFragmentV1,
	PromptDefinitionFragmentV1,
	SourceSplitFragmentV1,
	SplitPolicyFragmentV1,
	StdinBindingFragmentV1,
} from './index.ts';
import { isPlainJsonObject } from './index.ts';
import { definitionMetaSchemaDescriptions } from './meta-descriptions.generated.ts';

/**
 * One meta-schema `properties` object, keyed by every field its fragment can
 * carry.
 *
 * A fragment that is a union contributes the keys of each member, so a policy
 * spelled as `{ format: 'whole' } | { format: 'delimiter'; delimiter: string }`
 * requires both.
 */
type FragmentProperties<T> = Record<FragmentKey<T>, Record<string, unknown>>;

/** Every key a fragment can carry, across the members of a union. */
type FragmentKey<T> = T extends unknown ? keyof T : never;

/**
 * Fields no document holds: those carrying a runtime function, and
 * `envFromName`, which registration on a command resolves into `envVar`.
 */
type UnserializableField =
	| typeof schemaBrand
	| 'completion'
	| 'parseFn'
	| 'standard'
	| 'aggregateStandard'
	| 'envFromName';

/** Flag fields that survive definition serialization. */
type SerializedFlagField = Exclude<keyof FlagSchema, UnserializableField>;

/** Arg fields that survive definition serialization, plus the entry's own name. */
type SerializedArgField = 'name' | Exclude<keyof ArgSchema, UnserializableField>;

interface DefinitionMetaSchemaDescriptionNode {
	readonly description?: string;
	readonly properties?: Readonly<Record<string, DefinitionMetaSchemaDescriptionNode>>;
}

function withDefinitionDescriptions(
	schema: Record<string, unknown>,
	descriptions: DefinitionMetaSchemaDescriptionNode,
): Record<string, unknown> {
	const propertiesValue = schema.properties;
	const describedProperties =
		typeof propertiesValue === 'object' &&
		propertiesValue !== null &&
		isPlainJsonObject(propertiesValue) &&
		descriptions.properties !== undefined
			? Object.fromEntries(
					Object.entries(propertiesValue).map(([name, propertySchema]) => {
						const propertyDescriptions = descriptions.properties?.[name];
						if (
							propertyDescriptions === undefined ||
							typeof propertySchema !== 'object' ||
							propertySchema === null ||
							!isPlainJsonObject(propertySchema)
						) {
							return [name, propertySchema];
						}

						return [name, withDefinitionDescriptions(propertySchema, propertyDescriptions)];
					}),
				)
			: undefined;

	return {
		...schema,
		...(descriptions.description !== undefined ? { description: descriptions.description } : {}),
		...(describedProperties !== undefined ? { properties: describedProperties } : {}),
	};
}

function withDefinitionMetaSchemaDescriptions(
	schema: Record<string, unknown>,
	descriptions: {
		readonly root: DefinitionMetaSchemaDescriptionNode;
		readonly defs: Readonly<Record<string, DefinitionMetaSchemaDescriptionNode>>;
	},
): Record<string, unknown> {
	const describedRoot = withDefinitionDescriptions(schema, descriptions.root);
	const defsValue = describedRoot.$defs;
	if (typeof defsValue !== 'object' || defsValue === null || !isPlainJsonObject(defsValue)) {
		return describedRoot;
	}

	return {
		...describedRoot,
		$defs: Object.fromEntries(
			Object.entries(defsValue).map(([name, defSchema]) => {
				const defDescriptions = descriptions.defs[name];
				if (
					defDescriptions === undefined ||
					typeof defSchema !== 'object' ||
					defSchema === null ||
					!isPlainJsonObject(defSchema)
				) {
					return [name, defSchema];
				}

				return [name, withDefinitionDescriptions(defSchema, defDescriptions)];
			}),
		),
	};
}

/** The `envPrefix` property schema shared by both standalone document roots. */
const ENV_PREFIX_PROPERTY = { type: 'string', minLength: 1, not: { pattern: '[={}]' } } as const;
const GROUP_ORDER_PROPERTY = { type: 'array', items: { type: 'string' } } as const;

/**
 * Command-fragment property schemas shared by the nested `command` def and
 * the standalone `commandDocument` def, so the two cannot drift.
 */
const commandFragmentProperties = {
	name: { type: 'string' },
	description: { type: 'string' },
	details: { type: 'string' },
	aliases: { type: 'array', items: { type: 'string' } },
	hidden: { const: true },
	examples: { type: 'array', items: { $ref: '#/$defs/example' } },
	flags: { type: 'object', additionalProperties: { $ref: '#/$defs/flag' } },
	flagDeclarationOrder: { type: 'array', items: { type: 'string' }, uniqueItems: true },
	args: { type: 'array', items: { $ref: '#/$defs/arg' } },
	constraints: {
		type: 'array',
		items: {
			type: 'object',
			additionalProperties: false,
			required: ['kind', 'inputs'],
			properties: {
				kind: { enum: CONSTRAINT_KINDS },
				inputs: {
					type: 'array',
					minItems: 2,
					uniqueItems: true,
					items: { $ref: '#/$defs/constraintInput' },
				},
			},
			anyOf: [
				{ properties: { kind: { enum: ['conflicts', 'requires'] }, inputs: { maxItems: 2 } } },
				{ properties: { kind: { enum: ['exactlyOne', 'atMostOne', 'allOrNone'] } } },
			],
		},
	},
	commands: { type: 'array', items: { $ref: '#/$defs/command' } },
} as const satisfies FragmentProperties<CommandDefinitionFragmentV1>;

/**
 * Property schemas carried by a named positional definition.
 */
const argValueFragmentProperties = {
	kind: { enum: ['string', 'number', 'boolean', 'enum', 'custom', 'keyValue'] },
	presence: { enum: ['required', 'optional', 'defaulted'] },
	variadic: { const: true },
	stdin: { $ref: '#/$defs/stdin' },
	defaultValue: {},
	defaultDescription: { oneOf: [{ type: 'string' }, { const: false }] },
	sensitive: { const: true },
	description: { type: 'string' },
	group: { type: 'string' },
	envVar: { type: 'string' },
	envIndexed: { $ref: '#/$defs/envIndexed' },
	envAbsolute: { const: true },
	envEmpty: { const: 'missing' },
	configPath: { type: 'string' },
	enumValues: { type: 'array', items: { type: 'string' } },
	elementSchema: { $ref: '#/$defs/argElement' },
	numberConstraints: { $ref: '#/$defs/numberConstraints' },
	stringConstraints: { $ref: '#/$defs/stringConstraints' },
	pathChecks: { $ref: '#/$defs/pathChecks' },
	valueHint: { type: 'string' },
	separator: { type: 'string', minLength: 1 },
	split: { $ref: '#/$defs/split' },
	duplicateKeys: { enum: [...DUPLICATE_KEYS] },
	unique: { const: true },
	prompt: { $ref: '#/$defs/prompt' },
	deprecated: { oneOf: [{ type: 'string' }, { const: true }] },
} as const satisfies FragmentProperties<Omit<ArgDefinitionFragmentV1, 'name'>> &
	Record<Exclude<SerializedArgField, 'name'>, Record<string, unknown>>;

/** Property schemas supported by a key-value entry element. */
const argElementFragmentProperties = {
	kind: { enum: ['string', 'number', 'boolean', 'enum', 'custom'] },
	presence: { const: 'required' },
	enumValues: { type: 'array', items: { type: 'string' } },
	numberConstraints: { $ref: '#/$defs/numberConstraints' },
	stringConstraints: { $ref: '#/$defs/stringConstraints' },
	pathChecks: { $ref: '#/$defs/pathChecks' },
	valueHint: { type: 'string' },
} as const satisfies FragmentProperties<ArgElementFragmentV1>;

/** Property schemas supported by a collection flag element. */
const flagElementFragmentProperties = {
	kind: {
		enum: ['string', 'number', 'boolean', 'enum', 'array', 'custom', 'count', 'keyValue'],
	},
	presence: { enum: ['optional', 'required', 'defaulted'] },
	defaultValue: {},
	aliases: { type: 'array', items: { type: 'string' } },
	stdin: { $ref: '#/$defs/stdin' },
	envVar: { type: 'string' },
	envIndexed: { $ref: '#/$defs/envIndexed' },
	envAbsolute: { const: true },
	configPath: { type: 'string' },
	description: { type: 'string' },
	enumValues: { type: 'array', items: { type: 'string' } },
	numberConstraints: { $ref: '#/$defs/numberConstraints' },
	stringConstraints: { $ref: '#/$defs/stringConstraints' },
	elementSchema: { $ref: '#/$defs/flagElement' },
	separator: { type: 'string', minLength: 1 },
	split: { $ref: '#/$defs/split' },
	duplicateKeys: { enum: [...DUPLICATE_KEYS] },
	unique: { const: true },
	pathChecks: { $ref: '#/$defs/pathChecks' },
	valueHint: { type: 'string' },
	prompt: { $ref: '#/$defs/prompt' },
	deprecated: { oneOf: [{ type: 'string' }, { const: true }] },
	propagate: { const: true },
	negation: { $ref: '#/$defs/negation' },
	separateValue: { const: true },
	variadic: { const: true },
	duplicates: { enum: ['last', 'first', 'error'] },
} as const satisfies FragmentProperties<FlagElementFragmentV1>;

/** Property schemas supported by a top-level flag definition. */
const flagFragmentProperties = {
	...flagElementFragmentProperties,
	envEmpty: { const: 'missing' },
	allowHyphenValues: { const: true },
	completionValues: { type: 'array', items: { type: 'string' } },
	defaultDescription: { oneOf: [{ type: 'string' }, { const: false }] },
	sensitive: { const: true },
	group: { type: 'string' },
	advanced: { const: true },
} as const satisfies FragmentProperties<FlagDefinitionFragmentV1> &
	Record<SerializedFlagField, Record<string, unknown>>;

/**
 * JSON Schema (draft 2020-12) that validates the output of {@link generateSchema}.
 *
 * Hosted at {@link DEFINITION_SCHEMA_URL} for `$schema` resolution. Also
 * exported so tooling can validate definition documents without a network
 * round-trip.
 *
 * @example
 * ```ts
 * import Ajv from 'ajv/dist/2020';
 * import { definitionMetaSchema, generateSchema } from '@kjanat/dreamcli';
 *
 * const ajv = new Ajv();
 * const validate = ajv.compile(definitionMetaSchema);
 * const valid = validate(generateSchema(myCli.schema));
 * ```
 */
const definitionMetaSchema: Record<string, unknown> = withDefinitionMetaSchemaDescriptions(
	{
		$schema: JSON_SCHEMA_DRAFT,
		$id: DEFINITION_SCHEMA_URL,
		title: '@kjanat/dreamcli definition schema',
		description:
			'Describes the structure of a CLI built with dreamcli — commands, flags, args, types, constraints, env bindings, and prompts.',
		type: 'object',
		additionalProperties: false,
		properties: {
			$schema: { const: DEFINITION_SCHEMA_URL },
			schemaVersion: { const: DEFINITION_SCHEMA_VERSION },
			name: { type: 'string' },
			version: { type: 'string' },
			description: { type: 'string' },
			envPrefix: ENV_PREFIX_PROPERTY,
			groupOrder: GROUP_ORDER_PROPERTY,
			defaultCommand: { $ref: '#/$defs/command' },
			commands: { type: 'array', items: { $ref: '#/$defs/command' } },
		} satisfies FragmentProperties<DefinitionDocumentV1>,
		required: ['$schema', 'schemaVersion', 'name', 'commands'],
		$defs: {
			constraintInput: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'name'],
				properties: { kind: { enum: ['flag', 'arg'] }, name: { type: 'string' } },
			},
			command: {
				type: 'object',
				additionalProperties: false,
				properties: commandFragmentProperties,
				required: ['name', 'flags', 'args', 'commands'],
			},
			commandDocument: {
				type: 'object',
				additionalProperties: false,
				properties: {
					schemaVersion: { const: DEFINITION_SCHEMA_VERSION },
					envPrefix: ENV_PREFIX_PROPERTY,
					groupOrder: GROUP_ORDER_PROPERTY,
					...commandFragmentProperties,
				},
				required: ['schemaVersion', 'name', 'flags', 'args', 'commands'],
			},
			flag: {
				type: 'object',
				additionalProperties: false,
				properties: flagFragmentProperties,
				required: ['kind', 'presence'],
				not: { required: ['envVar', 'envIndexed'] },
				dependentSchemas: {
					envAbsolute: { $ref: '#/$defs/envBound' },
					envEmpty: { $ref: '#/$defs/envBound' },
				},
			},
			flagElement: {
				type: 'object',
				additionalProperties: false,
				properties: flagElementFragmentProperties,
				required: ['kind', 'presence'],
			},
			envBound: {
				anyOf: [{ required: ['envVar'] }, { required: ['envIndexed'] }],
			},
			envIndexed: {
				type: 'object',
				additionalProperties: false,
				properties: {
					count: { type: 'string', minLength: 1, not: { pattern: '[{}=]' } },
					value: { $ref: '#/$defs/envIndexedTemplate' },
					fields: {
						type: 'object',
						minProperties: 1,
						propertyNames: { minLength: 1 },
						additionalProperties: { $ref: '#/$defs/envIndexedTemplate' },
					},
				} satisfies FragmentProperties<EnvIndexedFragmentV1>,
				required: ['count'],
				oneOf: [
					{ required: ['value'], not: { required: ['fields'] } },
					{ required: ['fields'], not: { required: ['value'] } },
				],
			},
			envIndexedTemplate: {
				type: 'string',
				pattern: '\\{index\\}',
				not: { pattern: '=' },
			},
			stdin: {
				type: 'object',
				additionalProperties: false,
				properties: {
					when: { enum: ['dash', 'missing', 'dash-or-missing'] },
					consume: { enum: ['exclusive', 'broadcast'] },
					trim: { type: 'boolean' },
					argv: { const: false },
				} satisfies FragmentProperties<StdinBindingFragmentV1>,
				required: ['when', 'consume'],
			},
			split: {
				type: 'object',
				additionalProperties: false,
				properties: {
					env: { $ref: '#/$defs/splitPolicy' },
					stdin: { $ref: '#/$defs/splitPolicy' },
				} satisfies FragmentProperties<SourceSplitFragmentV1>,
			},
			splitPolicy: {
				type: 'object',
				additionalProperties: false,
				properties: {
					format: { enum: ['whole', 'delimiter', 'lines', 'json'] },
					delimiter: { type: 'string', minLength: 1 },
				} satisfies FragmentProperties<SplitPolicyFragmentV1>,
				required: ['format'],
				oneOf: [
					{
						properties: { format: { const: 'delimiter' } },
						required: ['format', 'delimiter'],
					},
					{
						properties: { format: { enum: ['whole', 'lines', 'json'] } },
						not: { required: ['delimiter'] },
					},
				],
			},
			negation: {
				type: 'object',
				additionalProperties: false,
				properties: {
					alias: { type: 'string' },
					hidden: { const: true },
				} satisfies FragmentProperties<FlagNegationFragmentV1>,
			},
			numberConstraints: {
				type: 'object',
				additionalProperties: false,
				properties: {
					min: { type: 'number' },
					max: { type: 'number' },
					int: { type: 'boolean' },
					finite: { type: 'boolean' },
				} satisfies FragmentProperties<NumberConstraints>,
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
				} satisfies FragmentProperties<FlagStringConstraintsFragmentV1>,
			},
			pathChecks: {
				type: 'object',
				additionalProperties: false,
				properties: {
					mustExist: { type: 'boolean' },
					type: { enum: ['file', 'directory'] },
					create: { const: true },
				} satisfies FragmentProperties<FlagPathChecksFragmentV1>,
				required: ['mustExist'],
			},
			argElement: {
				type: 'object',
				additionalProperties: false,
				properties: argElementFragmentProperties,
				required: ['kind', 'presence'],
			},
			arg: {
				type: 'object',
				additionalProperties: false,
				properties: {
					name: { type: 'string' },
					...argValueFragmentProperties,
				} satisfies FragmentProperties<ArgDefinitionFragmentV1> &
					Record<SerializedArgField, Record<string, unknown>>,
				required: ['name', 'kind', 'presence'],
				anyOf: [
					{ not: { required: ['elementSchema'] } },
					{ properties: { kind: { const: 'keyValue' } }, required: ['kind'] },
				],
				not: { required: ['envVar', 'envIndexed'] },
				dependentSchemas: {
					envAbsolute: { $ref: '#/$defs/envBound' },
					envEmpty: { $ref: '#/$defs/envBound' },
				},
			},
			prompt: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kind: { enum: ['confirm', 'input', 'password', 'select', 'multiselect'] },
					message: { type: 'string' },
					placeholder: { type: 'string' },
					trim: { type: 'boolean' },
					empty: { enum: ['skip', 'accept', 'retry'] },
					sensitive: { const: true },
					choices: { type: 'array', items: { $ref: '#/$defs/choice' } },
					min: { type: 'integer' },
					max: { type: 'integer' },
				} satisfies FragmentProperties<PromptDefinitionFragmentV1>,
				required: ['kind', 'message'],
			},
			choice: {
				type: 'object',
				additionalProperties: false,
				properties: {
					value: { type: 'string' },
					label: { type: 'string' },
					description: { type: 'string' },
				} satisfies FragmentProperties<PromptChoiceFragmentV1>,
				required: ['value'],
			},
			example: {
				type: 'object',
				additionalProperties: false,
				properties: {
					command: { type: 'string' },
					description: { type: 'string' },
				} satisfies FragmentProperties<ExampleDefinitionFragmentV1>,
				required: ['command'],
			},
		},
	},
	definitionMetaSchemaDescriptions,
);

export { definitionMetaSchema };
