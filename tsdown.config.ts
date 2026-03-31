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
	format: ['esm', 'cjs'],
	dts: { enabled: true, tsgo: true },
	clean: true,
	platform: 'node',
	exports: true,
	define: {
		__DREAMCLI_VERSION__: JSON.stringify(pkg.version),
		__DREAMCLI_REVISION__: JSON.stringify(revision),
	},
	minify: true,
	publint: true,
	attw: { profile: 'node16', level: 'error', ignoreRules: [] },
	onSuccess: 'bunx sort-package-json', // ensures proper sorting of the exports
});
