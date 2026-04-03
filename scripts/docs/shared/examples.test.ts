/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import {
	collectExamples,
	renderExampleHoverPrototypePage,
	renderExamplePage,
	renderExamplesIndex,
} from './examples.ts';
import { examplesRoot, rootDirPath } from './paths.ts';

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
			sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/basic.ts',
		});
		expect(basic?.relatedLinks).toContainEqual({
			label: '`cli`',
			href: '/reference/symbols/main/cli',
		});
		expect(basic?.relatedLinks).toContainEqual({
			label: '`flag`',
			href: '/reference/symbols/main/flag',
		});
	});

	it('renders linked inventory and detail pages', async () => {
		const [example] = await collectExamples(examplesRoot, rootDirPath);
		if (example === undefined) {
			throw new Error('expected at least one example');
		}

		const inventory = renderExamplesIndex([example]);
		expect(inventory).toContain('| [`basic`](/examples/basic) | Basic single-command CLI. |');

		const page = renderExamplePage(example);
		expect(page).toContain('# Basic single-command CLI.');
		expect(page).toContain(
			'- Source: [`examples/basic.ts`](https://github.com/kjanat/dreamcli/blob/master/examples/basic.ts)',
		);
		expect(page).toContain('## Usage');
		expect(page).toContain('npx tsx examples/basic.ts Alice --loud --times 3');
		expect(page).toContain('## Related Links');
		expect(page).toContain('- [`command`](/reference/symbols/main/command)');
		expect(page).toContain('## Source');
		expect(page).toContain("import { arg, cli, command, flag } from 'dreamcli';");
	});

	it('renders a Twoslash-backed hover prototype page from a real example', async () => {
		const [example] = await collectExamples(examplesRoot, rootDirPath);
		if (example === undefined) {
			throw new Error('expected at least one example');
		}

		const page = renderExampleHoverPrototypePage(example);
		expect(page).toContain('# Example Hover Prototype');
		expect(page).toContain('```ts twoslash');
		expect(page).toContain('- Scope: examples only');
		expect(page).toContain("import { arg, cli, command, flag } from 'dreamcli';");
	});
});
