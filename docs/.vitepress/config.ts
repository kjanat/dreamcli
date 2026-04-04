import { normalize } from 'node:path';
import { transformerStyleToClass } from '@shikijs/transformers';
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import {
  ModuleDetectionKind,
  ModuleKind,
  ModuleResolutionKind,
} from 'typescript';
import type { Plugin } from 'vitepress';
import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import pkg from '../../package.json' with { type: 'json' };
import tsc from '../../tsconfig.json' with { type: 'json' };
import {
  generatedExamples,
  generatedReferenceSurfaces,
} from '../.generated/site-data.ts';

const projectRoot = normalize(`${import.meta.dirname}/../..`);
const lenGt0 = (arr: unknown[] | undefined): boolean =>
  Boolean(arr && arr.length > 0);
const isCI = Boolean(process.env.CI);
const ifCI = (ifCiThen: string, ifNotCiThen: string) =>
  isCI ? ifCiThen : ifNotCiThen;

const compilerOptions = {
  baseUrl: projectRoot,
  customConditions: tsc.compilerOptions?.customConditions ?? [],
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

const shikiClasses = transformerStyleToClass();

/** Serves collected Shiki CSS classes as a virtual CSS module. */
function shikiClassCssPlugin(): Plugin {
  const virtualId = 'virtual:shiki-class.css';
  const resolvedId = `\0${virtualId}`;
  return {
    name: 'shiki-class-css',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) return shikiClasses.getCSS();
    },
  };
}

/**
 * Post-processes rendered chunks to deduplicate inline Shiki style
 * objects (`{"--shiki-light":"...","--shiki-dark":"..."}`) that twoslash
 * popups emit outside the normal transformer pipeline. Replaces repeated
 * style objects with references to shared variables.
 */
function shikiDedupePopupStylesPlugin(): Plugin {
  return {
    name: 'shiki-dedupe-popup-styles',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        // Only process page chunks with twoslash popups
        if (!chunk.code.includes('twoslash-popup-code')) continue;

        const styleMap = new Map<string, string>();
        let counter = 0;

        // Match style objects like {"--shiki-light":"#D73A49","--shiki-dark":"#F97583"}
        // These appear as `style:` values in Vue render functions
        const stylePattern =
          /\{[^{}]*"--shiki-light":"[^"]*"[^{}]*"--shiki-dark":"[^"]*"[^{}]*\}/g;

        // First pass: collect all unique styles and count occurrences
        const occurrences = new Map<string, number>();
        for (const match of chunk.code.matchAll(stylePattern)) {
          occurrences.set(match[0], (occurrences.get(match[0]) ?? 0) + 1);
        }

        // Only deduplicate styles that appear 3+ times
        for (const [style, count] of occurrences) {
          if (count >= 3) {
            styleMap.set(style, `__s${counter++}`);
          }
        }

        if (styleMap.size === 0) continue;

        // Build variable declarations
        const declarations = [...styleMap.entries()]
          .map(([style, varName]) => `const ${varName}=${style};`)
          .join('');

        // Replace all occurrences with variable references
        let code = chunk.code;
        for (const [style, varName] of styleMap) {
          code = code.replaceAll(style, varName);
        }

        // Inject declarations after the first line (usually the module header)
        const firstNewline = code.indexOf('\n');
        chunk.code =
          code.slice(0, firstNewline + 1) +
          declarations +
          code.slice(firstNewline + 1);
      }
    },
  };
}

const links = {
  github: pkg.repository.url.replace(/^git[+]/, ''),
  npm: 'https://www.npmjs.com/package/@kjanat/dreamcli',
  jsr: 'https://jsr.io/@kjanat/dreamcli',
} as const;

export default withMermaid(
  defineConfig({
    title: pkg.name,
    description: pkg.description,
    cleanUrls: true,
    base: '/',
    sitemap: {
      hostname: ifCI(pkg.homepage, 'http://localhost'),
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
            text: `Examples${!lenGt0(generatedExamples) && ` (${generatedExamples.length})`}`,
            items: [
              { text: 'Overview', link: '/examples/' },
              ...generatedExamples.map((example) => ({
                text: example.title,
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
              {
                text: `Generated Surfaces${!lenGt0(generatedReferenceSurfaces) && ` (${generatedReferenceSurfaces.length})`}`,
                link: '/reference/generated-surfaces',
              },
              { text: 'Changelog', link: '/reference/changelog' },
              { text: 'Docs Health', link: '/reference/docs-health' },
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
      socialLinks: [
        { icon: 'github', link: links.github, ariaLabel: 'GitHub' },
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
        }),
        shikiClasses,
      ],
      languages: ['js', 'jsx', 'ts', 'tsx'],
    },
    vite: {
      plugins: [shikiClassCssPlugin(), shikiDedupePopupStylesPlugin()],
      ssr: { noExternal: ['vue'] },
      build: {
        chunkSizeWarningLimit: 600,
        rollupOptions: {
          maxParallelFileOps: isCI ? 2 : undefined,
          output: {
            manualChunks(id) {
              // Mermaid core — heavy and only needed on pages with diagrams
              if (id.includes('mermaid')) {
                return 'mermaid';
              }
              // Shiki/twoslash syntax highlighting — large WASM + grammars
              if (id.includes('shiki')) {
                return 'shiki';
              }
            },
          },
        },
      },
    },
  }),
);
