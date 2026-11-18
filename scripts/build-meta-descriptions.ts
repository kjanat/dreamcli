#!/usr/bin/env bun

/**
 * Rebuild `src/core/json-schema/meta-descriptions.generated.ts`.
 *
 * This is a source code artifact (consumed at runtime by the JSON Schema
 * module), not a docs artifact. It extracts JSDoc descriptions from the
 * normalized documentation model and writes them as a typed constant.
 *
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises';

import { collectPublicApiIndex } from '../docs/.vitepress/data/api-index.ts';
import { collectDenoDocModel } from '../docs/.vitepress/data/deno-doc.ts';
import {
	buildDefinitionMetaSchemaDescriptions,
	renderDefinitionMetaSchemaDescriptions,
} from '../docs/.vitepress/data/meta-schema-descriptions.ts';
import {
	generatedMetaSchemaDescriptionsPath,
	packageJsonPath,
} from '../docs/.vitepress/data/paths.ts';

const publicApi = await collectPublicApiIndex(packageJsonPath);
const api = await collectDenoDocModel(packageJsonPath, publicApi);
const metaSchemaDescriptions = buildDefinitionMetaSchemaDescriptions(api);
const rendered = await formatGeneratedSource(
	renderDefinitionMetaSchemaDescriptions(metaSchemaDescriptions),
);
const checkMode = Bun.argv.includes('--check');

if (checkMode) {
	const existing = await readFile(generatedMetaSchemaDescriptionsPath, 'utf8');
	if (existing !== rendered) {
		console.error(
			'✗ src/core/json-schema/meta-descriptions.generated.ts is out of date. Run `bun run meta-descriptions`.',
		);
		process.exit(1);
	}
	console.log('✓ src/core/json-schema/meta-descriptions.generated.ts is up to date');
	process.exit(0);
}

await writeFile(generatedMetaSchemaDescriptionsPath, rendered);
console.log('✓ src/core/json-schema/meta-descriptions.generated.ts updated');

/** Pipe generated source through kprint via stdin for consistent formatting. */
async function formatGeneratedSource(source: string): Promise<string> {
	return Bun.$`bunx --bun @kjanat/fmt --stdin ts < ${Buffer.from(source)}`.text();
}
