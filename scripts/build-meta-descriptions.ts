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

import { writeFile } from 'node:fs/promises';

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
await writeFile(
	generatedMetaSchemaDescriptionsPath,
	renderDefinitionMetaSchemaDescriptions(metaSchemaDescriptions),
);
