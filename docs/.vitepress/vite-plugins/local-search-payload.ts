/** Compress the serialized MiniSearch index that VitePress imports when search opens. @module */
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vitepress';

export function localSearchPayload(): Plugin {
	return {
		name: 'dreamcli-local-search-payload',
		apply: 'build',
		transform: {
			filter: { id: /^\/@localSearchIndex[^/?]+$/ },
			handler(code) {
				const statement = this.parse(code).body[0];
				if (
					statement?.type !== 'ExportDefaultDeclaration' ||
					statement.declaration.type !== 'Literal' ||
					typeof statement.declaration.value !== 'string'
				) {
					this.error('Expected VitePress to export a serialized local search index');
				}
				const ref = this.emitFile({
					type: 'asset',
					name: 'local-search.bin',
					source: gzipSync(statement.declaration.value),
				});
				return `const response = await fetch(import.meta.ROLLUP_FILE_URL_${ref});
if (!response.ok) throw new Error('Unable to load the local search index: ' + response.status);
export default await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();`;
			},
		},
	};
}
