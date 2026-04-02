import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { definitionMetaSchema } from 'dreamcli';
import { defineConfig } from 'vitepress';
import { MermaidMarkdown, MermaidPlugin } from 'vitepress-plugin-mermaid';
import { generatedExamples, generatedReferenceSurfaces } from '../.generated/site-data.ts';

const examplesSidebarTitle =
  generatedExamples.length === 0 ? 'Examples' : `Examples (${generatedExamples.length})`;
const generatedReferenceTitle =
  generatedReferenceSurfaces.length === 0
    ? 'Generated Surfaces'
    : `Generated Surfaces (${generatedReferenceSurfaces.length})`;

export default defineConfig({
  title: 'dreamcli',
  description: 'Schema-first, fully typed TypeScript CLI framework',
  cleanUrls: true,
  base: '/',
  sitemap: { hostname: 'https://dreamcli.kjanat.com' },
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
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' }],
    ['link', { rel: 'manifest', href: '/site.webmanifest' }],
    ['meta', { name: 'theme-color', content: '#f8f3e7' }],
  ],
  themeConfig: {
    logo: {
      light: '/logo-light.svg',
      dark: '/logo-dark.svg',
    },
    nav: [
      { text: 'Concepts', link: '/concepts/anatomy' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Examples', link: '/examples/' },
      { text: 'Reference', link: '/reference/api' },
      {
        text: 'Links',
        items: [
          { text: 'GitHub', link: 'https://github.com/kjanat/dreamcli' },
          { text: 'npm', link: 'https://www.npmjs.com/package/dreamcli' },
          { text: 'JSR', link: 'https://jsr.io/@kjanat/dreamcli' },
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
          items: [{ text: 'Overview', link: '/examples/' }],
        },
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/reference/api' },
            { text: generatedReferenceTitle, link: '/reference/generated-surfaces' },
            { text: 'Planner Contract', link: '/reference/planner-contract' },
            { text: 'Resolver Contract', link: '/reference/resolver-contract' },
            { text: 'Output Contract', link: '/reference/output-contract' },
            { text: 'Support Matrix', link: '/reference/support-matrix' },
            { text: 'dreamcli', link: '/reference/main' },
            { text: 'dreamcli/testkit', link: '/reference/testkit' },
            { text: 'dreamcli/runtime', link: '/reference/runtime' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/kjanat/dreamcli' }],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © 2026-present Kaj Kowalski`,
    },
  },
  markdown: {
    config: (md) => {
      md.use(MermaidMarkdown);
    },
  },
  vite: {
    plugins: [MermaidPlugin()],
  },
  buildEnd({ outDir }) {
    const dir = join(outDir, 'schemas', 'cli');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'v1.json'), JSON.stringify(definitionMetaSchema, null, '\t'));
  },
});
