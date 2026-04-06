/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import { collectPublicApiIndex } from './api-index.ts';
import { collectExamples } from './examples.ts';
import { examplesRoot, packageJsonPath, rootDirPath, symbolPagesRoot } from './paths.ts';
import { collectSymbolPages, toSymbolPageRoute } from './symbol-pages.ts';
import { collectTypeDocModel } from './typedoc.ts';

describe('symbol page generation', () => {
	it('renders stable per-symbol routes from the normalized TypeDoc model', {
		timeout: 60_000,
	}, async () => {
		const publicApi = await collectPublicApiIndex(packageJsonPath);
		const examples = await collectExamples(examplesRoot, rootDirPath);
		const { normalized } = await collectTypeDocModel(packageJsonPath, publicApi);
		const pages = collectSymbolPages(normalized, symbolPagesRoot, examples);

		const cliPage = pages.find((page) => page.id === '@kjanat/dreamcli:cli');
		const middlewareInterfacePage = pages.find((page) => page.id === '@kjanat/dreamcli:Middleware');
		expect(cliPage).toMatchObject({
			entrypoint: '@kjanat/dreamcli',
			name: 'cli',
			routePath: '/reference/symbols/main/cli',
			filePath: expect.stringContaining('/docs/reference/symbols/main/cli.md'),
		});
		expect(cliPage?.content).toContain('# `cli`');
		expect(cliPage?.content).toContain('## Signatures');
		expect(cliPage?.content).toContain('function cli(name: string): CLIBuilder;');
		expect(cliPage?.content).toContain('## Examples');
		expect(cliPage?.content).toContain('## Related Examples');
		expect(cliPage?.content).toContain('- [Basic single-command CLI.](/examples/basic)');
		expect(cliPage?.content).toContain('## Related Guides');
		expect(cliPage?.content).toContain('- [Commands guide](/guide/commands)');
		expect(cliPage?.content).toContain('- [Example Hover](/reference/example-hover-prototype)');
		expect(cliPage?.content).toContain('- [API overview](/reference/api)');
		expect(middlewareInterfacePage).toMatchObject({
			routePath: '/reference/symbols/main/middleware-type',
			filePath: expect.stringContaining('/docs/reference/symbols/main/middleware-type.md'),
		});
	});

	it('renders parameter tables with escaped markdown pipes but plain type unions', {
		timeout: 60_000,
	}, async () => {
		const publicApi = await collectPublicApiIndex(packageJsonPath);
		const examples = await collectExamples(examplesRoot, rootDirPath);
		const { normalized } = await collectTypeDocModel(packageJsonPath, publicApi);
		const pages = collectSymbolPages(normalized, symbolPagesRoot, examples);

		const runCommandPage = pages.find((page) => page.id === '@kjanat/dreamcli/testkit:runCommand');

		expect(runCommandPage?.content).toContain('| Parameter | Type | Description |');
		expect(runCommandPage?.content).toContain('| `options` | `RunOptions \\| undefined` |');
		expect(runCommandPage?.content).not.toContain('| `options` | `RunOptions \\\\| undefined` |');
	});

	it('keeps API index links aligned with rendered symbol routes', () => {
		expect(toSymbolPageRoute('@kjanat/dreamcli', 'cli')).toBe('/reference/symbols/main/cli');
		expect(
			toSymbolPageRoute('@kjanat/dreamcli', 'Middleware', {
				publicKind: 'type',
				hasCaseInsensitiveCollision: true,
			}),
		).toBe('/reference/symbols/main/middleware-type');
		expect(toSymbolPageRoute('@kjanat/dreamcli/runtime', 'RuntimeAdapter')).toBe(
			'/reference/symbols/runtime/RuntimeAdapter',
		);
		expect(toSymbolPageRoute('@kjanat/dreamcli/testkit', 'runCommand')).toBe(
			'/reference/symbols/testkit/runCommand',
		);
	});
});
