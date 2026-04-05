import { $, env } from 'bun';
import { defineConfig } from 'tsdown';
import attw from './.attw.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };
import { emitDefinitionSchema } from './scripts/emit-definition-schema.ts';

const version = JSON.stringify(pkg.version);
const revision = JSON.stringify((await $`git rev-parse --short HEAD`.text()).trim());

const { profile, ignoreRules } = attw;
if (profile !== 'strict' && profile !== 'node16' && profile !== 'esm-only') {
	throw new Error(`Invalid attw profile in .attw.json: ${profile}`);
}

export default defineConfig({
	define: {
		__DREAMCLI_VERSION__: version,
		__DREAMCLI_REVISION__: revision,
	},
	entry: ['src/index.ts', { testkit: 'src/testkit.ts', runtime: 'src/runtime.ts' }],
	format: 'es',
	dts: {
		enabled: true,
		tsgo: true,
		entry: ['**', '!src/**/*{.test,test-helpers}.ts'],
		newContext: true,
		resolver: 'oxc',
	},
	clean: true,
	platform: 'node',
	exports: false,
	minify: true,
	unbundle: true,
	publint: { enabled: true, level: 'suggestion', strict: true },
	attw: { profile, ignoreRules, level: 'warn' },
	report: { enabled: !env.CI },
	hooks: {
		'build:prepare': () => {
			return emitDefinitionSchema();
		},
	},
	onSuccess: 'bun fmt package.json',
});
