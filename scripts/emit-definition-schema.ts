/**
 * Emit the definition meta-schema as `dreamcli.schema.json` at the package root.
 *
 * Detects the runtime to set the registry-specific `$id`:
 * - Deno     → JSR URL
 * - Bun/Node → npm CDN URL
 */

import { writeFile } from 'node:fs/promises';
import { normalize } from 'node:path';
import { definitionMetaSchema } from '@kjanat/dreamcli';
import { name as jsrName } from '../deno.json' with { type: 'json' };
import { name as npmName } from '../package.json' with { type: 'json' };

const outFile = normalize(`${import.meta.dirname}/../dreamcli.schema.json`);

const schemaId =
	typeof globalThis.Deno !== 'undefined'
		? `https://jsr.io/@${jsrName}/schema`
		: `https://cdn.jsdelivr.net/npm/@${npmName}/schema`;

export async function emitDefinitionSchema(): Promise<void> {
	const schema = { ...definitionMetaSchema, $id: schemaId };
	const schemaStr = JSON.stringify(schema, null, '  ');
	await writeFile(outFile, schemaStr, 'utf-8');
	console.error(`Definition schema emitted to ${outFile}`);
}

// Direct invocation
if (import.meta.main) {
	try {
		await emitDefinitionSchema();
	} catch (error) {
		console.error('Failed to emit definition schema', error);
		process.exit(1);
	}
}
