import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		// ansispeck detects color support from the environment at import time,
		// and CI runners (GitHub Actions) advertise color even without a TTY.
		// Pin it off so auto-gated color is deterministic everywhere; tests
		// that exercise themed output opt in explicitly via `createColors(true)`
		// or `color: true`, which bypass detection.
		env: { NO_COLOR: '1' },
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
