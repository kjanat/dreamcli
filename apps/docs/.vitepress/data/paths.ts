/**
 * Shared filesystem paths for docs generation.
 *
 * @module
 */
/** biome-ignore-all lint/style/noNonNullAssertion: explanation */
import { $, fileURLToPath } from 'bun';

const rootdir = await $`git rev-parse --show-toplevel`.text().then((s) => s.trim());
const dreamcliRoot = fileURLToPath(import.meta.resolve('@kjanat/dreamcli')).split('/src/')[0]!;
const dreamcliPackageJson = fileURLToPath(import.meta.resolve('@kjanat/dreamcli/package.json'));

export const rootDirPath = rootdir;

export const docsRoot = `${rootdir}/apps/docs`;
export const symbolPagesRoot = `${docsRoot}/reference/symbols`;

export const examplesRoot = `${rootdir}/examples/standalone`;

export const packageRoot = dreamcliRoot;
export const packageJsonPath = dreamcliPackageJson;
export const tsconfigPath = `${dreamcliRoot}/tsconfig.json`;

const metadescPath = 'src/core/json-schema/meta-descriptions.generated.ts';
export const generatedMetaSchemaDescriptionsPath = `${dreamcliRoot}/${metadescPath}`;

/** Git ref for source links. Env override: `DOCS_GIT_REF`. */
export const gitRef = (async (): Promise<string> => {
	const envRef = process.env['DOCS_GIT_REF'];
	const trimmedEnvRef = envRef?.trim();
	if (trimmedEnvRef !== undefined && trimmedEnvRef.length > 0) {
		return trimmedEnvRef;
	}

	try {
		return $`git rev-parse HEAD`.text().then((s) => s.trim());
	} catch {
		return 'HEAD';
	}
})();
