import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		coverage: {
			include: ['src/**/*.ts', 'scripts/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'src/**/index.ts'],
		},
	},
});
