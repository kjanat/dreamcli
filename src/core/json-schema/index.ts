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

import type { CLISchema } from '#internals/core/cli/index.ts';
import type { schemaBrand } from '#internals/core/schema/brand.ts';
import { resolveExampleCommand } from '#internals/core/schema/command.ts';
import { getFlagAliasNames } from '#internals/core/schema/flag.ts';
import type {
	ArgKind,
	ArgPresence,
	ArgSchema,
	CommandArgEntry,
	CommandExample,
	CommandSchema,
	DuplicateKeys,
	DuplicatePolicy,
	ExampleMeta,
	FlagKind,
	FlagPresence,
	FlagSchema,
	NumberConstraints,
	PathChecks,
	PromptConfig,
	PromptKind,
	SelectChoice,
	SourceSplitBinding,
	StdinBinding,
	StringConstraints,
} from '#internals/core/schema/index.ts';
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

/** Fields carrying a runtime function, which no document can hold. */
type UnserializableField = typeof schemaBrand | 'parseFn' | 'standard' | 'aggregateStandard';

/** Flag fields that survive definition serialization. */
type SerializedFlagField = Exclude<keyof FlagSchema, UnserializableField>;

/** Arg fields that survive definition serialization, plus the entry's own name. */
type SerializedArgField = 'name' | Exclude<keyof ArgSchema, UnserializableField>;

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
 * Self-hosted. The `v1` segment is the definition format version, the value
 * every document reports as `schemaVersion`, so it resolves for every package
 * release that emits `schemaVersion: 1`. Two mirrors carry identical bytes:
 * `./node_modules/@kjanat/dreamcli/dreamcli.schema.json` for offline or
 * local-first workflows, and
 * `https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/dreamcli.schema.json` on the
 * npm CDN.
 */
const DEFINITION_SCHEMA_URL = 'https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json';

/** Meta-schema URL for JSON Schema draft 2020-12 (input validation). */
const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Version of the definition document format emitted by {@link generateSchema}
 * and {@link generateCommandSchema}.
 */
const DEFINITION_SCHEMA_VERSION = 1;

// --- Definition document types

/**
 * A usage example inside a definition document.
 *
 * Function-form examples are resolved to strings during serialization.
 */
type ExampleDefinitionFragmentV1 = {
	readonly command: string;
	readonly description?: string;
};

/** A selectable choice of a `select` or `multiselect` prompt fragment. */
type PromptChoiceFragmentV1 = {
	readonly value: string;
	readonly label?: string;
	readonly description?: string;
};

/**
 * Prompt configuration attached to a flag fragment.
 *
 * Validation callbacks are dropped. Only the serializable description of the
 * prompt survives.
 */
type PromptDefinitionFragmentV1 = {
	readonly kind: PromptKind;
	readonly message: string;
	readonly placeholder?: string;
	readonly choices?: readonly PromptChoiceFragmentV1[];
	readonly min?: number;
	readonly max?: number;
};

/**
 * Stdin binding of a flag or arg fragment.
 *
 * Both fields are always written, so a document states the trigger and the
 * sharing mode without a reader having to know the builder's defaults.
 */
type StdinBindingFragmentV1 = {
	readonly when: 'dash' | 'missing' | 'dash-or-missing';
	readonly consume: 'exclusive' | 'broadcast';
};

/**
 * How one source's text decodes into collection elements.
 *
 * A delimiter carries its own literal; every other format is named alone.
 */
type SplitPolicyFragmentV1 =
	| { readonly format: 'whole' }
	| { readonly format: 'delimiter'; readonly delimiter: string }
	| { readonly format: 'lines' }
	| { readonly format: 'json' };

/**
 * Non-CLI split policies of a collection fragment.
 *
 * The CLI delimiter is the fragment's own `separator`. A source absent here
 * takes its default: comma-delimited for env, line-delimited for stdin.
 */
type SourceSplitFragmentV1 = {
	readonly env?: SplitPolicyFragmentV1;
	readonly stdin?: SplitPolicyFragmentV1;
};

/** Negated-spelling settings of a boolean flag fragment. */
type FlagNegationFragmentV1 = {
	readonly alias?: string;
	readonly hidden?: true;
};

/**
 * String constraints of a flag or arg fragment, with the pattern split into
 * source and flags.
 */
type FlagStringConstraintsFragmentV1 = {
	readonly nonEmpty?: boolean;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly pattern?: {
		readonly source: string;
		readonly flags: string;
	};
};

/** Filesystem expectations of a flag or arg fragment. */
type FlagPathChecksFragmentV1 = {
	readonly mustExist: boolean;
	readonly type?: 'file' | 'directory';
	readonly create?: true;
};

/**
 * A flag entry inside a definition document.
 *
 * Optional fields appear only when the flag sets them; `defaultValue` appears
 * only when the value survives a JSON round-trip.
 */
type FlagDefinitionFragmentV1 = {
	readonly kind: FlagKind;
	readonly presence: FlagPresence;
	readonly defaultValue?: unknown;
	readonly aliases?: readonly string[];
	readonly stdin?: StdinBindingFragmentV1;
	readonly envVar?: string;
	readonly configPath?: string;
	readonly description?: string;
	readonly enumValues?: readonly string[];
	readonly numberConstraints?: NumberConstraints;
	readonly stringConstraints?: FlagStringConstraintsFragmentV1;
	readonly elementSchema?: FlagDefinitionFragmentV1;
	readonly separator?: string;
	readonly split?: SourceSplitFragmentV1;
	readonly duplicateKeys?: DuplicateKeys;
	readonly unique?: true;
	readonly pathChecks?: FlagPathChecksFragmentV1;
	readonly valueHint?: string;
	readonly prompt?: PromptDefinitionFragmentV1;
	readonly deprecated?: string | true;
	readonly propagate?: true;
	readonly negation?: FlagNegationFragmentV1;
	readonly duplicates?: DuplicatePolicy;
};

/**
 * A positional arg entry inside a definition document.
 *
 * Array order carries the CLI position.
 */
type ArgDefinitionFragmentV1 = {
	readonly name: string;
	readonly kind: ArgKind;
	readonly presence: ArgPresence;
	readonly variadic?: true;
	readonly stdin?: StdinBindingFragmentV1;
	readonly defaultValue?: unknown;
	readonly description?: string;
	readonly envVar?: string;
	readonly configPath?: string;
	readonly enumValues?: readonly string[];
	readonly numberConstraints?: NumberConstraints;
	readonly stringConstraints?: FlagStringConstraintsFragmentV1;
	readonly pathChecks?: FlagPathChecksFragmentV1;
	readonly valueHint?: string;
	readonly separator?: string;
	readonly split?: SourceSplitFragmentV1;
	readonly duplicateKeys?: DuplicateKeys;
	readonly unique?: true;
	readonly prompt?: PromptDefinitionFragmentV1;
	readonly deprecated?: string | true;
};

/**
 * A command nested inside a definition document.
 *
 * Fragments carry no `schemaVersion`. They inherit the version of the document
 * they sit in. The standalone form is {@link CommandDefinitionDocumentV1}.
 */
type CommandDefinitionFragmentV1 = {
	readonly name: string;
	readonly description?: string;
	readonly aliases?: readonly string[];
	readonly hidden?: true;
	readonly examples?: readonly ExampleDefinitionFragmentV1[];
	readonly flags: Readonly<Record<string, FlagDefinitionFragmentV1>>;
	readonly args: readonly ArgDefinitionFragmentV1[];
	readonly commands: readonly CommandDefinitionFragmentV1[];
};

/**
 * A whole-CLI definition document, version 1.
 *
 * Produced by {@link generateSchema}. Validated by {@link definitionMetaSchema}
 * and served at {@link DEFINITION_SCHEMA_URL}.
 */
type DefinitionDocumentV1 = {
	readonly $schema: string;
	readonly schemaVersion: 1;
	readonly name: string;
	readonly version?: string;
	readonly description?: string;
	readonly defaultCommand?: CommandDefinitionFragmentV1;
	readonly commands: readonly CommandDefinitionFragmentV1[];
};

/**
 * A single-command definition document, version 1.
 *
 * Produced by {@link generateCommandSchema}. Same shape as a
 * {@link CommandDefinitionFragmentV1} plus the `schemaVersion` every standalone
 * document carries.
 */
type CommandDefinitionDocumentV1 = CommandDefinitionFragmentV1 & {
	readonly schemaVersion: 1;
};

/** The current whole-CLI definition document. */
type DefinitionDocument = DefinitionDocumentV1;

/** The current single-command definition document. */
type CommandDefinitionDocument = CommandDefinitionDocumentV1;

// --- Input schema types

/** A JSON Schema fragment describing one flag or arg as an input property. */
type InputSchemaProperty = Readonly<Record<string, unknown>>;

/** The JSON Schema object describing one command's flags and args. */
type InputSchemaBranch = {
	readonly type: 'object';
	readonly properties: Readonly<Record<string, InputSchemaProperty>>;
	readonly additionalProperties: false;
	readonly required?: readonly string[];
};

/**
 * A JSON Schema (draft 2020-12) document produced by {@link generateInputSchema}.
 *
 * This document sits outside the definition-document family. It holds one
 * branch for a single invocable command, a `oneOf` union for several, and a
 * bare object schema when a CLI has none.
 */
type InputSchemaDocument =
	| ({ readonly $schema: string } & InputSchemaBranch)
	| { readonly $schema: string; readonly oneOf: readonly InputSchemaBranch[] }
	| { readonly $schema: string; readonly type: 'object' };

// === Definition schema — generateSchema()

/**
 * Generate a definition metadata document describing the CLI's structure.
 *
 * Walks the full command tree and produces a plain JSON-serializable object
 * representing all commands, subcommands, flags, args, and metadata.
 * Non-serializable runtime values (parse functions, interactive resolvers)
 * are omitted.
 *
 * @param schema - The CLI schema from `CLIBuilder.schema`.
 * @param options - Generation options.
 * @param meta - Program name/version for function-form examples; defaults to
 *   the CLI schema's own `name`/`version`.
 * @returns A plain object suitable for `JSON.stringify()`.
 *
 * @example
 * ```ts
 * const app = cli('myapp').version('1.0.0').command(deploy);
 * const definition = generateSchema(app.schema);
 * writeFileSync('cli-schema.json', JSON.stringify(definition, null, 2));
 * ```
 */
function generateSchema(
	schema: CLISchema,
	options?: JsonSchemaOptions,
	meta?: ExampleMeta,
): DefinitionDocumentV1 {
	const opts = resolveOptions(options);
	const resolvedMeta: ExampleMeta = meta ?? { name: schema.name, version: schema.version };

	// Full definition, not just the name — the default command lives only in
	// `defaultCommand` (never in `commands`), so a name-only reference would
	// drop its flags/args from the document entirely.
	const defaultCommand =
		schema.defaultCommand !== undefined && (opts.includeHidden || !schema.defaultCommand.hidden)
			? serializeCommand(schema.defaultCommand, opts, resolvedMeta)
			: undefined;

	return {
		$schema: DEFINITION_SCHEMA_URL,
		schemaVersion: DEFINITION_SCHEMA_VERSION,
		name: schema.name,
		...(schema.version !== undefined ? { version: schema.version } : {}),
		...(schema.description !== undefined ? { description: schema.description } : {}),
		...(defaultCommand !== undefined ? { defaultCommand } : {}),
		commands: schema.commands
			.filter((cmd) => opts.includeHidden || !cmd.hidden)
			.map((cmd) => serializeCommand(cmd, opts, resolvedMeta)),
	};
}

// --- Command serialization

/**
 * Generate the definition metadata document for a single command.
 *
 * The per-command counterpart of {@link generateSchema}: one entry of its
 * `commands` array (flags, args, subcommands, examples), plus the
 * `schemaVersion` every standalone document carries. Powers `--help` in
 * `--json` mode and is useful for embedding one command's definition into
 * custom tooling.
 *
 * @param schema - The command schema to serialize.
 * @param options - Generation options.
 * @param meta - Program name/version for function-form examples; defaults to
 *   the command's own name with no version.
 * @returns A plain object suitable for `JSON.stringify()`.
 */
function generateCommandSchema(
	schema: CommandSchema,
	options?: JsonSchemaOptions,
	meta?: ExampleMeta,
): CommandDefinitionDocumentV1 {
	const resolvedMeta: ExampleMeta = meta ?? { name: schema.name, version: undefined };
	return {
		schemaVersion: DEFINITION_SCHEMA_VERSION,
		...serializeCommand(schema, resolveOptions(options), resolvedMeta),
	};
}

/**
 * Serialize a single {@link CommandSchema} into a plain object.
 *
 * @param schema - The command schema to serialize.
 * @param opts - Resolved generation options (hidden/prompt inclusion).
 * @returns JSON-serializable object representing the command.
 */
function serializeCommand(
	schema: CommandSchema,
	opts: ResolvedOptions,
	meta: ExampleMeta,
): CommandDefinitionFragmentV1 {
	// Flags — always present (consumers iterate without existence check)
	const flags: Record<string, FlagDefinitionFragmentV1> = {};
	for (const [name, flagDef] of Object.entries(schema.flags)) {
		flags[name] = serializeFlag(flagDef, opts);
	}

	return {
		name: schema.name,
		...(schema.description !== undefined ? { description: schema.description } : {}),
		...(schema.aliases.length > 0 ? { aliases: [...schema.aliases] } : {}),
		...(schema.hidden ? { hidden: true } : {}),
		...(schema.examples.length > 0
			? { examples: schema.examples.map((example) => serializeExample(example, meta)) }
			: {}),
		flags,
		// Args — always present (positional order matters)
		args: schema.args.map((entry) => serializeArgEntry(entry, opts)),
		// Subcommands — always present
		commands: schema.commands
			.filter((cmd) => opts.includeHidden || !cmd.hidden)
			.map((cmd) => serializeCommand(cmd, opts, meta)),
	};
}

// --- Flag serialization

/**
 * Serialize a {@link FlagSchema} into a plain object.
 *
 * @param schema - The flag schema to serialize.
 * @param opts - Resolved generation options (prompt inclusion).
 * @returns JSON-serializable object representing the flag.
 */
function serializeFlag(schema: FlagSchema, opts: ResolvedOptions): FlagDefinitionFragmentV1 {
	const visibleAliases = getFlagAliasNames(schema);
	const stringConstraints = schema.stringConstraints;
	const pathChecks = schema.pathChecks;
	const negation = schema.negation;

	return {
		kind: schema.kind,
		presence: schema.presence,
		...(schema.presence === 'defaulted' && isJsonSerializable(schema.defaultValue)
			? { defaultValue: schema.defaultValue }
			: {}),
		...(visibleAliases.length > 0 ? { aliases: [...visibleAliases] } : {}),
		...(schema.stdin !== undefined ? { stdin: serializeStdin(schema.stdin) } : {}),
		...(schema.envVar !== undefined ? { envVar: schema.envVar } : {}),
		...(schema.configPath !== undefined ? { configPath: schema.configPath } : {}),
		...(schema.description !== undefined ? { description: schema.description } : {}),
		...(schema.enumValues !== undefined ? { enumValues: [...schema.enumValues] } : {}),
		...(schema.numberConstraints !== undefined
			? { numberConstraints: { ...schema.numberConstraints } }
			: {}),
		...(stringConstraints !== undefined
			? { stringConstraints: serializeStringConstraints(stringConstraints) }
			: {}),
		...(schema.elementSchema !== undefined
			? { elementSchema: serializeFlag(schema.elementSchema, opts) }
			: {}),
		...(schema.separator !== undefined ? { separator: schema.separator } : {}),
		...(schema.split !== undefined ? { split: serializeSplit(schema.split) } : {}),
		...(schema.duplicateKeys !== 'last' ? { duplicateKeys: schema.duplicateKeys } : {}),
		...(schema.unique ? { unique: true } : {}),
		...(pathChecks !== undefined ? { pathChecks: serializePathChecks(pathChecks) } : {}),
		...(schema.valueHint !== undefined ? { valueHint: schema.valueHint } : {}),
		...(opts.includePrompts && schema.prompt !== undefined
			? { prompt: serializePrompt(schema.prompt) }
			: {}),
		...(schema.deprecated !== undefined ? { deprecated: schema.deprecated } : {}),
		...(schema.propagate ? { propagate: true } : {}),
		...(negation !== undefined
			? {
					negation: {
						...(negation.alias !== undefined ? { alias: negation.alias } : {}),
						...(negation.hidden ? { hidden: true } : {}),
					},
				}
			: {}),
		...(schema.duplicates !== 'last' ? { duplicates: schema.duplicates } : {}),
	};
}

/**
 * Serialize {@link StringConstraints} into a plain object.
 *
 * @param constraints - The string constraints to serialize.
 * @returns JSON-serializable object with the pattern split into source and flags.
 */
function serializeStringConstraints(
	constraints: StringConstraints,
): FlagStringConstraintsFragmentV1 {
	const pattern = constraints.pattern;
	return {
		...(constraints.nonEmpty !== undefined ? { nonEmpty: constraints.nonEmpty } : {}),
		...(constraints.minLength !== undefined ? { minLength: constraints.minLength } : {}),
		...(constraints.maxLength !== undefined ? { maxLength: constraints.maxLength } : {}),
		...(pattern !== undefined ? { pattern: { source: pattern.source, flags: pattern.flags } } : {}),
	};
}

/**
 * Serialize {@link PathChecks} into a plain object.
 *
 * @param checks - The filesystem expectations to serialize.
 * @returns JSON-serializable object omitting the defaults.
 */
function serializePathChecks(checks: PathChecks): FlagPathChecksFragmentV1 {
	return {
		mustExist: checks.mustExist,
		...(checks.type !== undefined ? { type: checks.type } : {}),
		...(checks.create ? { create: true } : {}),
	};
}

// --- Arg serialization

/**
 * Serialize a {@link CommandArgEntry} into a plain object.
 *
 * @param entry - The positional arg entry (name + {@link ArgSchema}).
 * @param opts - Resolved generation options (prompt inclusion).
 * @returns JSON-serializable object representing the arg.
 */
function serializeArgEntry(entry: CommandArgEntry, opts: ResolvedOptions): ArgDefinitionFragmentV1 {
	const { name, schema } = entry;
	const stringConstraints = schema.stringConstraints;
	const pathChecks = schema.pathChecks;

	return {
		name,
		kind: schema.kind,
		presence: schema.presence,
		...(schema.variadic ? { variadic: true } : {}),
		...(schema.stdin !== undefined ? { stdin: serializeStdin(schema.stdin) } : {}),
		...(schema.presence === 'defaulted' && isJsonSerializable(schema.defaultValue)
			? { defaultValue: schema.defaultValue }
			: {}),
		...(schema.description !== undefined ? { description: schema.description } : {}),
		...(schema.envVar !== undefined ? { envVar: schema.envVar } : {}),
		...(schema.configPath !== undefined ? { configPath: schema.configPath } : {}),
		...(schema.enumValues !== undefined ? { enumValues: [...schema.enumValues] } : {}),
		...(schema.numberConstraints !== undefined
			? { numberConstraints: { ...schema.numberConstraints } }
			: {}),
		...(stringConstraints !== undefined
			? { stringConstraints: serializeStringConstraints(stringConstraints) }
			: {}),
		...(pathChecks !== undefined ? { pathChecks: serializePathChecks(pathChecks) } : {}),
		...(schema.valueHint !== undefined ? { valueHint: schema.valueHint } : {}),
		...(schema.separator !== undefined ? { separator: schema.separator } : {}),
		...(schema.split !== undefined ? { split: serializeSplit(schema.split) } : {}),
		...(schema.duplicateKeys !== 'last' ? { duplicateKeys: schema.duplicateKeys } : {}),
		...(schema.unique ? { unique: true } : {}),
		...(opts.includePrompts && schema.prompt !== undefined
			? { prompt: serializePrompt(schema.prompt) }
			: {}),
		...(schema.deprecated !== undefined ? { deprecated: schema.deprecated } : {}),
	};
}

/**
 * Serialize the non-CLI split policies of a collection.
 *
 * @param split - The stored split binding.
 * @returns JSON-serializable object naming only the sources it sets.
 */
function serializeSplit(split: SourceSplitBinding): SourceSplitFragmentV1 {
	return {
		...(split.env !== undefined ? { env: { ...split.env } } : {}),
		...(split.stdin !== undefined ? { stdin: { ...split.stdin } } : {}),
	};
}

/**
 * Serialize a {@link StdinBinding} into a plain object.
 *
 * @param stdin - The stdin axis to serialize.
 * @returns JSON-serializable object naming the trigger and the sharing mode.
 */
function serializeStdin(stdin: StdinBinding): StdinBindingFragmentV1 {
	return { when: stdin.when, consume: stdin.consume };
}

// --- Prompt serialization

/**
 * Serialize a {@link PromptConfig} into a plain object.
 *
 * @param prompt - The prompt configuration to serialize.
 * @returns JSON-serializable object representing the prompt.
 */
function serializePrompt(prompt: PromptConfig): PromptDefinitionFragmentV1 {
	switch (prompt.kind) {
		case 'input':
			// validate fn omitted — not serializable
			return {
				kind: prompt.kind,
				message: prompt.message,
				...(prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
			};
		case 'select':
			return {
				kind: prompt.kind,
				message: prompt.message,
				...(prompt.choices !== undefined ? { choices: prompt.choices.map(serializeChoice) } : {}),
			};
		case 'multiselect':
			return {
				kind: prompt.kind,
				message: prompt.message,
				...(prompt.choices !== undefined ? { choices: prompt.choices.map(serializeChoice) } : {}),
				...(prompt.min !== undefined ? { min: prompt.min } : {}),
				...(prompt.max !== undefined ? { max: prompt.max } : {}),
			};
		case 'confirm':
			return { kind: prompt.kind, message: prompt.message };
	}
}

/**
 * Serialize a {@link SelectChoice} into a plain object.
 *
 * @param choice - The select/multiselect choice to serialize.
 * @returns JSON-serializable object with value, optional label and description.
 */
function serializeChoice(choice: SelectChoice): PromptChoiceFragmentV1 {
	return {
		value: choice.value,
		...(choice.label !== undefined ? { label: choice.label } : {}),
		...(choice.description !== undefined ? { description: choice.description } : {}),
	};
}

// --- Example serialization

/**
 * Serialize a {@link CommandExample} into a plain object.
 *
 * Function-form commands are resolved against `meta` so the output is a plain
 * serializable string rather than a dropped function.
 *
 * @param example - The example to serialize.
 * @param meta - Program name/version passed to function-form commands.
 * @returns JSON-serializable object with command and optional description.
 */
function serializeExample(example: CommandExample, meta: ExampleMeta): ExampleDefinitionFragmentV1 {
	return {
		command: resolveExampleCommand(example.command, meta),
		...(example.description !== undefined ? { description: example.description } : {}),
	};
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
): InputSchemaDocument {
	const opts = resolveOptions(options);

	// Discriminate between a leaf/group command schema and the CLI root schema.
	if (isCommandSchema(schema)) {
		return {
			$schema: JSON_SCHEMA_DRAFT,
			...commandToInputSchema(schema),
		};
	}

	// CLISchema — collect all invocable commands into branches
	const branches: InputSchemaBranch[] = [];
	for (const cmd of schema.commands) {
		if (!opts.includeHidden && cmd.hidden) continue;
		collectInputBranches(cmd, '', branches, opts);
	}

	// Single branch: emit flat (no oneOf wrapper)
	const [onlyBranch] = branches;
	if (branches.length === 1 && onlyBranch !== undefined) {
		return {
			$schema: JSON_SCHEMA_DRAFT,
			...stripCommandDiscriminator(onlyBranch),
		};
	}

	// Multiple branches: discriminated union
	if (branches.length > 0) {
		const defaultBranchName =
			schema.defaultCommand !== undefined && (opts.includeHidden || !schema.defaultCommand.hidden)
				? schema.defaultCommand.name
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
 * command schemas always carry flags, args, and hasAction, while the CLI root
 * schema does not expose that execution surface.
 */
function isCommandSchema(schema: CLISchema | CommandSchema): schema is CommandSchema {
	return 'flags' in schema && 'args' in schema && 'hasAction' in schema;
}

/** Recursively collect input schema branches for all invocable commands. */
function collectInputBranches(
	schema: CommandSchema,
	prefix: string,
	branches: InputSchemaBranch[],
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
function commandToInputSchema(schema: CommandSchema, commandPath?: string): InputSchemaBranch {
	const properties: Record<string, InputSchemaProperty> = {};
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

	return {
		type: 'object',
		properties,
		additionalProperties: false,
		...(required.length > 0 ? { required } : {}),
	};
}

/** @internal */
function stripCommandDiscriminator(branch: InputSchemaBranch): InputSchemaBranch {
	const { command: _discriminator, ...properties } = branch.properties;
	const required = branch.required?.filter((value) => value !== 'command');

	return {
		type: branch.type,
		properties,
		additionalProperties: branch.additionalProperties,
		...(required !== undefined && required.length > 0 ? { required } : {}),
	};
}

function getBranchCommandDiscriminator(branch: InputSchemaBranch): string | undefined {
	const commandValue = branch.properties.command;
	if (commandValue === undefined) {
		return undefined;
	}

	const constValue = commandValue.const;
	return typeof constValue === 'string' ? constValue : undefined;
}

// --- Type mapping — flags → JSON Schema types

function flagToJsonSchemaType(schema: FlagSchema): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	switch (schema.kind) {
		case 'string': {
			result.type = 'string';
			const constraints = schema.stringConstraints;
			// nonEmpty is expressible as minLength >= 1 in JSON Schema.
			const minLength =
				constraints?.nonEmpty === true
					? Math.max(constraints.minLength ?? 1, 1)
					: constraints?.minLength;
			if (minLength !== undefined) {
				result.minLength = minLength;
			}
			if (constraints?.maxLength !== undefined) {
				result.maxLength = constraints.maxLength;
			}
			if (constraints?.pattern !== undefined) {
				result.pattern = constraints.pattern.source;
			}
			break;
		}
		case 'number': {
			const constraints = schema.numberConstraints;
			result.type = constraints?.int === true ? 'integer' : 'number';
			if (constraints?.min !== undefined) {
				result.minimum = constraints.min;
			}
			if (constraints?.max !== undefined) {
				result.maximum = constraints.max;
			}
			break;
		}
		case 'boolean':
			result.type = 'boolean';
			break;
		case 'enum':
			result.type = 'string';
			if (schema.enumValues !== undefined) {
				result.enum = [...schema.enumValues];
			}
			break;
		case 'array':
			result.type = 'array';
			if (schema.elementSchema !== undefined) {
				result.items = flagToJsonSchemaType(schema.elementSchema);
			}
			break;
		case 'custom':
			// Opaque type — no JSON Schema constraint
			break;
		case 'count':
			result.type = 'integer';
			result.minimum = 0;
			break;
		case 'keyValue':
			result.type = 'object';
			result.additionalProperties = { type: 'string' };
			break;
	}

	if (schema.description !== undefined) {
		result.description = schema.description;
	}
	if (schema.presence === 'defaulted' && isJsonSerializable(schema.defaultValue)) {
		result.default = schema.defaultValue;
	}
	if (schema.deprecated !== undefined) {
		result.deprecated = schema.deprecated;
	}

	return result;
}

// --- Type mapping — args → JSON Schema types

function argToJsonSchemaType(schema: ArgSchema): Record<string, unknown> {
	const kind = argKindToType(schema);
	const result: Record<string, unknown> =
		schema.variadic && schema.kind !== 'keyValue' ? { type: 'array', items: kind } : { ...kind };

	if (schema.description !== undefined) {
		result.description = schema.description;
	}
	if (schema.presence === 'defaulted' && isJsonSerializable(schema.defaultValue)) {
		result.default = schema.defaultValue;
	}
	if (schema.deprecated !== undefined) {
		result.deprecated = schema.deprecated;
	}

	return result;
}

/** Map an arg's kind to a JSON Schema type fragment. */
function argKindToType(schema: ArgSchema): Record<string, unknown> {
	switch (schema.kind) {
		case 'string': {
			const result: Record<string, unknown> = { type: 'string' };
			const constraints = schema.stringConstraints;
			// nonEmpty is expressible as minLength >= 1 in JSON Schema.
			const minLength =
				constraints?.nonEmpty === true
					? Math.max(constraints.minLength ?? 1, 1)
					: constraints?.minLength;
			if (minLength !== undefined) {
				result.minLength = minLength;
			}
			if (constraints?.maxLength !== undefined) {
				result.maxLength = constraints.maxLength;
			}
			if (constraints?.pattern !== undefined) {
				result.pattern = constraints.pattern.source;
			}
			return result;
		}
		case 'number': {
			const constraints = schema.numberConstraints;
			const result: Record<string, unknown> = {
				type: constraints?.int === true ? 'integer' : 'number',
			};
			if (constraints?.min !== undefined) {
				result.minimum = constraints.min;
			}
			if (constraints?.max !== undefined) {
				result.maximum = constraints.max;
			}
			return result;
		}
		case 'enum': {
			const result: Record<string, unknown> = { type: 'string' };
			if (schema.enumValues !== undefined) {
				result.enum = [...schema.enumValues];
			}
			return result;
		}
		case 'boolean':
			return { type: 'boolean' };
		case 'keyValue':
			return { type: 'object', additionalProperties: { type: 'string' } };
		case 'custom':
			return {};
	}
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

// === Definition meta-schema

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
 * Command-fragment property schemas shared by the nested `command` def and
 * the standalone `commandDocument` def, so the two cannot drift.
 */
const commandFragmentProperties = {
	name: { type: 'string' },
	description: { type: 'string' },
	aliases: { type: 'array', items: { type: 'string' } },
	hidden: { const: true },
	examples: { type: 'array', items: { $ref: '#/$defs/example' } },
	flags: { type: 'object', additionalProperties: { $ref: '#/$defs/flag' } },
	args: { type: 'array', items: { $ref: '#/$defs/arg' } },
	commands: { type: 'array', items: { $ref: '#/$defs/command' } },
} as const;

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
			defaultCommand: { $ref: '#/$defs/command' },
			commands: { type: 'array', items: { $ref: '#/$defs/command' } },
		},
		required: ['$schema', 'schemaVersion', 'name', 'commands'],
		$defs: {
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
					...commandFragmentProperties,
				},
				required: ['schemaVersion', 'name', 'flags', 'args', 'commands'],
			},
			flag: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kind: {
						enum: ['string', 'number', 'boolean', 'enum', 'array', 'custom', 'count', 'keyValue'],
					},
					presence: { enum: ['optional', 'required', 'defaulted'] },
					defaultValue: {},
					aliases: { type: 'array', items: { type: 'string' } },
					stdin: { $ref: '#/$defs/stdin' },
					envVar: { type: 'string' },
					configPath: { type: 'string' },
					description: { type: 'string' },
					enumValues: { type: 'array', items: { type: 'string' } },
					numberConstraints: { $ref: '#/$defs/numberConstraints' },
					stringConstraints: { $ref: '#/$defs/stringConstraints' },
					elementSchema: { $ref: '#/$defs/flag' },
					separator: { type: 'string', minLength: 1 },
					split: { $ref: '#/$defs/split' },
					duplicateKeys: { enum: ['first', 'last', 'error'] },
					unique: { type: 'boolean' },
					pathChecks: { $ref: '#/$defs/pathChecks' },
					valueHint: { type: 'string' },
					prompt: { $ref: '#/$defs/prompt' },
					deprecated: { oneOf: [{ type: 'string' }, { const: true }] },
					propagate: { const: true },
					negation: { $ref: '#/$defs/negation' },
					duplicates: { enum: ['last', 'first', 'error'] },
				} satisfies Record<SerializedFlagField, Record<string, unknown>>,
				required: ['kind', 'presence'],
			},
			stdin: {
				type: 'object',
				additionalProperties: false,
				properties: {
					when: { enum: ['dash', 'missing', 'dash-or-missing'] },
					consume: { enum: ['exclusive', 'broadcast'] },
				} satisfies Record<keyof StdinBindingFragmentV1, Record<string, unknown>>,
				required: ['when', 'consume'],
			},
			split: {
				type: 'object',
				additionalProperties: false,
				properties: {
					env: { $ref: '#/$defs/splitPolicy' },
					stdin: { $ref: '#/$defs/splitPolicy' },
				} satisfies Record<keyof SourceSplitFragmentV1, Record<string, unknown>>,
			},
			splitPolicy: {
				type: 'object',
				additionalProperties: false,
				properties: {
					format: { enum: ['whole', 'delimiter', 'lines', 'json'] },
					delimiter: { type: 'string', minLength: 1 },
				},
				required: ['format'],
			},
			negation: {
				type: 'object',
				additionalProperties: false,
				properties: {
					alias: { type: 'string' },
					hidden: { const: true },
				},
			},
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
			pathChecks: {
				type: 'object',
				additionalProperties: false,
				properties: {
					mustExist: { type: 'boolean' },
					type: { enum: ['file', 'directory'] },
					create: { type: 'boolean' },
				},
				required: ['mustExist'],
			},
			arg: {
				type: 'object',
				additionalProperties: false,
				properties: {
					name: { type: 'string' },
					kind: { enum: ['string', 'number', 'boolean', 'enum', 'custom', 'keyValue'] },
					presence: { enum: ['required', 'optional', 'defaulted'] },
					variadic: { const: true },
					stdin: { $ref: '#/$defs/stdin' },
					defaultValue: {},
					description: { type: 'string' },
					envVar: { type: 'string' },
					configPath: { type: 'string' },
					enumValues: { type: 'array', items: { type: 'string' } },
					numberConstraints: { $ref: '#/$defs/numberConstraints' },
					stringConstraints: { $ref: '#/$defs/stringConstraints' },
					pathChecks: { $ref: '#/$defs/pathChecks' },
					valueHint: { type: 'string' },
					separator: { type: 'string', minLength: 1 },
					split: { $ref: '#/$defs/split' },
					duplicateKeys: { enum: ['first', 'last', 'error'] },
					unique: { type: 'boolean' },
					prompt: { $ref: '#/$defs/prompt' },
					deprecated: { oneOf: [{ type: 'string' }, { const: true }] },
				} satisfies Record<SerializedArgField, Record<string, unknown>>,
				required: ['name', 'kind', 'presence'],
			},
			prompt: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kind: { enum: ['confirm', 'input', 'select', 'multiselect'] },
					message: { type: 'string' },
					placeholder: { type: 'string' },
					choices: { type: 'array', items: { $ref: '#/$defs/choice' } },
					min: { type: 'integer' },
					max: { type: 'integer' },
				},
				required: ['kind', 'message'],
			},
			choice: {
				type: 'object',
				additionalProperties: false,
				properties: {
					value: { type: 'string' },
					label: { type: 'string' },
					description: { type: 'string' },
				},
				required: ['value'],
			},
			example: {
				type: 'object',
				additionalProperties: false,
				properties: {
					command: { type: 'string' },
					description: { type: 'string' },
				},
				required: ['command'],
			},
		},
	},
	definitionMetaSchemaDescriptions,
);

// === Exports

export type {
	ArgDefinitionFragmentV1,
	CommandDefinitionDocument,
	CommandDefinitionDocumentV1,
	CommandDefinitionFragmentV1,
	DefinitionDocument,
	DefinitionDocumentV1,
	ExampleDefinitionFragmentV1,
	FlagDefinitionFragmentV1,
	FlagNegationFragmentV1,
	FlagPathChecksFragmentV1,
	FlagStringConstraintsFragmentV1,
	InputSchemaBranch,
	InputSchemaDocument,
	InputSchemaProperty,
	JsonSchemaOptions,
	PromptChoiceFragmentV1,
	PromptDefinitionFragmentV1,
	SourceSplitFragmentV1,
	SplitPolicyFragmentV1,
	StdinBindingFragmentV1,
};
export { definitionMetaSchema, generateCommandSchema, generateInputSchema, generateSchema };
