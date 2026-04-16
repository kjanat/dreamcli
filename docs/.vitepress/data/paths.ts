/**
 * Shared filesystem paths for docs generation.
 *
 * @module
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const currentDir = import.meta.dirname;

if (currentDir === undefined) {
	throw new Error('docs path helpers require import.meta.dirname');
}

const rootDir = resolve(currentDir, '../../..');

export const rootDirPath = rootDir;
export const docsRoot = `${rootDir}/docs`;
export const examplesRoot = `${rootDir}/examples`;
export const packageJsonPath = `${rootDir}/package.json`;
export const tsconfigPath = `${rootDir}/tsconfig.json`;
export const symbolPagesRoot = `${docsRoot}/reference/symbols`;
export const generatedMetaSchemaDescriptionsPath = `${rootDir}/src/core/json-schema/meta-descriptions.generated.ts`;

/** Git ref for source links. Env override: `DOCS_GIT_REF`. */
export const gitRef: string = (() => {
	const envRef = process.env['DOCS_GIT_REF'];
	const trimmedEnvRef = envRef?.trim();
	if (trimmedEnvRef !== undefined && trimmedEnvRef.length > 0) {
		return trimmedEnvRef;
	}

	try {
		return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return 'HEAD';
	}
})();
