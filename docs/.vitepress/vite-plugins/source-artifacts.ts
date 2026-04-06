/**
 * Vite plugin that keeps docs schema artifact available.
 *
 * Twoslash examples import `@kjanat/dreamcli/schema`, which resolves
 * through tsconfig paths to the root `dreamcli.schema.json` file. This
 * plugin ensures that file exists during docs dev/build and emits it into
 * docs dist for hosting.
 *
 * @module
 */

import { normalize } from 'node:path';

import type { Plugin } from 'vitepress';

const rootDir = normalize(`${import.meta.dirname}/../../..`);
const definitionSchemaPath = `${rootDir}/dreamcli.schema.json`;

export function sourceArtifactsPlugin(): Plugin {
	let building = false;

	async function ensureSchema(): Promise<void> {
		if (building) {
			return;
		}

		building = true;
		try {
			const { emitDefinitionSchema } = await import(`${rootDir}/scripts/emit-definition-schema.ts`);
			await emitDefinitionSchema();
		} finally {
			building = false;
		}
	}

	return {
		name: 'dreamcli-source-artifacts',

		async buildStart() {
			await ensureSchema();
		},

		async generateBundle() {
			const { readFile } = await import('node:fs/promises');
			const schema = await readExistingSchema(readFile, definitionSchemaPath);
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
					ensureSchema().catch((error: unknown) => {
						const message =
							error instanceof Error ? error.message : '[dreamcli-source-artifacts] Unknown error';
						server.config.logger.error(message);
					});
				}
			});
		},
	};
}

type ReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;

async function readExistingSchema(readFile: ReadFile, schemaPath: string): Promise<string> {
	try {
		return await readFile(schemaPath, 'utf-8');
	} catch {
		throw new Error(
			`[dreamcli-source-artifacts] Missing ${schemaPath}. Run \`bun --bun scripts/emit-definition-schema.ts\` before docs build.`,
		);
	}
}
