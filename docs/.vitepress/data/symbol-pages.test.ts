/**
 * @module
 */

import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PublicApiEntrypoint } from './api-index.ts';
import { collectPublicApiIndex } from './api-index.ts';
import type {
	NormalizedApiComment,
	NormalizedApiModel,
	NormalizedApiNode,
	NormalizedApiType,
} from './api-model.ts';
import { collectDenoDocModel } from './deno-doc.ts';
import { collectExamples } from './examples.ts';
import { examplesRoot, packageJsonPath, rootDirPath, symbolPagesRoot } from './paths.ts';
import { collectSymbolPages, toSymbolPageRoute } from './symbol-pages.ts';

function createComment(summary: string): NormalizedApiComment {
	return {
		summary,
		blockTags: [],
		modifierTags: [],
	};
}

function createIntrinsicType(name: string): NormalizedApiType {
	return { kind: 'intrinsic', name };
}

function createNode(input: {
	name: string;
	kind: NormalizedApiNode['kind'];
	comment?: NormalizedApiComment | null;
	type?: NormalizedApiType | null;
	signatures?: readonly NormalizedApiNode[];
	parameters?: readonly NormalizedApiNode[];
	flags?: readonly string[];
}): NormalizedApiNode {
	return {
		reflectionId: 0,
		name: input.name,
		kind: input.kind,
		flags: input.flags ?? [],
		comment: input.comment ?? null,
		sourcePath: null,
		sources: [],
		defaultValue: null,
		type: input.type ?? null,
		signatures: input.signatures ?? [],
		parameters: input.parameters ?? [],
		typeParameters: [],
		children: [],
		indexSignatures: [],
		getSignature: null,
		setSignature: null,
		extendedTypes: [],
		implementedTypes: [],
		groups: [],
	};
}

describe('symbol page generation', () => {
	let publicApi: readonly PublicApiEntrypoint[] = [];
	let pages: ReturnType<typeof collectSymbolPages> = [];

	beforeAll(async () => {
		publicApi = await collectPublicApiIndex(packageJsonPath);
		const examples = await collectExamples(examplesRoot, rootDirPath);
		const normalized = await collectDenoDocModel(packageJsonPath, publicApi);
		pages = collectSymbolPages(normalized, symbolPagesRoot, examples);
	}, 60_000);

	it('generates exactly one unique route for each public TypeScript export', () => {
		const expectedIds = publicApi.flatMap(({ entrypoint, kindGroups }) =>
			kindGroups
				.filter(({ kind }) => kind !== 'asset')
				.flatMap(({ symbols }) => symbols.map(({ name }) => `${entrypoint}:${name}`)),
		);
		expect(pages.map(({ id }) => id).sort()).toEqual(expectedIds.sort());
		expect(new Set(pages.map(({ routePath }) => routePath)).size).toBe(pages.length);
	});

	it('excludes the JSON schema asset and its Deno default export from symbol pages', () => {
		expect(publicApi.find(({ subpath }) => subpath === './schema')).toMatchObject({
			sourcePath: 'dreamcli.schema.json',
			kindGroups: [{ kind: 'asset', symbols: [{ name: 'schema' }] }],
		});
		expect(pages.filter(({ entrypoint }) => entrypoint === '@kjanat/dreamcli/schema')).toEqual([]);
	});

	it('renders stable per-symbol routes from the normalized API model', () => {
		const cliPage = pages.find((page) => page.id === '@kjanat/dreamcli:cli');
		const middlewareInterfacePage = pages.find((page) => page.id === '@kjanat/dreamcli:Middleware');
		expect(cliPage).toMatchObject({
			entrypoint: '@kjanat/dreamcli',
			name: 'cli',
			routePath: '/reference/symbols/main/cli',
			filePath: join(symbolPagesRoot, 'main', 'cli.md'),
		});
		expect(cliPage?.content).toContain('# `cli`');
		expect(cliPage?.content).toContain('## Signatures');
		expect(cliPage?.content).toContain(
			'function cli(name: string, options?: Omit<CLIOptions, "name">): CLIBuilder;',
		);
		expect(cliPage?.content).toContain('## Examples');
		expect(cliPage?.content).toContain('## Related Examples');
		expect(cliPage?.content).toContain('- [Basic single-command CLI.](/examples/basic)');
		expect(cliPage?.content).toContain('- [Example Hover](/reference/example-hover-prototype)');
		expect(cliPage?.content).toContain('- [API overview](/reference/api)');
		expect(cliPage?.content).not.toContain('/reference/docs-health');
		expect(middlewareInterfacePage).toMatchObject({
			routePath: '/reference/symbols/main/middleware-type',
			filePath: join(symbolPagesRoot, 'main', 'middleware-type.md'),
		});
	});

	it('renders parameter tables with escaped markdown pipes but plain type unions', () => {
		const runCommandPage = pages.find((page) => page.id === '@kjanat/dreamcli/testkit:runCommand');
		const runOptionsPage = pages.find((page) => page.id === '@kjanat/dreamcli/testkit:RunOptions');
		const cliRunOptionsPage = pages.find((page) => page.id === '@kjanat/dreamcli:CLIRunOptions');
		const runtimeAdapterPage = pages.find(
			(page) => page.id === '@kjanat/dreamcli/runtime:RuntimeAdapter',
		);
		const middlewareFactoryPage = pages.find((page) => page.id === '@kjanat/dreamcli:middleware');

		expect(runCommandPage?.content).toContain('| Parameter | Type | Description |');
		expect(runCommandPage?.content).toContain('| `options` | `RunCommandOptions \\| undefined` |');
		expect(runCommandPage?.content).not.toContain(
			'| `options` | `RunCommandOptions \\\\| undefined` |',
		);
		expect(runOptionsPage?.content).toContain('stdinData?: string | null;');
		expect(cliRunOptionsPage?.content).toContain('stdinData?: string | null;');
		expect(runtimeAdapterPage?.content).toContain('Promise<string | null>');
		expect(runOptionsPage?.content).not.toContain('"null"');
		expect(cliRunOptionsPage?.content).not.toContain('"null"');
		expect(runtimeAdapterPage?.content).not.toContain('"null"');
		expect(middlewareFactoryPage?.content).toContain('{ args, flags, ctx, out, meta, next }');
	});

	it('preserves the two required inputs in constraint method rest tuples', () => {
		const content = pages.find(({ id }) => id === '@kjanat/dreamcli:ConstraintBuilder')?.content;
		for (const method of ['exactlyOne', 'atMostOne', 'allOrNone']) {
			expect(content).toContain(
				`${method}(...inputs: [InputName<F, A>, InputName<F, A>, ...InputName<F, A>[]]): CommandConstraint;`,
			);
		}
	});

	it('links JSDoc references to public symbols across package entrypoints', () => {
		const page = (id: string) => pages.find((entry) => entry.id === id)?.content;
		expect(page('@kjanat/dreamcli:ConfigSettings')).toContain(
			'](/reference/symbols/config/discoverConfig)',
		);
		expect(page('@kjanat/dreamcli:ResolvedManifestSettings')).toContain(
			'](/reference/symbols/config/discoverManifest)',
		);
		expect(page('@kjanat/dreamcli:CLIBuilder')).toContain(
			'](/reference/symbols/config/inferCliName)',
		);
		expect(page('@kjanat/dreamcli:RunResult')).toContain(
			'](/reference/symbols/testkit/runCommand)',
		);
		expect(page('@kjanat/dreamcli:CommandDefinitionDocumentV1')).toContain(
			'](/reference/symbols/json-schema/generateCommandSchema)',
		);
		expect(page('@kjanat/dreamcli:DefinitionDocumentV1')).toContain(
			'](/reference/symbols/json-schema/generateSchema)',
		);
	});

	it('normalizes multiline table cells without double escaping', () => {
		const parameter = createNode({
			name: 'options',
			kind: 'parameter',
			comment: createComment('first | summary\r\nsecond line'),
			type: {
				kind: 'union',
				types: [createIntrinsicType('string'), createIntrinsicType('number')],
			},
		});
		const signature = createNode({
			name: 'multilineTable',
			kind: 'callSignature',
			parameters: [parameter],
			type: createIntrinsicType('void'),
		});
		const model: NormalizedApiModel = {
			schemaVersion: '1',
			collectorVersion: 2,
			packageName: '@kjanat/dreamcli',
			entrypoints: [],
			exports: [
				{
					id: '@kjanat/dreamcli:multilineTable',
					name: 'multilineTable',
					entrypoint: '@kjanat/dreamcli',
					subpath: '.',
					publicKind: 'function',
					sourcePath: 'src/index.ts',
					reflection: createNode({
						name: 'multilineTable',
						kind: 'function',
						signatures: [signature],
					}),
				},
			],
		};

		const [page] = collectSymbolPages(model, symbolPagesRoot, []);

		expect(page?.content).toContain(
			'| `options` | `string \\| number` | first \\| summary<br>second line |',
		);
		expect(page?.content).not.toContain('first \\\\| summary');
		expect(page?.content).not.toContain('summary<br><br>second line');
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
