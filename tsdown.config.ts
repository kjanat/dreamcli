import { existsSync } from 'node:fs';
import { profile, ignoreRules } from './.attw.json' with { type: 'json' };
import { engines, version } from './package.json' with { type: 'json' };
import { emitDefinitionSchema } from './scripts/emit-definition-schema.ts';

import type { AttwOptions, UserConfig } from 'tsdown';
import { defineConfig } from 'tsdown';

export const entries = {
	index: 'src/index.ts',
	completion: 'src/completion.ts',
	config: 'src/config.ts',
	'json-schema': 'src/json-schema.ts',
	prompt: 'src/prompt.ts',
	runtime: 'src/runtime.ts',
	testkit: 'src/testkit.ts',
	version: 'src/version.ts',
} satisfies UserConfig['entry'];

const LAZY_MODULES = [
	/\/src\/core\/completion\/(index|shells\/[^/]+)\.ts$/,
	/\/src\/core\/json-schema\/(index|meta-descriptions\.generated)\.ts$/,
	/\/src\/core\/config\/(index|package-json)\.ts$/,
	/\/src\/core\/prompt\/terminal\.ts$/,
	/\/src\/version\.ts$/,
];

function isCoreModule(id: string): boolean {
	return (
		/\/src\/(core|runtime)\/.+\.ts$|\/src\/strings\.ts$/.test(id) &&
		!id.endsWith('.d.ts') &&
		!LAZY_MODULES.some((pattern) => pattern.test(id))
	);
}

export default defineConfig({
	define: {
		__DREAMCLI_VERSION__: JSON.stringify(version),
		__DREAMCLI_REVISION__: JSON.stringify((await Bun.$`git rev-parse --short HEAD`.text()).trim()),
	},
	entry: entries,
	format: 'esm',
	target: [`node${engines.node.replace('>=', '')}`, `deno${engines.deno.replace('>=', '')}`],
	dts: {
		enabled: true,
		newContext: true,
		resolver: 'oxc',
		oxc: {
			stripInternal: true,
		},
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
	minify: {
		compress: true,
		mangle: { toplevel: false },
		codegen: { removeWhitespace: true },
	},
	outputOptions: {
		codeSplitting: {
			groups: [{ name: 'core', test: isCoreModule }],
		},
	},
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
	onSuccess: 'bun run fmt:dprint package.json',
});
