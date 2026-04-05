/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import { collectExamples, renderExamplePage } from './examples.ts';
import { examplesRoot, gitRef, rootDirPath } from './paths.ts';

describe('example docs generation', () => {
  it('collects source-backed example metadata with related links', async () => {
    const examples = await collectExamples(examplesRoot, rootDirPath);

    expect(examples.map((example) => example.slug)).toEqual([
      'basic',
      'interactive',
      'json-mode',
      'middleware',
      'multi-command',
      'spinner-progress',
      'testing',
    ]);

    const basic = examples.find((example) => example.slug === 'basic');
    expect(basic).toMatchObject({
      routePath: '/examples/basic',
      sourcePath: 'examples/basic.ts',
      sourceUrl: `https://github.com/kjanat/dreamcli/blob/${gitRef}/examples/basic.ts`,
    });
    expect(basic?.relatedSymbols).toContainEqual({
      entrypoint: '@kjanat/dreamcli',
      name: 'cli',
      href: '/reference/symbols/main/cli',
    });
    expect(basic?.relatedSymbols).toContainEqual({
      entrypoint: '@kjanat/dreamcli',
      name: 'flag',
      href: '/reference/symbols/main/flag',
    });
    expect(basic?.relatedGuides).toContainEqual({
      label: 'Commands guide',
      href: '/guide/commands',
    });
  });

  it('renders detail page with related links computed at render time', async () => {
    const [example] = await collectExamples(examplesRoot, rootDirPath);
    if (example === undefined) {
      throw new Error('expected at least one example');
    }

    const page = renderExamplePage(example);
    expect(page).toContain('# Basic single-command CLI.');
    expect(page).toContain(
      `- Source: [\`examples/basic.ts\`](https://github.com/kjanat/dreamcli/blob/${gitRef}/examples/basic.ts)`,
    );
    expect(page).toContain('## Usage');
    expect(page).toContain('npx tsx examples/basic.ts Alice --loud --times 3');
    expect(page).toContain('## Related Guides');
    expect(page).toContain('- [Commands guide](/guide/commands)');
    expect(page).toContain('## Related Links');
    expect(page).toContain('- [`command`](/reference/symbols/main/command)');
    expect(page).toContain('- [Examples overview](/examples/)');
    expect(page).toContain('- [API overview](/reference/api)');
    expect(page).toContain('## Source');
    expect(page).toContain('```ts twoslash');
    expect(page).toContain(
      "import { arg, cli, command, flag } from '@kjanat/dreamcli';",
    );
  });
});
