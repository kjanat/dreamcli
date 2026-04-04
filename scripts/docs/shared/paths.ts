/**
 * Shared filesystem paths for docs generation.
 *
 * @module
 */

import { normalize } from 'node:path/posix';

// Intentionally use POSIX-style paths because these are converted to URL paths
// and generated in POSIX CI environments.
const rootDir = normalize(`${import.meta.dirname}/../../..`);

export const rootDirPath = rootDir;
export const docsRoot = `${rootDir}/docs`;
export const generatedRoot = `${docsRoot}/.generated`;

export const generatedExamplesDir = `${generatedRoot}/examples`;
export const generatedReferenceDir = `${generatedRoot}/reference`;
export const generatedApiDir = `${generatedRoot}/api`;

export const examplesRoot = `${rootDir}/examples`;
export const exampleDocsRoot = `${docsRoot}/examples`;
export const changelogPath = `${rootDir}/CHANGELOG.md`;
export const packageJsonPath = `${rootDir}/package.json`;
export const tsconfigPath = `${rootDir}/tsconfig.json`;

export const generatedSiteDataPath = `${generatedRoot}/site-data.ts`;

export const generatedExamplesIndexPath = `${generatedExamplesDir}/index.md`;

export const generatedChangelogPath = `${generatedReferenceDir}/changelog.md`;
export const generatedDocsHealthPath = `${generatedReferenceDir}/docs-health.md`;

export const referenceChangelogPagePath = `${docsRoot}/reference/changelog.md`;
export const referenceDocsHealthPagePath = `${docsRoot}/reference/docs-health.md`;

export const generatedApiIndexPath = `${generatedApiDir}/public-exports.json`;
export const generatedApiPagePath = `${generatedApiDir}/index.md`;
export const generatedTypeDocJsonPath = `${generatedApiDir}/typedoc.json`;
export const generatedNormalizedTypeDocPath = `${generatedApiDir}/typedoc-normalized.json`;

export const generatedMetaSchemaDescriptionsPath = `${rootDir}/src/core/json-schema/meta-descriptions.generated.ts`;

export const symbolPagesRoot = `${docsRoot}/reference/symbols`;
