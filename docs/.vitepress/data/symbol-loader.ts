/**
 * Shared symbol page loader with cached TypeDoc model.
 *
 * Avoids running TypeDoc multiple times when per-entrypoint
 * route loaders each call this module.
 *
 * @module
 */

import { collectPublicApiIndex } from './api-index.ts';
import { collectExamples } from './examples.ts';
import { examplesRoot, packageJsonPath, rootDirPath, symbolPagesRoot } from './paths.ts';
import { collectSymbolPages, type GeneratedSymbolPage } from './symbol-pages.ts';
import { collectTypeDocModel } from './typedoc.ts';

let cached: readonly GeneratedSymbolPage[] | undefined;

export async function loadSymbolPages(): Promise<readonly GeneratedSymbolPage[]> {
	if (cached !== undefined) {
		return cached;
	}
	const [examples, publicApi] = await Promise.all([
		collectExamples(examplesRoot, rootDirPath),
		collectPublicApiIndex(packageJsonPath),
	]);
	const typeDoc = await collectTypeDocModel(packageJsonPath, publicApi);
	cached = collectSymbolPages(typeDoc.normalized, symbolPagesRoot, examples);
	return cached;
}

export function symbolPathsForEntrypoint(
	pages: readonly GeneratedSymbolPage[],
	section: string,
): { params: { slug: string }; content: string }[] {
	const prefix = `/reference/symbols/${section}/`;
	return pages
		.filter((page) => page.routePath.startsWith(prefix))
		.map((page) => ({
			params: { slug: page.routePath.slice(prefix.length) },
			content: page.content,
		}));
}
