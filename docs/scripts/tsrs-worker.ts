/** Bridge Shiki's synchronous transformer to a build-scoped tsrs session. @module */
import { runAsWorker } from 'synckit';
import { openTsrs } from './tsrs-twoslash.ts';

let session: Awaited<ReturnType<typeof openTsrs>> | undefined;

export async function checkSnippet(root: string, code: string | null) {
	if (code === null) {
		const previous = session;
		session = undefined;
		await previous?.close();
		return null;
	}
	session ??= await openTsrs(root);
	return session.analyze(code);
}

runAsWorker(checkSnippet);
