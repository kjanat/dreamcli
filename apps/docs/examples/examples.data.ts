/**
 * Data loader for the examples index page.
 *
 * Returns lightweight metadata (no source code) for rendering
 * the example listing. Watches example source files for HMR.
 *
 * @module
 */

import {
	collectExamples,
	type ExampleEntry,
} from '@kjanat/dreamcli-docs/vitepress/data/examples.ts';
import { examplesRoot, rootDirPath } from '@kjanat/dreamcli-docs/vitepress/data/paths.ts';

export type ExampleIndexEntry = Pick<
	ExampleEntry,
	'slug' | 'title' | 'summary' | 'demonstrates' | 'sourcePath' | 'routePath' | 'sourceUrl'
>;

export type Data = readonly ExampleIndexEntry[];

declare const data: Data;

export { data };

export default {
	watch: ['../../examples/**/*.ts'],

	async load(): Promise<Data> {
		const examples = await collectExamples(examplesRoot, rootDirPath);
		return examples.map(
			({ slug, title, summary, demonstrates, sourcePath, routePath, sourceUrl }) => ({
				slug,
				title,
				summary,
				demonstrates,
				sourcePath,
				routePath,
				sourceUrl,
			}),
		);
	},
};
