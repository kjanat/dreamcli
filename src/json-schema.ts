/**
 * Definition documents and input JSON Schema generation.
 *
 * `--help --json` loads this module on demand. Import it directly to emit
 * definition documents or input schemas from build scripts and tooling.
 *
 * @module @kjanat/dreamcli/json-schema
 */

export type {
	ArgDefinitionFragmentV1,
	ArgElementFragmentV1,
	CommandDefinitionDocument,
	CommandDefinitionDocumentV1,
	CommandDefinitionFragmentV1,
	DefinitionDocument,
	DefinitionDocumentV1,
	ExampleDefinitionFragmentV1,
	FlagDefinitionFragmentV1,
	FlagElementFragmentV1,
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
} from './core/json-schema/index.ts';
export {
	DEFINITION_SCHEMA_URL,
	DEFINITION_SCHEMA_VERSION,
	definitionMetaSchema,
	generateCommandSchema,
	generateInputSchema,
	generateSchema,
} from './core/json-schema/index.ts';
