/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import {
	buildDefinitionMetaSchemaDescriptions,
	renderDefinitionMetaSchemaDescriptions,
} from './meta-schema-descriptions.ts';
import { createTypeDocFixture } from './typedoc-fixture.ts';

const collectModel = createTypeDocFixture();

describe('definition meta-schema descriptions', () => {
	it('extracts root and nested property descriptions from the normalized TypeDoc model', {
		timeout: 60_000,
	}, async () => {
		const { normalized } = await collectModel();
		const descriptions = buildDefinitionMetaSchemaDescriptions(normalized);

		expect(descriptions.root.description).toContain('Runtime descriptor for the CLI program.');
		expect(descriptions.root.properties?.name).toEqual({
			description: 'Program name (used in help text, usage lines, and completion scripts).',
		});
		expect(descriptions.defs.flag?.properties?.configPath).toEqual({
			description: "Dotted config path for v0.2+ resolution (e.g. `'deploy.region'`).",
		});
		expect(descriptions.defs.flagElement?.properties).not.toHaveProperty('sensitive');
		expect(descriptions.defs.flagElement?.properties).not.toHaveProperty('defaultDescription');
		expect(descriptions.defs.prompt?.properties?.message).toEqual({
			description: 'The question displayed to the user.',
		});
		expect(descriptions.defs.example?.properties?.command).toEqual({
			description: "The command invocation (e.g. `'deploy production --force'`).",
		});
	});

	it('renders the generated source module shape consumed by json-schema', {
		timeout: 60_000,
	}, async () => {
		const { normalized } = await collectModel();
		const rendered = renderDefinitionMetaSchemaDescriptions(
			buildDefinitionMetaSchemaDescriptions(normalized),
		);

		expect(rendered).toContain('const definitionMetaSchemaDescriptions = {');
		expect(rendered).toContain('"flag": {');
		expect(rendered).toContain('"flagElement": {');
		expect(rendered).toContain('"prompt": {');
		expect(rendered).toContain('export { definitionMetaSchemaDescriptions };');
	});
});
