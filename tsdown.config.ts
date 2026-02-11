import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		testkit: 'src/testkit.ts',
		runtime: 'src/runtime.ts',
	},
	format: ['esm', 'cjs'],
	dts: true,
	hash: false,
	clean: true,
	target: 'es2022',
	platform: 'node',
	sourcemap: true,
	treeshake: true,
	exports: true,
	minify: true,
	publint: true,
	attw: { profile: 'strict', level: 'error', ignoreRules: ['no-resolution'] },
	onSuccess: 'bun format package.json', // ensures proper sorting of the exports
});
