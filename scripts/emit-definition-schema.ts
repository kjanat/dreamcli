#!/usr/bin/env bun
/**
 * Emit the definition meta-schema as `dreamcli.schema.json` at the package root.
 *
 * @module
 */

import { writeFile } from 'node:fs/promises';
import { normalize } from 'node:path';
import { exit } from 'node:process';
import { definitionMetaSchema } from '@kjanat/dreamcli';

const outFile = normalize(`${import.meta.dirname}/../dreamcli.schema.json`);

export async function emitDefinitionSchema(): Promise<void> {
	const schemaStr = `${JSON.stringify(definitionMetaSchema, null, '  ')}\n`;
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
