/**
 * Dynamic route loader for `@kjanat/dreamcli` symbol pages.
 *
 * @module
 */

import {
	loadSymbolPages,
	symbolPathsForEntrypoint,
} from '../../../.vitepress/data/symbol-loader.ts';

export default {
	watch: [
		'../../../../../packages/dreamcli/src/**/*.ts',
		'../../../../../examples/standalone/**/*.ts',
	],

	async paths() {
		return symbolPathsForEntrypoint(await loadSymbolPages(), 'main');
	},
};
