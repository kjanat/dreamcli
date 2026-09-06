#!/usr/bin/env bun
/**
 * Emit the definition meta-schema as `dreamcli.schema.json` at the package root.
 *
 * @module
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
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
	// Format before touching the tracked file, which concurrent builds may have mapped.
	const formatting = formatSchema(execPath, [dprintBin, 'fmt', '--stdin', 'schema.json'], {
		cwd: normalize(`${import.meta.dirname}/..`),
	});
	formatting.child.stdin?.end(schemaStr);
	const { stdout: formatted } = await formatting;
	const existing = await readFile(outFile, 'utf-8').catch((error: unknown) => {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
		throw error;
	});
	if (existing !== formatted) {
		const temporaryFile = `${outFile}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporaryFile, formatted, 'utf-8');
			await rename(temporaryFile, outFile);
		} finally {
			await rm(temporaryFile, { force: true });
		}
	}
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
