/**
 * Data loader for the API reference overview page.
 *
 * Returns public API entrypoint inventory and symbol page routes
 * for rendering the interactive symbol index.
 *
 * @module
 */

import type { PublicApiEntrypoint } from '../.vitepress/data/api-index.ts';
import { countPublicApiSymbols } from '../.vitepress/data/api-index.ts';
import { loadReferenceModel } from '../.vitepress/data/reference-model.ts';

export interface SymbolPageEntry {
	id: string;
	name: string;
	entrypoint: string;
	routePath: string;
}

export interface Data {
	publicApi: readonly PublicApiEntrypoint[];
	symbolPages: readonly SymbolPageEntry[];
	publicEntrypointCount: number;
	publicSymbolCount: number;
	symbolPageCount: number;
}

declare const data: Data;

export { data };

export default {
	watch: ['../../src/**/*.ts', '../../examples/**/*.ts'],

	async load(): Promise<Data> {
		const { publicApi, symbolPages } = await loadReferenceModel();

		return {
			publicApi,
			symbolPages: symbolPages.map((page) => ({
				id: page.id,
				name: page.name,
				entrypoint: page.entrypoint,
				routePath: page.routePath,
			})),
			publicEntrypointCount: publicApi.length,
			publicSymbolCount: countPublicApiSymbols(publicApi),
			symbolPageCount: symbolPages.length,
		};
	},
};
