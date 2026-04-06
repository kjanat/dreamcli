/**
 * Shared cached docs model for reference loaders.
 *
 * @module
 */

import type { PublicApiEntrypoint } from './api-index.ts';
import { collectPublicApiIndex } from './api-index.ts';
import type { ExampleEntry } from './examples.ts';
import { collectExamples } from './examples.ts';
import { examplesRoot, packageJsonPath, rootDirPath, symbolPagesRoot } from './paths.ts';
import type { GeneratedSymbolPage } from './symbol-pages.ts';
import { collectSymbolPages } from './symbol-pages.ts';
import { collectTypeDocModel } from './typedoc.ts';

type TypeDocModel = Awaited<ReturnType<typeof collectTypeDocModel>>;

export interface ReferenceModel {
	examples: readonly ExampleEntry[];
	publicApi: readonly PublicApiEntrypoint[];
	typeDoc: TypeDocModel;
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
	const typeDoc = await collectTypeDocModel(packageJsonPath, publicApi);
	const symbolPages = collectSymbolPages(typeDoc.normalized, symbolPagesRoot, examples);

	return {
		examples,
		publicApi,
		typeDoc,
		symbolPages,
	};
}

function shouldCacheReferenceModel(): boolean {
	return process.env['NODE_ENV'] === 'production';
}
