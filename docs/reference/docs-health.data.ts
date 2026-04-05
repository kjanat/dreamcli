/**
 * Data loader for the docs health page.
 *
 * Computes source-backed documentation metrics: authored page count,
 * generated artifact count, example count, public API surface, and
 * symbol page coverage.
 *
 * @module
 */

import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import {
  collectPublicApiIndex,
  countPublicApiSymbols,
} from '../.vitepress/data/api-index.ts';
import { collectExamples } from '../.vitepress/data/examples.ts';
import {
  docsRoot,
  examplesRoot,
  packageJsonPath,
  rootDirPath,
  symbolPagesRoot,
} from '../.vitepress/data/paths.ts';
import { collectSymbolPages } from '../.vitepress/data/symbol-pages.ts';
import { collectTypeDocModel } from '../.vitepress/data/typedoc.ts';

export interface Data {
  authoredPageCount: number;
  generatedArtifactCount: number;
  exampleCount: number;
  publicEntrypointCount: number;
  publicSymbolCount: number;
  symbolPageCount: number;
}

declare const data: Data;
export { data };

export default {
  watch: [
    '../../src/**/*.ts',
    '../../examples/**/*.ts',
    '../guide/**/*.md',
    '../concepts/**/*.md',
  ],

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

    const authoredPageCount = await countMarkdownFiles(
      docsRoot,
      (relativePath) =>
        !relativePath.startsWith('.generated/') &&
        !relativePath.startsWith('.vitepress/') &&
        relativePath !== 'reference/changelog.md' &&
        relativePath !== 'reference/docs-health.md',
    );

    return {
      authoredPageCount,
      generatedArtifactCount: 10 + symbolPages.length + examples.length,
      exampleCount: examples.length,
      publicEntrypointCount: publicApi.length,
      publicSymbolCount: countPublicApiSymbols(publicApi),
      symbolPageCount: symbolPages.length,
    };
  },
};

async function countMarkdownFiles(
  dirPath: string,
  include: (relativePath: string) => boolean,
): Promise<number> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const docsRelativePath = relative(docsRoot, fullPath).replaceAll('\\', '/');

    if (entry.isDirectory()) {
      count += await countMarkdownFiles(fullPath, include);
      continue;
    }

    if (
      extname(entry.name) === '.md' &&
      include(docsRelativePath) &&
      !docsRelativePath.startsWith('reference/symbols/')
    ) {
      count += 1;
    }
  }

  return count;
}
