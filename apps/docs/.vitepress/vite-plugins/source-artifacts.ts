/**
 * Vite plugin that keeps docs schema artifact available.
 *
 * Twoslash examples import `@kjanat/dreamcli/schema`, which resolves
 * through tsconfig paths to the package `dreamcli.schema.json` file. This
 * plugin ensures that file exists during docs dev/build and emits it into
 * docs dist for hosting.
 *
 * @module
 */

import { normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Plugin } from 'vitepress';

const rootDir = normalize(`${import.meta.dirname}/../../../..`);
const packageRoot = `${rootDir}/packages/dreamcli`;
const definitionSchemaPath = `${packageRoot}/dreamcli.schema.json`;
const emitDefinitionSchemaPath = `${packageRoot}/scripts/emit-definition-schema.ts`;
const emitDefinitionSchemaUrl = pathToFileURL(emitDefinitionSchemaPath).href;

export function sourceArtifactsPlugin(): Plugin {
	let buildingPromise: Promise<void> | null = null;
	let dirtySchema = false;

	async function ensureSchema(): Promise<void> {
		if (buildingPromise !== null) {
			dirtySchema = true;
			return buildingPromise;
		}

		const pending = (async () => {
			const { emitDefinitionSchema } = await import(`${emitDefinitionSchemaUrl}?t=${Date.now()}`);
			await emitDefinitionSchema();
		})();
		buildingPromise = pending;

		try {
			await pending;
		} finally {
			if (buildingPromise === pending) {
				buildingPromise = null;
			}
			if (dirtySchema) {
				dirtySchema = false;
				await ensureSchema();
			}
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
			let debounceTimer: ReturnType<typeof setTimeout> | undefined;

			const handleSrcChange = (file: string): void => {
				if (
					file.startsWith(`${packageRoot}/src/`) &&
					file.endsWith('.ts') &&
					!file.endsWith('.test.ts') &&
					!file.endsWith('.generated.ts')
				) {
					clearTimeout(debounceTimer);
					debounceTimer = setTimeout(() => {
						ensureSchema().catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: '[dreamcli-source-artifacts] Unknown error';
							server.config.logger.error(message);
						});
					}, 200);
				}
			};
			server.watcher.on('change', handleSrcChange);
			server.watcher.on('add', handleSrcChange);
			server.watcher.on('unlink', handleSrcChange);
		},
	};
}

type ReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;

async function readExistingSchema(readFile: ReadFile, schemaPath: string): Promise<string> {
	try {
		return await readFile(schemaPath, 'utf-8');
	} catch (error) {
		const cause = error instanceof Error ? error.message : String(error);
		throw new Error(
			`[dreamcli-source-artifacts] Missing ${schemaPath}: ${cause}. Run \`bun --cwd packages/dreamcli scripts/emit-definition-schema.ts\` before docs build.`,
		);
	}
}
