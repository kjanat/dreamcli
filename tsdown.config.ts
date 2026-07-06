import { $, env } from 'bun';
import { existsSync } from 'node:fs';
import { defineConfig, type UserConfig } from 'tsdown';
import attw from './.attw.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };
import { emitDefinitionSchema } from './scripts/emit-definition-schema.ts';

const version = JSON.stringify(pkg.version);
const revision = JSON.stringify((await $`git rev-parse --short HEAD`.text()).trim());

const { profile, ignoreRules } = attw;
if (profile !== 'strict' && profile !== 'node16' && profile !== 'esm-only') {
	throw new Error(`Invalid attw profile in .attw.json: ${profile}`);
}

export const entries = {
	index: 'src/index.ts',
	runtime: 'src/runtime.ts',
	testkit: 'src/testkit.ts',
	// Deliberately a subpath (not re-exported from the root) so the framework's
	// own version constants don't crowd root-import IDE completions.
	version: 'src/version.ts',
} satisfies UserConfig['entry'];

export default defineConfig({
	define: {
		__DREAMCLI_VERSION__: version,
		__DREAMCLI_REVISION__: revision,
	},
	entry: entries,
	format: 'esm',
	dts: {
		enabled: true,
		tsgo: true,
		entry: ['**', '!src/**/*{.test,test-helpers}.ts'],
		newContext: true,
		resolver: 'oxc',
	},
	clean: true,
	platform: 'node',
	exports: {
		packageJson: true,
		customExports(exports) {
			for (const [key, path] of Object.entries(exports)) {
				if (typeof path !== 'string') {
					delete exports[key];
					continue;
				}
				const typesPath = path.replace(/\.([mc]?)js$/, '.d.$1ts');
				if (typesPath !== path && existsSync(typesPath)) {
					exports[key] = { types: typesPath, default: path };
				}
			}
			exports['./schema'] = './dreamcli.schema.json';
			return exports;
		},
	},
	minify: 'dce-only',
	unbundle: true,
	publint: { enabled: 'local-only', level: 'suggestion', strict: true },
	attw: { enabled: 'local-only', profile, ignoreRules, level: 'warn' },
	report: { enabled: !env.CI },
	hooks: {
		'build:prepare': () => {
			return emitDefinitionSchema();
		},
	},
	onSuccess: 'bun fmt package.json',
});
