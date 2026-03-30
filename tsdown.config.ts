import { execSync } from 'node:child_process';
import { defineConfig } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

const revision = (() => {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return 'unknown';
	}
})();

export default defineConfig({
	entry: ['src/index.ts', { testkit: 'src/testkit.ts', runtime: 'src/runtime.ts' }],
	format: {
		esm: {
			target: ['ESNext'],
		},
		cjs: {
			target: ['node22'],
		},
	},
	dts: true,
	clean: true,
	platform: 'node',
	exports: {
		devExports: true,
		enabled: true,
	},
	define: {
		__DREAMCLI_VERSION__: JSON.stringify(pkg.version),
		__DREAMCLI_REVISION__: JSON.stringify(revision),
	},
	unbundle: true,
	minify: 'dce-only',
	publint: true,
	attw: { profile: 'strict', level: 'error', ignoreRules: ['no-resolution'] },
	onSuccess: 'bunx sort-package-json package.json', // ensures proper sorting of the exports
});
