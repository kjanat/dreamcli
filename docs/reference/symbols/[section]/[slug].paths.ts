/**
 * Dynamic routes for the symbol pages of all public entrypoints.
 *
 * @module
 */

import { loadReferenceModel } from '../../../.vitepress/data/reference-model.ts';

export default {
	watch: ['../../../../src/**/*.ts', '../../../../examples/**/*.ts'],

	async paths() {
		const { symbolPages } = await loadReferenceModel();
		return symbolPages.map(({ routePath, content }) => {
			const [section, slug] = routePath.slice('/reference/symbols/'.length).split('/');
			return { params: { section, slug }, content };
		});
	},
};
