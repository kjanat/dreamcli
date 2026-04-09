import { env } from 'node:process';
import pkg from '@kjanat/dreamcli/package.json' with { type: 'json' };
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { ModuleDetectionKind, ModuleKind, ModuleResolutionKind } from 'typescript';
import { defineConfig } from 'vitepress';
import jsr from '../../../packages/dreamcli/deno.json' with { type: 'json' };
import tsc from '../../../tsconfig.json' with { type: 'json' };
import { collectPublicApiIndex } from './data/api-index.ts';
import { collectExampleMeta } from './data/examples.ts';
import {
	examplesRoot,
	packageJsonPath,
	packageRoot,
	rootDirPath as projectRoot,
} from './data/paths.ts';
import {
	collectCaseInsensitiveCollisions,
	toCollisionKey,
	toSymbolPageRoute,
} from './data/symbol-pages.ts';
import { dreamcliDocsPlugin, shikiClasses } from './vite-plugins';
import { fixTsProcessedLinkcode, transformerJSDocTags } from './vite-plugins/shiki-jsdoc-tags.ts';

const exampleMeta = await collectExampleMeta(examplesRoot);
const apiIndex = await collectPublicApiIndex(packageJsonPath);
const symbolRoutes = new Map<string, string>();
{
	const allSymbols = apiIndex.flatMap((ep) =>
		ep.kindGroups.flatMap((group) =>
			group.symbols.map((sym) => ({ entrypoint: ep.entrypoint, name: sym.name, kind: sym.kind })),
		),
	);
	const collisions = collectCaseInsensitiveCollisions(allSymbols);

	for (const sym of allSymbols) {
		if (symbolRoutes.has(sym.name)) continue;
		symbolRoutes.set(
			sym.name,
			toSymbolPageRoute(sym.entrypoint, sym.name, {
				publicKind: sym.kind,
				hasCaseInsensitiveCollision: collisions.has(toCollisionKey(sym.entrypoint, sym.name)),
			}),
		);
	}
}
const isCI = Boolean(env.CI);
const ifCI = (ifCiThen: string, ifNotCiThen: string) => (isCI ? ifCiThen : ifNotCiThen);
const isGithubActions = Boolean(env.GITHUB_ACTIONS);

const compilerOptions = {
	baseUrl: projectRoot,
	paths: tsc.compilerOptions?.paths ?? {},
	moduleDetection: ModuleDetectionKind.Force,
	module: ModuleKind.ESNext,
	moduleResolution: ModuleResolutionKind.Bundler,
	allowImportingTsExtensions: true,
	noEmit: true,
	resolveJsonModule: true,
	typeRoots: [`${packageRoot}/node_modules/@types`, `${packageRoot}/node_modules`],
};

const links = {
	github: pkg.repository.url.replace(/^git[+]/, ''),
	npm: `https://www.npmjs.com/package/${pkg.name}`,
	jsr: `https://jsr.io/${pkg.name}`,
} as const;

export default defineConfig({
	title: 'dreamcli',
	description: pkg.description,
	cleanUrls: true,
	base: isGithubActions ? '/dreamcli' : '/',
	sitemap: {
		hostname: isGithubActions
			? 'https://kjanat.github.io/dreamcli'
			: ifCI(pkg.homepage, 'http://localhost'),
	},
	head: [
		[
			'link',
			{
				rel: 'icon',
				type: 'image/svg+xml',
				href: '/favicon.svg',
				media: '(prefers-color-scheme: light)',
			},
		],
		[
			'link',
			{
				rel: 'icon',
				type: 'image/svg+xml',
				href: '/favicon-dark.svg',
				media: '(prefers-color-scheme: dark)',
			},
		],
		[
			'link',
			{
				rel: 'apple-touch-icon',
				href: '/apple-touch-icon.png',
				sizes: '180x180',
			},
		],
		[
			'link',
			{
				rel: 'manifest',
				type: 'application/manifest+json',
				href: '/manifest.json',
			},
		],
		['meta', { name: 'theme-color', content: '#f8f3e7' }],
	],
	themeConfig: {
		logo: {
			light: '/logo-light.svg',
			dark: '/logo-dark.svg',
			alt: 'DreamCLI logo',
		},
		nav: [
			{ text: 'Concepts', link: '/concepts/anatomy' },
			{ text: 'Guide', link: '/guide/getting-started' },
			{ text: 'Examples', link: '/examples/' },
			{ text: 'Reference', link: '/reference/api' },
		],
		sidebar: {
			'/concepts/': [
				{
					text: 'CLI Fundamentals',
					items: [
						{ text: 'Anatomy of a CLI', link: '/concepts/anatomy' },
						{ text: 'Input Sources', link: '/concepts/input' },
						{ text: 'Output and TTY', link: '/concepts/output' },
						{ text: 'Exit Codes', link: '/concepts/exit-codes' },
						{ text: 'Errors', link: '/concepts/errors' },
						{ text: 'Testing CLIs', link: '/concepts/testing' },
					],
				},
			],
			'/guide/': [
				{
					text: 'Introduction',
					items: [
						{ text: 'Getting Started', link: '/guide/getting-started' },
						{ text: 'Why dreamcli', link: '/guide/why' },
						{ text: 'Walkthrough: GitHub CLI', link: '/guide/walkthrough' },
					],
				},
				{
					text: 'Core Features',
					items: [
						{ text: 'Commands', link: '/guide/commands' },
						{ text: 'Flags', link: '/guide/flags' },
						{ text: 'Arguments', link: '/guide/arguments' },
						{ text: 'Output', link: '/guide/output' },
						{ text: 'Errors', link: '/guide/errors' },
					],
				},
				{
					text: 'Advanced',
					items: [
						{ text: 'Architecture Rationale', link: '/guide/rationale' },
						{
							text: 'Limitations And Workarounds',
							link: '/guide/limitations',
						},
						{ text: 'Migration And Adoption', link: '/guide/migration' },
						{ text: 'Troubleshooting', link: '/guide/troubleshooting' },
						{ text: 'Middleware', link: '/guide/middleware' },
						{ text: 'Config Files', link: '/guide/config' },
						{ text: 'CLI Semantics', link: '/guide/semantics' },
						{ text: 'Schema Export', link: '/guide/schema-export' },
						{ text: 'Shell Completions', link: '/guide/completions' },
						{ text: 'Interactive Prompts', link: '/guide/prompts' },
						{ text: 'Runtime Support', link: '/guide/runtime' },
					],
				},
				{
					text: 'Testing',
					items: [{ text: 'Testing Commands', link: '/guide/testing' }],
				},
			],
			'/examples/': [
				{
					text: `Examples (${exampleMeta.length})`,
					items: [
						{ text: 'Overview', link: '/examples/' },
						...exampleMeta.map((example) => ({
							text: example.navTitle,
							link: example.routePath,
						})),
					],
				},
			],
			'/reference/': [
				{
					text: 'API Reference',
					items: [
						{ text: 'Overview', link: '/reference/api' },
						{ text: '@kjanat/dreamcli', link: '/reference/main' },
						{ text: '@kjanat/dreamcli/testkit', link: '/reference/testkit' },
						{ text: '@kjanat/dreamcli/runtime', link: '/reference/runtime' },
						{ text: '@kjanat/dreamcli/schema', link: '/reference/schema' },
					],
				},
				{
					text: 'Contracts And Audits',
					items: [
						{ text: 'Changelog', link: '/reference/changelog' },
						{
							text: 'Semantic Delta Log',
							link: '/reference/semantic-delta-log',
						},
						{ text: 'Planner Contract', link: '/reference/planner-contract' },
						{
							text: 'Resolver Contract',
							link: '/reference/resolver-contract',
						},
						{ text: 'Output Contract', link: '/reference/output-contract' },
						{
							text: 'Example Hover',
							link: '/reference/example-hover-prototype',
						},
						{ text: 'Support Matrix', link: '/reference/support-matrix' },
					],
				},
			],
		},
		socialLinks: [
			{ icon: 'github', link: links.github, ariaLabel: 'GitHub' },
			{ icon: 'npm', link: `https://npm.im/${pkg.name}`, ariaLabel: 'NPM' },
			{ icon: 'jsr', link: `https://jsr.io/${jsr.name}`, ariaLabel: 'JSR' },
		],
		search: { provider: 'local' },
		footer: {
			message: `Released under the ${pkg.license} License.`,
			copyright: `Copyright © 2026-present ${pkg.author.name}`,
		},
		lastUpdated: {
			text: 'Last updated',
			formatOptions: { dateStyle: 'short', timeStyle: 'short' },
		},
	},
	markdown: {
		codeTransformers: [
			transformerTwoslash({
				explicitTrigger: true,
				twoslashOptions: {
					vfsRoot: projectRoot,
					compilerOptions,
				},
				processHoverDocs(docs) {
					return fixTsProcessedLinkcode(docs, symbolRoutes);
				},
			}),
			transformerJSDocTags({ symbolRoutes }),
			shikiClasses,
		],
		languages: ['js', 'jsx', 'ts', 'tsx'],
	},
	vite: {
		plugins: dreamcliDocsPlugin(),
		ssr: { noExternal: ['vue'] },
		build: {
			chunkSizeWarningLimit: 600,
			rollupOptions: {
				maxParallelFileOps: isCI ? 2 : undefined,
				output: {
					manualChunks(id) {
						// Shiki/twoslash syntax highlighting — large WASM + grammars
						if (id.includes('shiki')) {
							return 'shiki';
						}
					},
				},
			},
		},
	},
});
