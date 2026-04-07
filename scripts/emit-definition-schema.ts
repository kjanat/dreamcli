/**
 * Emit the definition meta-schema as `dreamcli.schema.json` at the package root.
 *
 * Uses `REGISTRY` to set the registry-specific `$id`:
 * - `jsr`            → esm.sh JSR URL
 * - `npm` or unset   → npm CDN URL
 *
 * @module
 */

import { writeFile } from 'node:fs/promises';
import { normalize } from 'node:path';
import { env, exit } from 'node:process';
import { definitionMetaSchema } from '@kjanat/dreamcli';
import denoJson from '../deno.json' with { type: 'json' };
import packageJson from '../package.json' with { type: 'json' };

const outFile = normalize(`${import.meta.dirname}/../dreamcli.schema.json`);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveSchemaId(): string {
	const registry = env.REGISTRY;

	if (registry === undefined || registry === '' || registry === 'npm') {
		return `https://cdn.jsdelivr.net/npm/${packageJson.name}/schema`;
	}

	if (registry === 'jsr') {
		return `https://esm.sh/jsr/${denoJson.name}/schema`;
	}

	throw new Error(`Invalid REGISTRY value: ${registry}. Expected npm or jsr.`);
}

export async function emitDefinitionSchema(): Promise<void> {
	const schemaId = resolveSchemaId();
	const schema = {
		...definitionMetaSchema,
		$id: schemaId,
		properties: isRecord(definitionMetaSchema.properties)
			? {
					...definitionMetaSchema.properties,
					$schema: isRecord(definitionMetaSchema.properties.$schema)
						? {
								...definitionMetaSchema.properties.$schema,
								const: schemaId,
							}
						: definitionMetaSchema.properties.$schema,
				}
			: definitionMetaSchema.properties,
	};

	const schemaStr = `${JSON.stringify(schema, null, '  ')}\n`;
	await writeFile(outFile, schemaStr, 'utf-8');
	console.error(`Definition schema emitted to ${outFile}`);
}

// Direct invocation
if (import.meta.main) {
	try {
		await emitDefinitionSchema();
	} catch (error) {
		console.error('Failed to emit definition schema', error);
		exit(1);
	}
}
