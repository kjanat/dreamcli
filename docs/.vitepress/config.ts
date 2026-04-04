import { normalize } from 'node:path';
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { ModuleKind, ModuleResolutionKind } from 'typescript';
import { defineConfig } from 'vitepress';
import { MermaidMarkdown, MermaidPlugin } from 'vitepress-plugin-mermaid';
import pkg from '../../package.json' with { type: 'json' };
import tsconfig from '../../tsconfig.json' with { type: 'json' };
import {
  generatedExamples,
  generatedReferenceSurfaces,
} from '../.generated/site-data.ts';

const projectRoot = normalize(`${import.meta.dirname}/../..`);
const ifCI = (ifCiThen: string, ifNotCiThen: string) =>
  process.env.CI ? ifCiThen : ifNotCiThen;

const examplesSidebarTitle = `Examples${generatedExamples.length === 0 ? '' : ` (${generatedExamples.length})`}`;
const generatedReferenceTitle = `Generated Surfaces${generatedReferenceSurfaces.length === 0 ? '' : ` (${generatedReferenceSurfaces.length})`}`;

const links = {
  github: 'https://github.com/kjanat/dreamcli',
  npm: 'https://www.npmjs.com/package/@kjanat/dreamcli',
  jsr: 'https://jsr.io/@kjanat/dreamcli',
} as const;

export default defineConfig({
  title: '@kjanat/dreamcli',
  description: 'Schema-first, fully typed TypeScript CLI framework',
  cleanUrls: true,
  base: `${ifCI('', '.')}/`,
  sitemap: {
    hostname: ifCI('https://dreamcli.kjanat.com', 'localhost'),
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
            { text: 'Limitations And Workarounds', link: '/guide/limitations' },
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
          text: examplesSidebarTitle,
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
              text: generatedReferenceTitle,
              link: '/reference/generated-surfaces',
            },
            { text: 'Changelog', link: '/reference/changelog' },
            { text: 'Docs Health', link: '/reference/docs-health' },
            {
              text: 'Semantic Delta Log',
              link: '/reference/semantic-delta-log',
            },
            { text: 'Planner Contract', link: '/reference/planner-contract' },
            { text: 'Resolver Contract', link: '/reference/resolver-contract' },
            { text: 'Output Contract', link: '/reference/output-contract' },
            {
              text: 'Example Hover',
              link: '/reference/example-hover-prototype',
            },
            { text: 'Support Matrix', link: '/reference/support-matrix' },
            { text: '@kjanat/dreamcli', link: '/reference/main' },
            { text: '@kjanat/dreamcli/testkit', link: '/reference/testkit' },
            { text: '@kjanat/dreamcli/runtime', link: '/reference/runtime' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: links.github }],
    search: { provider: 'local' },
    footer: {
      message: `Released under the ${pkg.license} License.`,
      copyright: `Copyright © 2026-present ${pkg.author.name}`,
    },
  },
  markdown: {
    codeTransformers: [
      transformerTwoslash({
        explicitTrigger: true,
        twoslashOptions: {
          vfsRoot: projectRoot,
          compilerOptions: {
            baseUrl: projectRoot,
            paths: tsconfig.compilerOptions?.paths ?? {},
            module: ModuleKind.ESNext,
            moduleResolution: ModuleResolutionKind.Bundler,
            allowImportingTsExtensions:
              tsconfig.compilerOptions?.allowImportingTsExtensions ?? false,
            noEmit: true,
          },
        },
      }),
    ],
    languages: ['js', 'jsx', 'ts', 'tsx'],
    config: (md) => {
      md.use(MermaidMarkdown);
    },
  },
  vite: {
    plugins: [MermaidPlugin()],
    ssr: { noExternal: ['vue'] },
  },
});
