import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'docs/.vitepress/data/*.test.ts'],
		coverage: {
			include: ['src/**/*.ts', 'docs/.vitepress/data/*.ts'],
			exclude: [
				'src/**/*.test.ts',
				'docs/.vitepress/data/*.test.ts',
				'src/**/index.ts',
				'**/*.d.ts',
				'src/core/json-schema/meta-descriptions.generated.ts',
			],
			thresholds: {
				statements: 85,
				branches: 80,
				functions: 88,
				lines: 85,
			},
		},
	},
});
