import { execFileSync } from 'node:child_process';
import { normalize } from 'node:path';
import { env } from 'node:process';
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { ModuleDetectionKind, ModuleKind, ModuleResolutionKind } from 'typescript';
import { defineConfig } from 'vitepress';
import pkg from '../../package.json' with { type: 'json' };
import tsc from '../../tsconfig.json' with { type: 'json' };
import { collectPublicApiIndex } from './data/api-index.ts';
import { collectExampleMeta } from './data/examples.ts';
import { examplesRoot, packageJsonPath } from './data/paths.ts';
import {
	collectCaseInsensitiveCollisions,
	toCollisionKey,
	toSymbolPageRoute,
} from './data/symbol-pages.ts';
import { dreamcliDocsPlugin, shikiClasses } from './vite-plugins/index.ts';
import { fixTsProcessedLinkcode, transformerJSDocTags } from './vite-plugins/shiki-jsdoc-tags.ts';

const projectRoot = normalize(`${import.meta.dirname}/../..`);

// `src/schema.ts` statically imports `../dreamcli.schema.json`, a gitignored
// build artifact. TypeDoc (run by `*.paths.ts` dynamic-route loaders and
// `*.data.ts` data loaders) typechecks that import, so the schema must exist
// before route/data resolution. VitePress bundles those loaders in a transient
// esbuild step that bypasses this Vite config's plugins, so the source-artifacts
// plugin's `buildStart` hook fires too late. Emitting here at config
// module-evaluation time — the first thing VitePress runs — guarantees the
// artifact exists before any loader is bundled or executed. Run via subprocess
// so the script resolves `@kjanat/dreamcli` in its own Bun context; importing it
// here breaks VitePress's esbuild config loader (cannot resolve the self-import).
execFileSync('bun', ['scripts/emit-definition-schema.ts'], { cwd: projectRoot });
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
	lib: tsc.compilerOptions?.lib ?? ['ESNext'],
	paths: tsc.compilerOptions?.paths ?? {},
	moduleDetection: ModuleDetectionKind.Force,
	module: ModuleKind.ESNext,
	moduleResolution: ModuleResolutionKind.Bundler,
	allowImportingTsExtensions: tsc.compilerOptions?.allowImportingTsExtensions,
	noEmit: true,
	resolveJsonModule: tsc.compilerOptions?.resolveJsonModule,
	types: [...(tsc.compilerOptions?.types ?? []), 'vitest/globals'],
};

const links = {
	github: pkg.repository.url.replace(/^git[+]/, ''),
	npm: 'https://npm.im/@kjanat/dreamcli',
	jsr: 'https://jsr.io/@kjanat/dreamcli',
} as const;

export default defineConfig({
	title: pkg.name,
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
		[
			'script',
			{
				defer: '',
				src: 'https://static.cloudflareinsights.com/beacon.min.js',
				'data-cf-beacon': '{"token": "ee9b04d68d3740bebb38f5c20629b7c1"}',
			},
		],
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
			{
				text: 'Links',
				items: [
					{ text: 'GitHub', link: links.github },
					{ text: 'npm', link: links.npm },
					{ text: 'JSR', link: links.jsr },
				],
			},
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
						{ text: 'Help', link: '/guide/help' },
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
						{ text: 'Upgrading From 2.x', link: '/guide/upgrading-v3' },
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
						{ text: 'Schema', link: '/reference/schema' },
						{ text: 'Support Matrix', link: '/reference/support-matrix' },
						{ text: '@kjanat/dreamcli', link: '/reference/main' },
						{ text: '@kjanat/dreamcli/testkit', link: '/reference/testkit' },
						{ text: '@kjanat/dreamcli/runtime', link: '/reference/runtime' },
					],
				},
			],
		},
		// Each icon carries two stacked layers: a `.sl-mono` silhouette painted in
		// `currentColor` (the muted theme text colour) shown at rest, and a
		// `.sl-brand` layer with the real brand fills revealed on hover. The
		// theme's custom.css crossfades between them, so all three share the exact
		// same neutral colour/brightness at rest and bloom to their own brand
		// colours on hover — including JSR's two-tone logo (#f7df1e + #083344).
		socialLinks: [
			{
				icon: {
					svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g class="sl-mono" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></g><g class="sl-brand"><path class="gh-mark" fill="#181717" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></g></svg>',
				},
				link: links.github,
				ariaLabel: 'GitHub',
			},
			{
				icon: {
					svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g class="sl-mono" fill="currentColor"><path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/></g><g class="sl-brand"><path fill="#CB3837" d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/></g></svg>',
				},
				link: links.npm,
				ariaLabel: 'npm',
			},
			{
				icon: {
					svg: '<svg role="img" viewBox="0 0 24 12.924" xmlns="http://www.w3.org/2000/svg"><g class="sl-mono" fill="currentColor"><path d="M3.692 0v3.693H0v7.384h7.385v1.847h12.923v-3.693H24V1.847h-7.385V0Zm1.846 1.847h1.847v7.384H1.846v-3.692h1.846v1.846h1.846zm3.693 0h5.538V3.692h-3.692v1.846h3.692v5.538H9.231V9.232h3.692v-1.846H9.231Zm7.384 1.846h5.539v3.692h-1.846v-1.846h-1.846v5.538h-1.847z"/></g><g class="sl-brand"><path fill="#f7df1e" d="M3.692 0v3.693H0v7.384h7.385v1.847h12.923v-3.693H24V1.847h-7.385V0Z"/><path fill="#083344" d="M3.692 0v3.693H0v7.384h7.385v1.847h12.923v-3.693H24V1.847h-7.385V0Zm1.846 1.847h1.847v7.384H1.846v-3.692h1.846v1.846h1.846zm3.693 0h5.538V3.692h-3.692v1.846h3.692v5.538H9.231V9.232h3.692v-1.846H9.231Zm7.384 1.846h5.539v3.692h-1.846v-1.846h-1.846v5.538h-1.847z"/></g></svg>',
				},
				link: links.jsr,
				ariaLabel: 'JSR',
			},
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
