/**
 * Data loader for the API reference overview page.
 *
 * Returns public API entrypoint inventory and symbol page routes
 * for rendering the interactive symbol index.
 *
 * @module
 */

import {
  collectPublicApiIndex,
  countPublicApiSymbols,
} from '../.vitepress/data/api-index.ts';
import { collectExamples } from '../.vitepress/data/examples.ts';
import type { PublicApiEntrypoint } from '../.vitepress/data/api-index.ts';
import {
  examplesRoot,
  packageJsonPath,
  rootDirPath,
  symbolPagesRoot,
} from '../.vitepress/data/paths.ts';
import { collectSymbolPages } from '../.vitepress/data/symbol-pages.ts';
import { collectTypeDocModel } from '../.vitepress/data/typedoc.ts';

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
  watch: ['../../src/**/*.ts'],

  async load(): Promise<Data> {
    const [examples, publicApi] = await Promise.all([
      collectExamples(examplesRoot, rootDirPath),
      collectPublicApiIndex(packageJsonPath),
    ]);
    const typeDoc = await collectTypeDocModel(packageJsonPath, publicApi);
    const symbolPages = collectSymbolPages(
      typeDoc.normalized,
      symbolPagesRoot,
      examples,
    );

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
