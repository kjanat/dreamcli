/**
 * Shared cached docs model for reference loaders.
 *
 * @module
 */

import type { PublicApiEntrypoint } from './api-index.ts';
import { collectPublicApiIndex } from './api-index.ts';
import { collectDenoDocModel } from './deno-doc.ts';
import type { ExampleEntry } from './examples.ts';
import { collectExamples } from './examples.ts';
import { examplesRoot, packageJsonPath, rootDirPath, symbolPagesRoot } from './paths.ts';
import type { GeneratedSymbolPage } from './symbol-pages.ts';
import { collectSymbolPages } from './symbol-pages.ts';

export interface ReferenceModel {
	examples: readonly ExampleEntry[];
	publicApi: readonly PublicApiEntrypoint[];
	symbolPages: readonly GeneratedSymbolPage[];
}

let cachedModel: Promise<ReferenceModel> | undefined;

export async function loadReferenceModel(): Promise<ReferenceModel> {
	if (!shouldCacheReferenceModel()) {
		return buildReferenceModel();
	}

	if (cachedModel === undefined) {
		cachedModel = buildReferenceModel();
	}

	return cachedModel;
}

export function clearReferenceModelCache(): void {
	cachedModel = undefined;
}

async function buildReferenceModel(): Promise<ReferenceModel> {
	const [examples, publicApi] = await Promise.all([
		collectExamples(examplesRoot, rootDirPath),
		collectPublicApiIndex(packageJsonPath),
	]);
	const api = await collectDenoDocModel(packageJsonPath, publicApi);
	const symbolPages = collectSymbolPages(api, symbolPagesRoot, examples);

	return {
		examples,
		publicApi,
		symbolPages,
	};
}

function shouldCacheReferenceModel(): boolean {
	return process.env['NODE_ENV'] === 'production';
}
