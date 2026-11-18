/** Per-test-file deno doc fixture; each test-file evaluation starts a fresh collection.
 * @module
 */
import { collectPublicApiIndex } from './api-index.ts';
import { packageJsonPath } from './paths.ts';
import { collectDenoDocModel } from './deno-doc.ts';

/** Share expensive collection across assertions without caching production docs data. */
export function createDenoDocFixture(): () => ReturnType<typeof collectDenoDocModel> {
	let model: ReturnType<typeof collectDenoDocModel> | undefined;
	return () =>
		(model ??= collectPublicApiIndex(packageJsonPath).then((publicApi) =>
			collectDenoDocModel(packageJsonPath, publicApi),
		));
}
