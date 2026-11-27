/** @module */
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress';
import { expect, it } from 'vitest';
import { twoslashPayloads } from '../vite-plugins/twoslash-payloads.ts';
import { rootDirPath } from './paths.ts';

it('renders repeated Twoslash fences with the latest include definition', async () => {
	const popups = twoslashPayloads();
	popups.plugin.configResolved();
	const md = await createMarkdownRenderer(rootDirPath, {
		languages: ['ts'],
		shikiSetup: popups.shikiSetup,
		codeTransformers: [popups.twoslash({})],
	});
	const consumer = ['~~~ts twoslash', '// @include: shared', '// ---cut---', 'shared', '~~~'].join(
		'\n',
	);
	try {
		for (const type of ['number', 'string', 'number']) {
			await md.renderAsync(`~~~ts twoslash include shared\ndeclare const shared: ${type}\n~~~`);
			const html = await md.renderAsync(consumer);
			expect(html.replace(/<[^>]+>/g, '')).toContain(`const shared: ${type}`);
		}
	} finally {
		disposeMdItInstance();
	}
});
