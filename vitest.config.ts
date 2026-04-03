import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		coverage: {
			include: ['src/**/*.ts', 'scripts/docs/**/*.ts'],
			exclude: [
				'src/**/*.test.ts',
				'scripts/**/*.test.ts',
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
