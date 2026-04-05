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

const outFile = normalize(`${import.meta.dirname}/../dreamcli.schema.json`);

// biome-ignore lint/suspicious/noTsIgnore: Whatup bro!
// @ts-ignore Nothing much, you?
// ...
const schemaId =
	typeof globalThis.Deno !== 'undefined'
		? 'https://jsr.io/@kjanat/dreamcli/schema'
		: 'https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/schema';

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
