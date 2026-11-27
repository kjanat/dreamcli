/** @module */
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import { expect, it } from 'vitest';
import { transformerJSDocTags } from '../vite-plugins/shiki-jsdoc-tags.ts';
import { twoslashPayloads } from '../vite-plugins/twoslash-payloads.ts';
import { rootDirPath } from './paths.ts';

it('renders a highlighted JSDoc example as a block and keeps inline code in prose', async () => {
	const popups = twoslashPayloads();
	const md = await createMarkdownRenderer(rootDirPath, {
		languages: ['ts'],
		codeTransformers: [popups.twoslash({}), transformerJSDocTags({ symbolRoutes: new Map() })],
	});
	try {
		const example = [
			'~~~~ts twoslash',
			'/** Call `deploy` to publish.',
			' * @example',
			' * ```ts',
			' * deploy();',
			' * deploy();',
			' * ```',
			' */',
			'function deploy() {}',
			'deploy();',
			'~~~~',
		].join('\n');
		const html = await md.renderAsync(example);
		expect(html).toContain('Call <code>deploy</code> to publish.');
		expect(html).toMatch(
			/class="twoslash-popup-docs-tag-value"><pre\b[^>]*class="shiki[^"]*"[^>]*><code>/,
		);
		popups.plugin.configResolved();
		expect(await md.renderAsync(example)).toBe(html);
		expect(await md.renderAsync(example)).toBe(html);
	} finally {
		disposeMdItInstance();
	}
});
