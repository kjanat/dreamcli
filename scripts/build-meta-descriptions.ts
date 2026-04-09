#!/usr/bin/env bun
/**
 * Rebuild `src/core/json-schema/meta-descriptions.generated.ts`.
 *
 * This is a source code artifact (consumed at runtime by the JSON Schema
 * module), not a docs artifact. It extracts JSDoc descriptions from the
 * normalized TypeDoc model and writes them as a typed constant.
 *
 * @module
 */

import { error, log } from 'node:console';
import { relative } from 'node:path';
import { cwd, exit } from 'node:process';
import { collectPublicApiIndex } from '@kjanat/dreamcli-docs/vitepress/data/api-index.ts';
import {
	buildDefinitionMetaSchemaDescriptions as bdDefMetaSchDesc,
	renderDefinitionMetaSchemaDescriptions as rdrDefMetaSchDesc,
} from '@kjanat/dreamcli-docs/vitepress/data/meta-schema-descriptions.ts';
import {
	generatedMetaSchemaDescriptionsPath as genMetaSchDescPaths,
	packageJsonPath,
} from '@kjanat/dreamcli-docs/vitepress/data/paths.ts';
import { collectTypeDocModel } from '@kjanat/dreamcli-docs/vitepress/data/typedoc.ts';
import { argv, file, spawn, write } from 'bun';

log(new Date().toISOString(), relative(cwd(), import.meta.path), 'generating meta-descriptions');

const publicApi = await collectPublicApiIndex(packageJsonPath);
const typedocModel = await collectTypeDocModel(packageJsonPath, publicApi);
const metaSchemaDescriptions = bdDefMetaSchDesc(typedocModel.normalized);
const rendered = await fmtGenSrc(rdrDefMetaSchDesc(metaSchemaDescriptions));
const checkMode = argv.includes('--check');

const relGenPath = relative(cwd(), genMetaSchDescPaths);

if (checkMode) {
	const existing = await file(genMetaSchDescPaths).text();

	if (existing !== rendered) {
		error(
			new Date().toISOString(),
			`✗ ${relGenPath} is out of date. Run \`bun run meta-descriptions\`.`,
		);
		exit(1);
	}

	log(new Date().toISOString(), `✓ ${relGenPath} is up to date`);
	exit(0);
}

await write(genMetaSchDescPaths, rendered);
log(new Date().toISOString(), `✓ ${relGenPath} updated`);

async function fmtGenSrc(source: string): Promise<string> {
	const proc = spawn(['bunx', '--bun', 'dprint', 'fmt', '--stdin', 'file.ts'], {
		stdin: new Blob([source]),
		stdout: 'pipe',
		stderr: 'inherit',
	});

	const [formatted, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

	if (exitCode !== 0) {
		throw new Error(`dprint exited with code ${exitCode}`);
	}

	return formatted;
}
