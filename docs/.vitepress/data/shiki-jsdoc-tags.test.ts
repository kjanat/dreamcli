/** @module */
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import { expect, it } from 'vitest';
import { transformerJSDocTags } from '../vite-plugins/shiki-jsdoc-tags.ts';
import { rootDirPath } from './paths.ts';

it('renders a highlighted JSDoc example as a block and keeps inline code in prose', async () => {
	const md = await createMarkdownRenderer(rootDirPath, {
		languages: ['ts'],
		codeTransformers: [transformerTwoslash(), transformerJSDocTags({ symbolRoutes: new Map() })],
	});
	try {
		const html = await md.renderAsync(
			[
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
			].join('\n'),
		);
		expect(html).toContain('Call <code>deploy</code> to publish.');
		expect(html).toMatch(
			/class="twoslash-popup-docs-tag-value"><pre\b[^>]*class="shiki[^"]*"[^>]*><code>/,
		);
	} finally {
		disposeMdItInstance();
	}
});
