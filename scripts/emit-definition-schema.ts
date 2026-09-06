#!/usr/bin/env bun
/**
 * Emit the definition meta-schema as `dreamcli.schema.json` at the package root.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { normalize } from 'node:path';
import { execPath, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { definitionMetaSchema } from '@kjanat/dreamcli/json-schema';

const outFile = normalize(`${import.meta.dirname}/../dreamcli.schema.json`);
const dprintBin = fileURLToPath(import.meta.resolve('dprint/bin.cjs'));
const formatSchema = promisify(execFile);

export async function emitDefinitionSchema(): Promise<void> {
	const schemaStr = `${JSON.stringify(definitionMetaSchema, null, '  ')}\n`;
	await writeFile(outFile, schemaStr, 'utf-8');
	// Builds and docs must reproduce the tracked schema's configured key order.
	await formatSchema(execPath, [dprintBin, 'fmt', outFile], {
		cwd: normalize(`${import.meta.dirname}/..`),
	});
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
