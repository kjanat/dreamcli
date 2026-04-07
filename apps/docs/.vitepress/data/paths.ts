/**
 * Shared filesystem paths for docs generation.
 *
 * @module
 */

import { execSync } from 'node:child_process';
import { normalize } from 'node:path/posix';

const rootDir = normalize(`${import.meta.dirname}/../../../..`);

export const rootDirPath = rootDir;
export const docsRoot = `${rootDir}/apps/docs`;
export const examplesRoot = `${rootDir}/examples/standalone`;
export const packageRoot = `${rootDir}/packages/dreamcli`;
export const packageJsonPath = `${packageRoot}/package.json`;
export const tsconfigPath = `${packageRoot}/tsconfig.json`;
export const symbolPagesRoot = `${docsRoot}/reference/symbols`;
export const generatedMetaSchemaDescriptionsPath = `${packageRoot}/src/core/json-schema/meta-descriptions.generated.ts`;

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
