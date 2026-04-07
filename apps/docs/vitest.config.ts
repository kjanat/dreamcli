import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const packageSrc = resolve(import.meta.dirname, '../../packages/dreamcli/src');

export default defineConfig({
	resolve: {
		alias: {
			'#dreamcli/testkit': `${packageSrc}/testkit.ts`,
			'@kjanat/dreamcli/testkit': `${packageSrc}/testkit.ts`,
			'@kjanat/dreamcli/runtime': `${packageSrc}/runtime.ts`,
			'@kjanat/dreamcli': `${packageSrc}/index.ts`,
		},
	},
	test: {
		include: ['.vitepress/data/*.test.ts'],
	},
});
