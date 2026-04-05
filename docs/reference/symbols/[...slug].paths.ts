/**
 * Dynamic route loader for symbol reference pages.
 *
 * Watches source files and generates one page per public API symbol
 * with rendered markdown content injected via `<!-- @content -->`.
 *
 * @module
 */

import { collectExamples } from '../../.vitepress/data/examples.ts';
import {
  examplesRoot,
  packageJsonPath,
  rootDirPath,
  symbolPagesRoot,
} from '../../.vitepress/data/paths.ts';
import { collectSymbolPages } from '../../.vitepress/data/symbol-pages.ts';
import { collectPublicApiIndex } from '../../.vitepress/data/api-index.ts';
import { collectTypeDocModel } from '../../.vitepress/data/typedoc.ts';

export default {
  watch: ['../../../src/**/*.ts'],

  async paths() {
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

    return symbolPages.map((page) => ({
      params: { slug: page.routePath.replace('/reference/symbols/', '') },
      content: page.content,
    }));
  },
};
