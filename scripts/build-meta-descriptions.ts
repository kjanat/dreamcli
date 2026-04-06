#!/usr/bin/env bun

/**
 * Rebuild `src/core/json-schema/meta-descriptions.generated.ts`.
 *
 * This is a source code artifact (consumed at runtime by the JSON Schema
 * module), not a docs artifact. It extracts JSDoc descriptions from the
 * normalized TypeDoc model and writes them as a typed constant.
 *
 * @module
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { collectPublicApiIndex } from '../docs/.vitepress/data/api-index.ts';
import {
	buildDefinitionMetaSchemaDescriptions,
	renderDefinitionMetaSchemaDescriptions,
} from '../docs/.vitepress/data/meta-schema-descriptions.ts';
import {
	generatedMetaSchemaDescriptionsPath,
	packageJsonPath,
} from '../docs/.vitepress/data/paths.ts';
import { collectTypeDocModel } from '../docs/.vitepress/data/typedoc.ts';

const publicApi = await collectPublicApiIndex(packageJsonPath);
const typeDoc = await collectTypeDocModel(packageJsonPath, publicApi);
const metaSchemaDescriptions = buildDefinitionMetaSchemaDescriptions(typeDoc.normalized);
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

async function formatGeneratedSource(source: string): Promise<string> {
	const tempFilePath = join(
		dirname(generatedMetaSchemaDescriptionsPath),
		'.meta-descriptions.generated.tmp.ts',
	);

	try {
		await writeFile(tempFilePath, source);
		await Bun.$`bunx --bun dprint fmt ${tempFilePath}`.quiet();
		return await readFile(tempFilePath, 'utf8');
	} finally {
		await rm(tempFilePath, { force: true });
	}
}
