/**
 * Compare two VitePress dist directories with `bun docs/scripts/compare-twoslash.ts <before> <after>`.
 * An inline baseline uses Chromium (`bun x playwright install chromium` or
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). Two extracted builds use byte-for-byte checks.
 * @module
 */
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

const inline = !(await files(stock, 'assets/twoslash/*.txt')).length;
const pages = await files(stock, '**/*.html');
assert.deepEqual(await files(candidate, '**/*.html'), pages, 'Generated HTML paths');
if (inline) {
	const { compareInlineHovers } = await import('./inline-hovers.ts');
	await compareInlineHovers(stock, candidate, pages);
	process.exit(0);
}
let fences = 0;
for (const page of pages) {
	const expected = await sections(stock, page);
	assert.deepEqual(await sections(candidate, page), expected, `Rendered examples in ${page}`);
	fences += expected.length;
}

// The server renders the code and annotation targets. Hydration loads popup bodies by hash.
async function popups(root: string) {
	const byPage = new Map<string, string[]>();
	const bodies = new Map<string, string>();
	for (const path of await files(root, 'assets/*.md.*.lean.js')) {
		const js = await readFile(join(root, path), 'utf8');
		const refs = Array.from(js.matchAll(/\/assets\/twoslash\/[\da-f]{24}\.txt/g), ([url]) => url);
		byPage.set(path.slice(0, path.lastIndexOf('.md.') + 3), refs);
		for (const url of refs) {
			if (bodies.has(url)) continue;
			const body = await readFile(join(root, url), 'utf8');
			assert.match(body, /twoslash-popup/, url);
			assert.doesNotMatch(body, /href="file:\/\//, url);
			bodies.set(url, body);
		}
	}
	return { byPage, bodies };
}

const expected = await popups(stock);
const actual = await popups(candidate);
assert.deepEqual(
	[...actual.byPage.keys()].sort(),
	[...expected.byPage.keys()].sort(),
	'Popup pages',
);
let references = 0;
let differences = 0;
let firstDifference: string | undefined;
for (const [page, refs] of expected.byPage) {
	const other = actual.byPage.get(page);
	assert.ok(other);
	assert.equal(other.length, refs.length, `Popup count in ${page}`);
	for (const [index, url] of other.entries()) {
		const stockUrl = refs[index];
		assert.ok(stockUrl);
		if (actual.bodies.get(url) !== expected.bodies.get(stockUrl)) {
			differences++;
			firstDifference ??= `${page}, popup ${index + 1} (stock ${stockUrl}, candidate ${url})`;
		}
	}
	references += refs.length;
}
assert.ok(fences && references, 'Expected Twoslash examples and popup references');
assert.ok(
	!differences,
	`${differences} of ${references} popup bodies differ. First: ${firstDifference}`,
);
console.log(
	`${pages.length} HTML paths, ${fences} identical rendered examples, ${references} identical popup bodies.`,
);
