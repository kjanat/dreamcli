/** Persist Shiki popup highlights between Cloudflare Workers builds. @module */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Root } from 'hast';

export function highlightCache(directory: string, ...inputs: string[]) {
	const hash = createHash('sha256');
	for (const input of inputs)
		hash.update(createHash('sha256').update(readFileSync(input)).digest());
	const fingerprint = hash.digest('hex');
	const path = join(directory, 'highlights-v1.json.gz');
	return {
		restore(): Map<string, Root> {
			try {
				const saved = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
				if (saved.fingerprint === fingerprint && Array.isArray(saved.entries)) {
					return new Map(
						saved.entries.filter(
							([key, tree]: [string, Root]) =>
								typeof key === 'string' && tree?.type === 'root' && Array.isArray(tree.children),
						),
					);
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					console.warn(
						'Could not restore the popup highlight cache. Rebuilding highlights.',
						error,
					);
				}
			}
			return new Map();
		},
		save(entries: Map<string, Root>) {
			const temp = `${path}.${randomUUID()}.tmp`;
			try {
				mkdirSync(directory, { recursive: true });
				const json = JSON.stringify({ fingerprint, entries: [...entries] });
				try {
					writeFileSync(temp, gzipSync(json, { level: 1 }));
					renameSync(temp, path);
				} finally {
					rmSync(temp, { force: true });
				}
			} catch (error) {
				console.warn('Could not save the popup highlight cache.', error);
			}
		},
	};
}
