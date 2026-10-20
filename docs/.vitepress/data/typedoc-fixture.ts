/** Per-test-file TypeDoc fixture; each test-file evaluation starts a fresh collection.
 * @module
 */
import { collectPublicApiIndex } from './api-index.ts';
import { packageJsonPath } from './paths.ts';
import { collectTypeDocModel } from './typedoc.ts';

/** Share expensive collection across assertions without caching production docs data. */
export function createTypeDocFixture(): () => ReturnType<typeof collectTypeDocModel> {
	let model: ReturnType<typeof collectTypeDocModel> | undefined;
	return () =>
		(model ??= collectPublicApiIndex(packageJsonPath).then((publicApi) =>
			collectTypeDocModel(packageJsonPath, publicApi),
		));
}
