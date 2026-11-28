/** Load the MiniSearch index when the search dialog opens. @module */
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vitepress';

export function localSearchPayload(): Plugin {
	return {
		name: 'dreamcli-local-search-payload',
		apply: 'build',
		transform: {
			filter: { id: /^\/@localSearchIndex[^/?]*$/ },
			handler(code, id) {
				const statement = this.parse(code).body[0];
				if (statement?.type !== 'ExportDefaultDeclaration')
					this.error('Expected a local search export');
				const value = statement.declaration;
				if (id === '/@localSearchIndex') {
					if (value.type !== 'ObjectExpression') this.error('Expected VitePress locale loaders');
					// Keep VitePress's import graph. Its search box calls the locale loader
					// anew each time it opens, including after a rejected network request.
					return `const locales = ${code.slice(value.start, value.end)};
export default Object.fromEntries(Object.entries(locales).map(([locale, module]) =>
	[locale, async () => ({ default: await (await module()).default() })]));`;
				}
				if (value.type !== 'Literal' || typeof value.value !== 'string') {
					this.error('Expected VitePress to export a serialized local search index');
				}
				const compressed = this.emitFile({
					type: 'asset',
					name: 'local-search.bin',
					source: gzipSync(value.value),
				});
				const fallback = this.emitFile({
					type: 'asset',
					name: 'local-search.json',
					source: value.value,
				});
				return `let pending;
async function fetchIndex(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error('Unable to load the local search index: ' + response.status);
	return response;
}
async function readIndex() {
	try {
		const response = await fetchIndex(import.meta.ROLLUP_FILE_URL_${compressed});
		return await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();
	} catch {
		return (await fetchIndex(import.meta.ROLLUP_FILE_URL_${fallback})).text();
	}
}
export default function load() {
	return pending ??= readIndex().catch(error => {
		pending = undefined;
		throw error;
	});
}`;
			},
		},
	};
}
