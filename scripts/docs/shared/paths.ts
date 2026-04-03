/**
 * Shared filesystem paths for docs generation.
 *
 * @module
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptsDir = dirname(scriptDir);
const docsScriptsDir = dirname(scriptsDir);
const rootDir = dirname(docsScriptsDir);

export const docsRoot = join(rootDir, 'docs');
export const generatedRoot = join(docsRoot, '.generated');
export const generatedExamplesDir = join(generatedRoot, 'examples');
export const generatedReferenceDir = join(generatedRoot, 'reference');
export const generatedApiDir = join(generatedRoot, 'api');
export const examplesRoot = join(rootDir, 'examples');
export const changelogPath = join(rootDir, 'CHANGELOG.md');
export const packageJsonPath = join(rootDir, 'package.json');
export const tsconfigPath = join(rootDir, 'tsconfig.json');
export const generatedSiteDataPath = join(generatedRoot, 'site-data.ts');
export const generatedExamplesIndexPath = join(generatedExamplesDir, 'index.md');
export const generatedChangelogPath = join(generatedReferenceDir, 'changelog.md');
export const generatedDocsHealthPath = join(generatedReferenceDir, 'docs-health.md');
export const generatedApiIndexPath = join(generatedApiDir, 'public-exports.json');
export const generatedApiPagePath = join(generatedApiDir, 'index.md');
export const generatedTypeDocJsonPath = join(generatedApiDir, 'typedoc.json');
export const generatedNormalizedTypeDocPath = join(generatedApiDir, 'typedoc-normalized.json');
export const symbolPagesRoot = join(docsRoot, 'reference', 'symbols');
