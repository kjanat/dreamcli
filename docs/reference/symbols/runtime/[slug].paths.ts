/**
 * Dynamic route loader for `@kjanat/dreamcli/runtime` symbol pages.
 *
 * @module
 */

import {
	loadSymbolPages,
	symbolPathsForEntrypoint,
} from '../../../.vitepress/data/symbol-loader.ts';

export default {
	watch: ['../../../../src/**/*.ts', '../../../../examples/**/*.ts'],

	async paths() {
		return symbolPathsForEntrypoint(await loadSymbolPages(), 'runtime');
	},
};
