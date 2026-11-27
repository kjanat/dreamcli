/** @module */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Root } from 'hast';
import { expect, it } from 'vitest';
import { highlightCache } from '../vite-plugins/highlight-cache.ts';

it('restores saved highlights for the same dependencies and replaces obsolete entries', () => {
	const root = mkdtempSync(join(tmpdir(), 'dreamcli-highlights-'));
	try {
		const lock = join(root, 'bun.lock');
		const directory = join(root, 'cache');
		writeFileSync(lock, 'first dependency set');
		const tree: Root = { type: 'root', children: [{ type: 'text', value: 'string' }] };
		const entries = new Map([['signature', tree]]);
		const cache = highlightCache(directory, lock);
		expect(cache.restore().size).toBe(0);
		cache.save(entries);
		expect(highlightCache(directory, lock).restore()).toEqual(entries);
		writeFileSync(lock, 'updated dependency set');
		const updated = highlightCache(directory, lock);
		expect(updated.restore().size).toBe(0);
		updated.save(new Map([['another signature', tree]]));
		updated.save(entries);
		expect(updated.restore()).toEqual(entries);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
