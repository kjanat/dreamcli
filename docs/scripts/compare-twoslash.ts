/** Run with `bun docs/scripts/compare-twoslash.ts` to compare analyzers on the flags guide. @module */
import assert from 'node:assert/strict';
import { defaultHoverInfoProcessor, transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { createTwoslasher } from 'twoslash';
import type { TwoslashNode } from 'twoslash-protocol';
import ts from 'typescript';
import { createMarkdownRenderer } from 'vitepress';
import config from '../../tsconfig.json' with { type: 'json' };
import { docsRoot, rootDirPath } from '../.vitepress/data/paths.ts';
import { analyzeWithTsrs, loadFlagsGuide } from './tsrs-twoslash.ts';

const { path, guide, snippets } = await loadFlagsGuide(rootDirPath);
assert.ok(snippets.length > 0);

const start = performance.now();
const native = await analyzeWithTsrs(rootDirPath, snippets);
const middle = performance.now();
const { options } = ts.convertCompilerOptionsFromJson(config.compilerOptions, rootDirPath);
const classic = createTwoslasher({ vfsRoot: rootDirPath, compilerOptions: options });
const original = snippets.map((code) => classic(code, 'ts'));
const end = performance.now();

let queries = 0;
let identicalQueries = 0;
let hovers = 0;
let identicalHovers = 0;
for (const [index, code] of snippets.entries()) {
	const expected = original[index];
	const actual = native.get(code);
	assert.ok(expected && actual);
	assert.equal(actual.code, expected.code, `Displayed code in block ${index + 1}`);
	assert.deepEqual(
		actual.nodes.map(({ type, start, length }) => [type, start, length]),
		expected.nodes.map(({ type, start, length }) => [type, start, length]),
		`Annotations in block ${index + 1}`,
	);
	for (const [i, reference] of expected.nodes.entries()) {
		const node: TwoslashNode | undefined = actual.nodes[i];
		assert.ok(reference.type === 'query' || reference.type === 'hover');
		assert.ok(node?.type === reference.type);
		assert.equal(node.target, reference.target);
		const nativeText = defaultHoverInfoProcessor(node.text);
		const classicText = defaultHoverInfoProcessor(reference.text);
		if (node.type === 'query') {
			queries++;
			if (nativeText === classicText) identicalQueries++;
			else console.log(`Query display differs: ${classicText} → ${nativeText}`);
		} else {
			hovers++;
			if (nativeText === classicText) identicalHovers++;
		}
	}
}

// Shiki's hook is synchronous. Supply the results of the asynchronous LSP queries at render time.
const used = new Set<string>();
const md = await createMarkdownRenderer(docsRoot, {
	codeTransformers: [
		transformerTwoslash({
			twoslasher(code: string) {
				const key = code.trimEnd();
				const value = native.get(key);
				assert.ok(value, 'No native analysis for this fence');
				used.add(key);
				return value;
			},
		}),
	],
});
const html = await md.renderAsync(guide, { path });
assert.equal(used.size, native.size);
assert.ok(html.includes('twoslash-popup-code'));
assert.ok(!html.includes('file://'));

await assert.rejects(analyzeWithTsrs(rootDirPath, ['const count: number = "invalid";']), /TS2322/);
console.log(
	`${snippets.length} fences rendered; all ${queries} query and ${hovers} hover ranges match`,
);
console.log(
	`Identical rendered signature text: ${identicalQueries}/${queries} queries, ${identicalHovers}/${hovers} hovers`,
);
console.log(
	`Analysis: tsrs ${Math.round(middle - start)} ms, TypeScript ${ts.version} ${Math.round(end - middle)} ms`,
);
