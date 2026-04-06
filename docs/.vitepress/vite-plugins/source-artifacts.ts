/**
 * Vite plugin that rebuilds source-generated artifacts during docs dev/build.
 *
 * Watches `src/**\/*.ts` and regenerates:
 * - `dreamcli.schema.json` (definition meta-schema for the package export)
 * - `src/core/json-schema/meta-descriptions.generated.ts` (JSDoc descriptions)
 *
 * During docs builds, emits `dreamcli.schema.json` into the docs dist root
 * so `/dreamcli.schema.json` is available on docs hosting targets that upload
 * only `docs/.vitepress/dist`.
 *
 * These are runtime/package artifacts that the docs site depends on
 * (twoslash imports the schema, data loaders use the TypeDoc model).
 */

import { normalize } from 'node:path';

import type { Plugin } from 'vitepress';

const rootDir = normalize(`${import.meta.dirname}/../../..`);
const definitionSchemaPath = `${rootDir}/dreamcli.schema.json`;

export function sourceArtifactsPlugin(): Plugin {
	let building = false;

	async function rebuild(): Promise<void> {
		if (building) return;
		building = true;
		try {
			const [
				{ emitDefinitionSchema },
				{ collectPublicApiIndex },
				{ buildDefinitionMetaSchemaDescriptions, renderDefinitionMetaSchemaDescriptions },
				{ collectTypeDocModel },
				{ generatedMetaSchemaDescriptionsPath, packageJsonPath },
			] = await Promise.all([
				import(`${rootDir}/scripts/emit-definition-schema.ts`),
				import(`${rootDir}/docs/.vitepress/data/api-index.ts`),
				import(`${rootDir}/docs/.vitepress/data/meta-schema-descriptions.ts`),
				import(`${rootDir}/docs/.vitepress/data/typedoc.ts`),
				import(`${rootDir}/docs/.vitepress/data/paths.ts`),
			]);

			const { writeFile } = await import('node:fs/promises');

			const [, publicApi] = await Promise.all([
				emitDefinitionSchema(),
				collectPublicApiIndex(packageJsonPath),
			]);
			const typeDoc = await collectTypeDocModel(packageJsonPath, publicApi);
			const descriptions = buildDefinitionMetaSchemaDescriptions(typeDoc.normalized);
			await writeFile(
				generatedMetaSchemaDescriptionsPath,
				renderDefinitionMetaSchemaDescriptions(descriptions),
			);
		} finally {
			building = false;
		}
	}

	return {
		name: 'dreamcli-source-artifacts',

		async buildStart() {
			await rebuild();
		},

		async generateBundle() {
			const { readFile } = await import('node:fs/promises');
			const schema = await readFile(definitionSchemaPath, 'utf-8');
			this.emitFile({
				type: 'asset',
				fileName: 'dreamcli.schema.json',
				source: schema,
			});
		},

		configureServer(server) {
			server.watcher.on('change', (file) => {
				if (
					file.startsWith(`${rootDir}/src/`) &&
					file.endsWith('.ts') &&
					!file.endsWith('.test.ts') &&
					!file.endsWith('.generated.ts')
				) {
					rebuild().catch((err) => {
						server.config.logger.error(`[dreamcli-source-artifacts] ${err.message}`);
					});
				}
			});
		},
	};
}
