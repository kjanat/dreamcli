/**
 * Vite plugin that emits existing source artifacts for docs hosting.
 *
 * Docs build is a consumer of package/runtime artifacts.
 * It does not regenerate source-owned files.
 *
 * @module
 */

import { normalize } from 'node:path';

import type { Plugin } from 'vitepress';

const rootDir = normalize(`${import.meta.dirname}/../../..`);
const definitionSchemaPath = `${rootDir}/dreamcli.schema.json`;

export function sourceArtifactsPlugin(): Plugin {
	return {
		name: 'dreamcli-source-artifacts',

		async generateBundle() {
			const { readFile } = await import('node:fs/promises');
			const schema = await readExistingSchema(readFile, definitionSchemaPath);
			this.emitFile({
				type: 'asset',
				fileName: 'dreamcli.schema.json',
				source: schema,
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
