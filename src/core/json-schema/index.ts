/**
 * JSON Schema generation from CLI schemas.
 *
 * Two complementary functions:
 *
 * - {@link generateSchema} — definition metadata describing the CLI tree
 *   (commands, flags, args, types, constraints) for tooling and documentation.
 *
 * - {@link generateInputSchema} — JSON Schema (draft 2020-12) for validating
 *   CLI input as a JSON object, useful for config file validation and IDE
 *   autocompletion.
 *
 * @module dreamcli/core/json-schema
 */

import { z } from 'zod';
import type { CLISchema } from '#internals/core/cli/index.ts';
import { isRecord } from '#internals/core/internal/guards.ts';
import { getFlagAliasNames } from '#internals/core/schema/flag.ts';
import type {
	ArgSchema,
	CommandArgEntry,
	CommandExample,
	CommandSchema,
	FlagSchema,
	PromptConfig,
	SelectChoice,
} from '#internals/core/schema/index.ts';
import { argZod, flagZod } from '#internals/core/schema/zod-kinds.ts';
import { definitionMetaSchemaDescriptions } from './meta-descriptions.generated.ts';

// --- Options

/**
 * Options for JSON Schema generation.
 *
 * Both {@link generateSchema} and {@link generateInputSchema} accept these
 * options to control which parts of the CLI schema are included in the output.
 */
interface JsonSchemaOptions {
	/**
	 * Include commands marked as hidden.
	 *
	 * When `true` (default), hidden commands appear in the output with
	 * `hidden: true` (definition schema) or as valid branches (input schema).
	 * When `false`, hidden commands and their entire subtrees are excluded.
	 *
	 * @defaultValue `true`
	 */
	readonly includeHidden?: boolean;

	/**
	 * Include prompt configuration on flags.
	 *
	 * When `false`, prompt configs are omitted even if defined on flags.
	 * Useful for producing a schema focused on the non-interactive CLI
	 * surface only.
	 *
	 * Only affects {@link generateSchema} output — prompt configs are never
	 * included in {@link generateInputSchema} output.
	 *
	 * @defaultValue `true`
	 */
	readonly includePrompts?: boolean;
}

/** Internal resolved options with defaults applied. */
interface ResolvedOptions {
	readonly includeHidden: boolean;
	readonly includePrompts: boolean;
}

/**
 * Apply defaults to optional {@link JsonSchemaOptions}.
 *
 * @param options - User-supplied schema generation options, or `undefined` for all defaults.
 * @returns Fully resolved options with defaults applied.
 */
function resolveOptions(options: JsonSchemaOptions | undefined): ResolvedOptions {
	return {
		includeHidden: options?.includeHidden ?? true,
		includePrompts: options?.includePrompts ?? true,
	};
}

// --- Constants

/**
 * `$schema` URL for definition documents.
 *
 * Resolves via the actual file path on the CDN (`dreamcli.schema.json`).
 * For offline or local-first workflows, use
 * `./node_modules/@kjanat/dreamcli/dreamcli.schema.json`.
 */
const DEFINITION_SCHEMA_URL = 'https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/dreamcli.schema.json';

/** Meta-schema URL for JSON Schema draft 2020-12 (input validation). */
const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Strip zod's emitted `$schema` (and any `$id`) key from a `z.toJSONSchema`
 * fragment. zod stamps the meta-schema URL on the top-level fragment; the
 * envelope is rebuilt by the callers in this module.
 */
function stripJsonSchemaMeta(fragment: Record<string, unknown>): Record<string, unknown> {
	const { $schema: _schema, $id: _id, ...rest } = fragment;
	return rest;
}

// === Definition schema — generateSchema()

/**
 * Generate a definition metadata document describing the CLI's structure.
 *
 * Walks the full command tree and produces a plain JSON-serializable object
 * representing all commands, subcommands, flags, args, and metadata.
 * Non-serializable runtime values (parse functions, middleware handlers,
 * interactive resolvers) are omitted.
 *
 * @param schema - The CLI schema from `CLIBuilder.schema`.
 * @param options - Generation options.
 * @returns A plain object suitable for `JSON.stringify()`.
 *
 * @example
 * ```ts
 * const app = cli('myapp').version('1.0.0').command(deploy);
 * const definition = generateSchema(app.schema);
 * writeFileSync('cli-schema.json', JSON.stringify(definition, null, 2));
 * ```
 */
function generateSchema(schema: CLISchema, options?: JsonSchemaOptions): Record<string, unknown> {
	const opts = resolveOptions(options);

	const result: Record<string, unknown> = {
		$schema: DEFINITION_SCHEMA_URL,
		name: schema.name,
	};

	if (schema.version !== undefined) {
		result.version = schema.version;
	}
	if (schema.description !== undefined) {
		result.description = schema.description;
	}
	if (
		schema.defaultCommand !== undefined &&
		(opts.includeHidden || !schema.defaultCommand.schema.hidden)
	) {
		result.defaultCommand = schema.defaultCommand.schema.name;
	}

	result.commands = schema.commands
		.filter((cmd) => opts.includeHidden || !cmd.schema.hidden)
		.map((cmd) => serializeCommand(cmd.schema, opts));

	return result;
}

// --- Command serialization

/**
 * Serialize a single {@link CommandSchema} into a plain object.
 *
 * @param schema - The command schema to serialize.
 * @param opts - Resolved generation options (hidden/prompt inclusion).
 * @returns JSON-serializable object representing the command.
 */
function serializeCommand(schema: CommandSchema, opts: ResolvedOptions): Record<string, unknown> {
	const result: Record<string, unknown> = { name: schema.name };

	if (schema.description !== undefined) {
		result.description = schema.description;
	}
	if (schema.aliases.length > 0) {
		result.aliases = [...schema.aliases];
	}
	if (schema.hidden) {
		result.hidden = true;
	}
	if (schema.examples.length > 0) {
		result.examples = schema.examples.map(serializeExample);
	}

	// Flags — always present (consumers iterate without existence check)
	const flags: Record<string, Record<string, unknown>> = {};
	for (const [name, flagDef] of Object.entries(schema.flags)) {
		flags[name] = serializeFlag(flagDef, opts);
	}
	result.flags = flags;

	// Args — always present (positional order matters)
	result.args = schema.args.map(serializeArgEntry);

	// Subcommands — always present
	result.commands = schema.commands
		.filter((cmd) => opts.includeHidden || !cmd.hidden)
		.map((cmd) => serializeCommand(cmd, opts));

	return result;
}

// --- Flag serialization

/**
 * Serialize a {@link FlagSchema} into a plain object.
 *
 * @param schema - The flag schema to serialize.
 * @param opts - Resolved generation options (prompt inclusion).
 * @returns JSON-serializable object representing the flag.
 */
function serializeFlag(schema: FlagSchema, opts: ResolvedOptions): Record<string, unknown> {
	const result: Record<string, unknown> = {
		kind: schema.kind,
		presence: schema.presence,
	};

	if (schema.presence === 'defaulted' && isJsonSerializable(schema.defaultValue)) {
		result.defaultValue = schema.defaultValue;
	}
	const visibleAliases = getFlagAliasNames(schema);
	if (visibleAliases.length > 0) {
		result.aliases = [...visibleAliases];
	}
	if (schema.envVar !== undefined) {
		result.envVar = schema.envVar;
	}
	if (schema.configPath !== undefined) {
		result.configPath = schema.configPath;
	}
	if (schema.description !== undefined) {
		result.description = schema.description;
	}
	if (schema.enumValues !== undefined) {
		result.enumValues = [...schema.enumValues];
	}
	if (schema.elementSchema !== undefined) {
		result.elementSchema = serializeFlag(schema.elementSchema, opts);
	}
	if (opts.includePrompts && schema.prompt !== undefined) {
		result.prompt = serializePrompt(schema.prompt);
	}
	if (schema.deprecated !== undefined) {
		result.deprecated = schema.deprecated;
	}
	if (schema.propagate) {
		result.propagate = true;
	}

	return result;
}

// --- Arg serialization

/**
 * Serialize a {@link CommandArgEntry} into a plain object.
 *
 * @param entry - The positional arg entry (name + {@link ArgSchema}).
 * @returns JSON-serializable object representing the arg.
 */
function serializeArgEntry(entry: CommandArgEntry): Record<string, unknown> {
	const { name, schema } = entry;
	const result: Record<string, unknown> = {
		name,
		kind: schema.kind,
		presence: schema.presence,
	};

	if (schema.variadic) {
		result.variadic = true;
	}
	if (schema.stdinMode) {
		result.stdinMode = true;
	}
	if (schema.presence === 'defaulted' && isJsonSerializable(schema.defaultValue)) {
		result.defaultValue = schema.defaultValue;
	}
	if (schema.description !== undefined) {
		result.description = schema.description;
	}
	if (schema.envVar !== undefined) {
		result.envVar = schema.envVar;
	}
	if (schema.enumValues !== undefined) {
		result.enumValues = [...schema.enumValues];
	}
	if (schema.deprecated !== undefined) {
		result.deprecated = schema.deprecated;
	}

	return result;
}

// --- Prompt serialization

/**
 * Serialize a {@link PromptConfig} into a plain object.
 *
 * @param prompt - The prompt configuration to serialize.
 * @returns JSON-serializable object representing the prompt.
 */
function serializePrompt(prompt: PromptConfig): Record<string, unknown> {
	const result: Record<string, unknown> = {
		kind: prompt.kind,
		message: prompt.message,
	};

	switch (prompt.kind) {
		case 'input':
			if (prompt.placeholder !== undefined) {
				result.placeholder = prompt.placeholder;
			}
			// validate fn omitted — not serializable
			break;
		case 'select':
			if (prompt.choices !== undefined) {
				result.choices = prompt.choices.map(serializeChoice);
			}
			break;
		case 'multiselect':
			if (prompt.choices !== undefined) {
				result.choices = prompt.choices.map(serializeChoice);
			}
			if (prompt.min !== undefined) {
				result.min = prompt.min;
			}
			if (prompt.max !== undefined) {
				result.max = prompt.max;
			}
			break;
		case 'confirm':
			break;
	}

	return result;
}

/**
 * Serialize a {@link SelectChoice} into a plain object.
 *
 * @param choice - The select/multiselect choice to serialize.
 * @returns JSON-serializable object with value, optional label and description.
 */
function serializeChoice(choice: SelectChoice): Record<string, unknown> {
	const result: Record<string, unknown> = { value: choice.value };
	if (choice.label !== undefined) {
		result.label = choice.label;
	}
	if (choice.description !== undefined) {
		result.description = choice.description;
	}
	return result;
}

// --- Example serialization

/**
 * Serialize a {@link CommandExample} into a plain object.
 *
 * @param example - The example to serialize.
 * @returns JSON-serializable object with command and optional description.
 */
function serializeExample(example: CommandExample): Record<string, unknown> {
	const result: Record<string, unknown> = { command: example.command };
	if (example.description !== undefined) {
		result.description = example.description;
	}
	return result;
}

// === Input validation schema — generateInputSchema()

/**
 * Generate a JSON Schema (draft 2020-12) for validating CLI input as JSON.
 *
 * Accepts either a full {@link CLISchema} (producing a discriminated union
 * across all commands) or a single {@link CommandSchema} (producing a flat
 * object schema for that command's flags and args).
 *
 * **Single command** — produces an object schema where flag/arg names are
 * properties with appropriate JSON Schema types.
 *
 * **Multi-command CLI** — produces a `oneOf` discriminated union with a
 * `command` property identifying each branch. Nested subcommands use
 * dot-delimited paths (e.g. `"deploy.rollback"`).
 *
 * Only commands with action handlers are included (group commands without
 * actions are not directly invocable and are skipped).
 *
 * @param schema - A CLI schema or a single command schema.
 * @param options - Generation options.
 * @returns A JSON Schema object suitable for `JSON.stringify()`.
 *
 * @example
 * ```ts
 * // Validate a config file against the CLI's input shape
 * const inputSchema = generateInputSchema(app.schema);
 * writeFileSync('input-schema.json', JSON.stringify(inputSchema, null, 2));
 * ```
 */
function generateInputSchema(
	schema: CLISchema | CommandSchema,
	options?: JsonSchemaOptions,
): Record<string, unknown> {
	const opts = resolveOptions(options);

	// Discriminate between a leaf/group command schema and the CLI root schema.
	if (isCommandSchema(schema)) {
		return {
			$schema: JSON_SCHEMA_DRAFT,
			...commandToInputSchema(schema),
		};
	}

	// CLISchema — collect all invocable commands into branches
	const branches: Array<Record<string, unknown>> = [];
	for (const cmd of schema.commands) {
		if (!opts.includeHidden && cmd.schema.hidden) continue;
		collectInputBranches(cmd.schema, '', branches, opts);
	}

	// Single branch: emit flat (no oneOf wrapper)
	if (branches.length === 1) {
		const branch = stripCommandDiscriminator(branches[0] ?? {});
		return {
			$schema: JSON_SCHEMA_DRAFT,
			...branch,
		};
	}

	// Multiple branches: discriminated union
	if (branches.length > 0) {
		const defaultBranchName =
			schema.defaultCommand !== undefined &&
			(opts.includeHidden || !schema.defaultCommand.schema.hidden)
				? schema.defaultCommand.schema.name
				: undefined;
		const normalizedBranches =
			defaultBranchName !== undefined
				? branches.map((branch) =>
						getBranchCommandDiscriminator(branch) === defaultBranchName
							? stripCommandDiscriminator(branch)
							: branch,
					)
				: branches;

		return {
			$schema: JSON_SCHEMA_DRAFT,
			oneOf: normalizedBranches,
		};
	}

	// No invocable commands
	return {
		$schema: JSON_SCHEMA_DRAFT,
		type: 'object',
	};
}

// --- Input schema helpers

/**
 * Discriminate between CLISchema and CommandSchema at runtime.
 *
 * Use a command-only field combination rather than a single shape check:
 * command schemas always carry flags, args, middleware, and hasAction, while
 * the CLI root schema does not expose that execution surface.
 */
function isCommandSchema(schema: CLISchema | CommandSchema): schema is CommandSchema {
	return 'flags' in schema && 'args' in schema && 'middleware' in schema && 'hasAction' in schema;
}

/** Recursively collect input schema branches for all invocable commands. */
function collectInputBranches(
	schema: CommandSchema,
	prefix: string,
	branches: Array<Record<string, unknown>>,
	opts: ResolvedOptions,
): void {
	const path = prefix ? `${prefix}.${schema.name}` : schema.name;

	if (schema.hasAction) {
		branches.push(commandToInputSchema(schema, path));
	}

	for (const sub of schema.commands) {
		if (!opts.includeHidden && sub.hidden) continue;
		collectInputBranches(sub, path, branches, opts);
	}
}

/**
 * Create a JSON Schema object for a single command's flags + args.
 *
 * When `commandPath` is provided, a `command` const discriminator property
 * is added and required (used in multi-command oneOf schemas).
 */
function commandToInputSchema(
	schema: CommandSchema,
	commandPath?: string,
): Record<string, unknown> {
	const properties: Record<string, Record<string, unknown>> = {};
	const required: string[] = [];

	// Command discriminator (for multi-command schemas)
	if (commandPath !== undefined) {
		properties.command = { const: commandPath };
		required.push('command');
	}

	// Flags → properties
	for (const [name, flagDef] of Object.entries(schema.flags)) {
		properties[name] = flagToJsonSchemaType(flagDef);
		if (flagDef.presence === 'required') {
			required.push(name);
		}
	}

	// Args → properties (by name)
	for (const entry of schema.args) {
		properties[entry.name] = argToJsonSchemaType(entry.schema);
		if (entry.schema.presence === 'required') {
			required.push(entry.name);
		}
	}

	const result: Record<string, unknown> = {
		type: 'object',
		properties,
		additionalProperties: false,
	};

	if (required.length > 0) {
		result.required = required;
	}

	return result;
}

/** @internal */
function stripCommandDiscriminator(branch: Record<string, unknown>): Record<string, unknown> {
	const propertiesValue = branch.properties;
	const requiredValue = branch.required;
	const properties = isRecord(propertiesValue) ? { ...propertiesValue } : undefined;
	const required = Array.isArray(requiredValue)
		? requiredValue.filter((value): value is string => typeof value === 'string')
		: undefined;

	if (properties !== undefined) {
		delete properties.command;
	}

	const cleanedRequired = required?.filter((value) => value !== 'command');
	const result: Record<string, unknown> = { ...branch };

	if (properties !== undefined) {
		result.properties = properties;
	}

	if (cleanedRequired !== undefined && cleanedRequired.length > 0) {
		result.required = cleanedRequired;
	} else {
		delete result.required;
	}

	return result;
}

function getBranchCommandDiscriminator(branch: Record<string, unknown>): string | undefined {
	const propertiesValue = branch.properties;
	if (!isRecord(propertiesValue)) {
		return undefined;
	}

	const commandValue = propertiesValue.command;
	return isRecord(commandValue) && typeof commandValue.const === 'string'
		? commandValue.const
		: undefined;
}

// --- Type mapping — flags / args → JSON Schema types (zod-derived)

/**
 * Build the JSON Schema type fragment for a flag from its declared-type zod
 * schema (`flagZod`), then layer on JSON Schema annotations.
 *
 * The shape produced by `z.toJSONSchema` already matches the conventions the
 * input schema asserts: `string`→`{type:'string'}`, `number`→`{type:'number'}`,
 * `boolean`→`{type:'boolean'}`, `enum`→`{type:'string',enum:[...]}`,
 * `array`→`{type:'array',items:{...}}`, `custom`/`unknown`→`{}`. The only
 * post-processing is stripping zod's `$schema` key and attaching
 * `description` / `default` / `deprecated`.
 */
function flagToJsonSchemaType(schema: FlagSchema): Record<string, unknown> {
	const result = stripJsonSchemaMeta(z.toJSONSchema(flagZod(schema)));
	return annotateInputType(result, schema.description, schema.defaultValue, schema, schema.deprecated);
}

/**
 * Build the JSON Schema type fragment for a positional arg from its
 * declared-type zod schema (`argZod`), wrapping variadic args in an array.
 */
function argToJsonSchemaType(schema: ArgSchema): Record<string, unknown> {
	const kind = stripJsonSchemaMeta(z.toJSONSchema(argZod(schema)));
	const result: Record<string, unknown> = schema.variadic
		? { type: 'array', items: kind }
		: kind;

	return annotateInputType(result, schema.description, schema.defaultValue, schema, schema.deprecated);
}

/** Attach JSON Schema `description`/`default`/`deprecated` annotations. */
function annotateInputType(
	result: Record<string, unknown>,
	description: string | undefined,
	defaultValue: unknown,
	schema: { readonly presence: string },
	deprecated: string | boolean | undefined,
): Record<string, unknown> {
	if (description !== undefined) {
		result.description = description;
	}
	if (schema.presence === 'defaulted' && isJsonSerializable(defaultValue)) {
		result.default = defaultValue;
	}
	if (deprecated !== undefined) {
		result.deprecated = deprecated;
	}
	return result;
}

// === Utilities

/**
 * Check whether a value can survive a JSON round-trip.
 *
 * Returns `false` for functions, symbols, bigints, non-finite numbers, and
 * objects containing them. Used to guard default-value inclusion in
 * serialized output.
 */
function isJsonSerializable(
	value: unknown,
	seen: WeakSet<object> = new WeakSet<object>(),
): boolean {
	if (value === undefined) return false;
	if (value === null) return true;
	const t = typeof value;
	if (t === 'string' || t === 'boolean') return true;
	if (t === 'number') return Number.isFinite(value);
	if (t === 'function' || t === 'symbol' || t === 'bigint') return false;
	if (Array.isArray(value)) {
		if (seen.has(value)) return false;
		seen.add(value);
		try {
			return value.every((entry) => isJsonSerializable(entry, seen));
		} finally {
			seen.delete(value);
		}
	}
	if (t === 'object') {
		const objectValue = value as Record<string, unknown>;
		if (!isPlainJsonObject(objectValue)) return false;
		if (seen.has(objectValue)) return false;
		seen.add(objectValue);
		try {
			return Object.values(objectValue).every((entry) => isJsonSerializable(entry, seen));
		} finally {
			seen.delete(objectValue);
		}
	}
	return false;
}

/**
 * Check whether an object is a plain JSON object.
 *
 * Accepts objects with `Object.prototype` or a null prototype, which are the
 * only object shapes that round-trip through JSON as structural objects.
 *
 * @internal
 */
function isPlainJsonObject(value: object): value is Record<string, unknown> {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// === Definition meta-schema — derived from zod object schemas

/**
 * Normalize a `z.toJSONSchema` fragment to the JSON Schema conventions the
 * definition meta-schema has always emitted (previously hand-built from a
 * schema DSL):
 *
 * - strip zod's `$schema` / `$id` keys
 * - literal-string union (`{type:'string',enum:[...]}`) → `{enum:[...]}`
 * - boolean literal (`{type:'boolean',const:X}`) → `{const:X}`
 * - `z.record(...)` (`{type:'object',propertyNames,additionalProperties}`)
 *   → `{type:'object',additionalProperties:...}` (drop `propertyNames`)
 * - `z.int()` safe-integer bounds → plain `{type:'integer'}`
 * - `anyOf` → `oneOf`
 *
 * Recurses through `properties`, `items`, `additionalProperties`, and
 * `oneOf` / `anyOf` member lists. Cross-references emitted by the registry as
 * `{$ref:'#/$defs/<name>'}` are preserved verbatim.
 */
function normalizeDefFragment(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(normalizeDefFragment);
	}
	if (!isRecord(value)) {
		return value;
	}

	const node = stripJsonSchemaMeta(value);

	// Literal: `{type:<primitive>, const: …}` → `{const: …}` (drop redundant
	// `type`, matching the prior DSL literal convention for both `true`/`false`
	// and string literals such as the `$schema` const).
	if ('const' in node && (node.type === 'boolean' || node.type === 'string')) {
		const { type: _type, ...rest } = node;
		return rest;
	}

	// Literal-string union: `{type:'string', enum:[…]}` → `{enum:[…]}`.
	if (node.type === 'string' && Array.isArray(node.enum)) {
		const { type: _type, ...rest } = node;
		return rest;
	}

	// `z.int()` stamps safe-integer min/max bounds; the meta-schema models a
	// plain integer.
	if (node.type === 'integer') {
		const SAFE = 9007199254740991;
		if (node.minimum === -SAFE && node.maximum === SAFE) {
			const { minimum: _min, maximum: _max, ...rest } = node;
			return rest;
		}
	}

	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(node)) {
		// `z.record(...)` adds `propertyNames`; the meta-schema only keeps
		// `additionalProperties`.
		if (key === 'propertyNames') {
			continue;
		}
		// `properties` / `$defs` are name→schema maps: normalize each value, but
		// never treat the map itself as a schema fragment (its keys may legitimately
		// be `$schema`/`$id`, e.g. the root's `$schema` literal property).
		if ((key === 'properties' || key === '$defs') && isRecord(child)) {
			result[key] = Object.fromEntries(
				Object.entries(child).map(([name, sub]) => [name, normalizeDefFragment(sub)]),
			);
			continue;
		}
		// Normalize mixed unions to `oneOf` (matches the prior DSL output).
		if (key === 'anyOf') {
			result.oneOf = normalizeDefFragment(child);
			continue;
		}
		result[key] = normalizeDefFragment(child);
	}
	return result;
}

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

/**
 * JSON Schema (draft 2020-12) that validates the output of {@link generateSchema}.
 *
 * Each `$defs` entry is declared once as a zod object schema. `z.toJSONSchema`
 * (via a local registry, so the six named schemas cross-reference through
 * `$ref: '#/$defs/<name>'`) produces the fragments, which are normalized
 * ({@link normalizeDefFragment}) to the conventions this schema has always
 * emitted. No probe fixtures, override maps, or hand-maintained JSON.
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
const definitionMetaSchema: Record<string, unknown> = buildDefinitionMetaSchema();

/**
 * Construct the definition meta-schema from zod object schemas.
 *
 * @internal
 */
function buildDefinitionMetaSchema(): Record<string, unknown> {
	const registry = z.registry<{ id: string }>();
	const named = <T extends z.ZodType>(schema: T, id: string): T => {
		registry.add(schema, { id });
		return schema;
	};

	const choice = named(
		z.object({
			value: z.string(),
			label: z.string().optional(),
			description: z.string().optional(),
		}),
		'choice',
	);

	const example = named(
		z.object({
			command: z.string(),
			description: z.string().optional(),
		}),
		'example',
	);

	const prompt = named(
		z.object({
			kind: z.enum(['confirm', 'input', 'select', 'multiselect']),
			message: z.string(),
			placeholder: z.string().optional(),
			choices: z.array(choice).optional(),
			min: z.int().optional(),
			max: z.int().optional(),
		}),
		'prompt',
	);

	const flag: z.ZodType = named(
		z.object({
			kind: z.enum(['string', 'number', 'boolean', 'enum', 'array', 'custom']),
			presence: z.enum(['optional', 'required', 'defaulted']),
			defaultValue: z.unknown().optional(),
			aliases: z.array(z.string()).optional(),
			envVar: z.string().optional(),
			configPath: z.string().optional(),
			description: z.string().optional(),
			enumValues: z.array(z.string()).optional(),
			elementSchema: z.lazy(() => flag).optional(),
			prompt: prompt.optional(),
			deprecated: z.union([z.string(), z.literal(true)]).optional(),
			propagate: z.literal(true).optional(),
		}),
		'flag',
	);

	const arg = named(
		z.object({
			name: z.string(),
			kind: z.enum(['string', 'number', 'enum', 'custom']),
			presence: z.enum(['required', 'optional', 'defaulted']),
			variadic: z.literal(true).optional(),
			stdinMode: z.literal(true).optional(),
			defaultValue: z.unknown().optional(),
			description: z.string().optional(),
			envVar: z.string().optional(),
			enumValues: z.array(z.string()).optional(),
			deprecated: z.union([z.string(), z.literal(true)]).optional(),
		}),
		'arg',
	);

	const command: z.ZodType = named(
		z.object({
			name: z.string(),
			description: z.string().optional(),
			aliases: z.array(z.string()).optional(),
			hidden: z.literal(true).optional(),
			examples: z.array(example).optional(),
			flags: z.record(z.string(), flag),
			args: z.array(arg),
			commands: z.array(z.lazy(() => command)),
		}),
		'command',
	);

	named(
		z.object({
			$schema: z.literal(DEFINITION_SCHEMA_URL),
			name: z.string(),
			version: z.string().optional(),
			description: z.string().optional(),
			defaultCommand: z.string().optional(),
			commands: z.array(command),
		}),
		'root',
	);

	// Render every named schema (root + the six `$defs`) in one pass so all
	// cross-references resolve to `#/$defs/<name>`, then normalize to the
	// meta-schema's conventions.
	const registryOutput = z.toJSONSchema(registry, { uri: (id) => `#/$defs/${id}` });
	const registrySchemas = isRecord(registryOutput.schemas) ? registryOutput.schemas : {};
	const defs: Record<string, unknown> = {};
	for (const name of ['command', 'flag', 'arg', 'prompt', 'choice', 'example']) {
		const fragment = registrySchemas[name];
		if (isRecord(fragment)) {
			defs[name] = normalizeDefFragment(fragment);
		}
	}

	const rootFragment = normalizeDefFragment(registrySchemas.root);
	const rootObject = isRecord(rootFragment) ? rootFragment : {};

	return withDefinitionMetaSchemaDescriptions(
		{
			$schema: JSON_SCHEMA_DRAFT,
			$id: DEFINITION_SCHEMA_URL,
			title: '@kjanat/dreamcli definition schema',
			description:
				'Describes the structure of a CLI built with dreamcli — commands, flags, args, types, constraints, env bindings, and prompts.',
			...rootObject,
			$defs: defs,
		},
		definitionMetaSchemaDescriptions,
	);
}

// === Exports

export type { JsonSchemaOptions };
export { definitionMetaSchema, generateInputSchema, generateSchema };
