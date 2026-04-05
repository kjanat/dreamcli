/**
 * Shared filesystem paths for docs generation.
 *
 * @module
 */

import { execSync } from 'node:child_process';
import { normalize } from 'node:path/posix';

const rootDir = normalize(`${import.meta.dirname}/../../..`);

export const rootDirPath = rootDir;
export const docsRoot = `${rootDir}/docs`;
export const examplesRoot = `${rootDir}/examples`;
export const packageJsonPath = `${rootDir}/package.json`;
export const tsconfigPath = `${rootDir}/tsconfig.json`;
export const symbolPagesRoot = `${docsRoot}/reference/symbols`;
export const generatedMetaSchemaDescriptionsPath = `${rootDir}/src/core/json-schema/meta-descriptions.generated.ts`;

/** Git ref for source links. Env override: `DOCS_GIT_REF`. */
export const gitRef: string =
  process.env['DOCS_GIT_REF'] ??
  execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
