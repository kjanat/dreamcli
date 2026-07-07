import { existsSync } from 'node:fs';
import { profile, ignoreRules } from './.attw.json' with { type: 'json' };
import { version } from './package.json' with { type: 'json' };
import { emitDefinitionSchema } from './scripts/emit-definition-schema.ts';

import type { AttwOptions, UserConfig } from 'tsdown';
import { defineConfig } from 'tsdown';

export const entries = {
	index: 'src/index.ts',
	runtime: 'src/runtime.ts',
	testkit: 'src/testkit.ts',
	version: 'src/version.ts',
} satisfies UserConfig['entry'];

export default defineConfig({
	define: {
		__DREAMCLI_VERSION__: JSON.stringify(version),
		__DREAMCLI_REVISION__: JSON.stringify((await Bun.$`git rev-parse --short HEAD`.text()).trim()),
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
	attw: {
		enabled: 'local-only',
		profile: profile as any satisfies AttwOptions['profile'],
		ignoreRules,
		level: 'warn',
	},
	report: 'local-only',
	hooks: {
		'build:prepare': () => {
			return emitDefinitionSchema();
		},
	},
	onSuccess: 'bun fmt package.json',
});
