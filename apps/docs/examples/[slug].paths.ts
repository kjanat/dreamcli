/**
 * Dynamic route loader for individual example pages.
 *
 * Watches example source files and generates one page per example
 * with rendered markdown content injected via `<!-- @content -->`.
 *
 * @module
 */

import {
	collectExamples,
	renderExamplePage,
} from '@kjanat/dreamcli-docs/vitepress/data/examples.ts';
import { examplesRoot, rootDirPath } from '@kjanat/dreamcli-docs/vitepress/data/paths.ts';

export default {
	watch: ['../../examples/**/*.ts'],

	async paths() {
		const examples = await collectExamples(examplesRoot, rootDirPath);
		return examples.map((example) => ({
			params: { slug: example.slug },
			content: renderExamplePage(example),
		}));
	},
};
