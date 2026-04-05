/**
 * Data loader for the generated surfaces overview page.
 *
 * Returns reference surface metadata and docs health snapshot.
 *
 * @module
 */

import {
  collectPublicApiIndex,
  countPublicApiSymbols,
} from '../.vitepress/data/api-index.ts';
import { collectExamples } from '../.vitepress/data/examples.ts';
import {
  examplesRoot,
  packageJsonPath,
  rootDirPath,
  symbolPagesRoot,
} from '../.vitepress/data/paths.ts';
import {
  buildReferenceSurfaces,
  type GeneratedReferenceSurface,
} from '../.vitepress/data/reference-surfaces.ts';
import { collectSymbolPages } from '../.vitepress/data/symbol-pages.ts';
import { collectTypeDocModel } from '../.vitepress/data/typedoc.ts';

export interface Data {
  publicApiCount: number;
  publicSymbolCount: number;
  symbolPageCount: number;
  referenceSurfaces: readonly GeneratedReferenceSurface[];
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
      publicApiCount: publicApi.length,
      publicSymbolCount: countPublicApiSymbols(publicApi),
      symbolPageCount: symbolPages.length,
      referenceSurfaces: buildReferenceSurfaces(symbolPages.length),
    };
  },
};
