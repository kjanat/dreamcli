/**
 * Shared symbol page loader backed by the reference model cache.
 *
 * @module
 */

import { loadReferenceModel } from './reference-model.ts';
import type { GeneratedSymbolPage } from './symbol-pages.ts';

export async function loadSymbolPages(): Promise<readonly GeneratedSymbolPage[]> {
	const { symbolPages } = await loadReferenceModel();
	return symbolPages;
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
