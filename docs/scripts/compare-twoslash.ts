/** Compare the rendered examples in two complete VitePress builds. @module */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [stock, candidate] = process.argv.slice(2);
if (!stock || !candidate) {
	throw new Error('Usage: bun docs/scripts/compare-twoslash.ts <stock-dist> <candidate-dist>');
}

async function files(root: string, pattern: string) {
	return (await Array.fromAsync(new Bun.Glob(pattern).scan(root))).sort();
}

async function sections(root: string, page: string) {
	const html = await readFile(join(root, page), 'utf8');
	return html.match(/<pre\b[^>]*\bclass="[^"]*\btwoslash\b[^"]*"[^>]*>[\s\S]*?<\/pre>/g) ?? [];
}

const pages = await files(stock, '**/*.html');
assert.deepEqual(await files(candidate, '**/*.html'), pages, 'Generated HTML paths');
let fences = 0;
for (const page of pages) {
	const expected = await sections(stock, page);
	assert.deepEqual(await sections(candidate, page), expected, `Rendered examples in ${page}`);
	fences += expected.length;
}

// The server renders the code and annotation targets. Hydration loads popup bodies by hash.
async function popups(root: string) {
	const counts = new Map<string, number>();
	const assets = new Set<string>();
	for (const path of await files(root, 'assets/*.md.*.lean.js')) {
		const js = await readFile(join(root, path), 'utf8');
		const refs = Array.from(js.matchAll(/\/assets\/twoslash\/[\da-f]{24}\.txt/g), ([url]) => url);
		counts.set(path.slice(0, path.lastIndexOf('.md.') + 3), refs.length);
		for (const url of refs) assets.add(url);
	}
	for (const url of assets) {
		const body = await readFile(join(root, url), 'utf8');
		assert.match(body, /twoslash-popup/, url);
		assert.doesNotMatch(body, /href="file:\/\//, url);
	}
	return counts;
}

const expectedPopups = await popups(stock);
assert.deepEqual(await popups(candidate), expectedPopups, 'Popup references per page');
const references = [...expectedPopups.values()].reduce((sum, count) => sum + count, 0);
assert.ok(fences && references, 'Expected Twoslash examples and popup references');
console.log(
	`${pages.length} HTML paths, ${fences} identical rendered examples, ${references} verified popup references.`,
);
