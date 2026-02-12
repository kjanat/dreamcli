import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		testkit: 'src/testkit.ts',
		runtime: 'src/runtime.ts',
	},
	format: {
		esm: {
			target: ['ESNext'],
		},
		cjs: {
			target: ['node22'],
		},
	},
	dts: {
		oxc: true,
		tsgo: { path: 'node_modules/.bin/tsgo', enabled: false },
	},
	clean: true,
	target: 'ESNext',
	platform: 'node',
	exports: {
		devExports: 'bun',
		legacy: true,
		enabled: true,
		packageJson: true,
	},
	unbundle: true,
	minify: 'dce-only',
	publint: true,
	attw: { profile: 'strict', level: 'error', ignoreRules: ['no-resolution'] },
	onSuccess: 'bun format package.json', // ensures proper sorting of the exports
});
