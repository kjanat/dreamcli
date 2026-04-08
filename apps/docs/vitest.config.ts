import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['.vitepress/data/*.test.ts'],
	},
});
