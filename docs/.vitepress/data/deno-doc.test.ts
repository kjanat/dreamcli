/**
 * @module
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectPublicApiIndex } from './api-index.ts';
import { collectDenoDocModel } from './deno-doc.ts';
import { createDenoDocFixture } from './deno-doc-fixture.ts';
import { collectSymbolPages } from './symbol-pages.ts';

const collectModel = createDenoDocFixture();

describe('deno doc normalization', () => {
	it('renders resolved declarations and preserves the boundary between prose and examples', {
		timeout: 60_000,
	}, async () => {
		const root = await mkdtemp(join(tmpdir(), 'dreamcli-doc-test-'));
		const manifest = join(root, 'package.json');
		const templateDeclaration = `type EnvKey = \`APP_\${string}_\${number}\`;`;
		try {
			await mkdir(join(root, 'src'));
			await Promise.all([
				writeFile(
					manifest,
					JSON.stringify({
						name: '@kjanat/dreamcli',
						exports: {
							'.': './src/main.ts',
							'./first': './src/first.ts',
							'./second': './src/second.ts',
						},
					}),
				),
				writeFile(join(root, 'src/first.ts'), 'export interface Options { wrong: string; }\n'),
				writeFile(join(root, 'src/second.ts'), 'export interface Options { right: string; }\n'),
				writeFile(
					join(root, 'src/main.ts'),
					[
						"import type { Options } from './second.ts';",
						'export type SelectedOptions = Options;',
						`export ${templateDeclaration}`,
						'export interface Base<T> {',
						'  /** Inherited documentation. */',
						"  'x-mode': T;",
						'  method(value: T): T;',
						'  local: T;',
						'  /** @internal */',
						'  internal: T;',
						'}',
						"export interface Derived extends Base<string> { local: 'override'; }",
						"export interface Mapped extends Omit<Derived, 'local'> {}",
						'/**',
						' * See {@link EnvKey | key \\}}.',
						' * @param value - See {@link EnvKey|the key} and A | B.',
						' * @example',
						' * ```ts',
						' * const example = "{@link EnvKey}";',
						' * ```',
						' */',
						'export function use(value: string): string { return value; }',
					].join('\n'),
				),
			]);
			const inventory = await collectPublicApiIndex(manifest);
			const model = await collectDenoDocModel(manifest, inventory);
			const pages = collectSymbolPages(model, root, []);
			const page = (id: string) =>
				pages.find((entry) => entry.id === `@kjanat/dreamcli${id}`)?.content;

			expect(page('/first:Options')).toContain('src/first.ts:1`]');
			expect(page('/first:Options')).toContain('src/first.ts#L1)');
			expect(page(':SelectedOptions')).toContain('right: string;');
			expect(page(':SelectedOptions')).not.toContain('wrong: string;');
			expect(page(':EnvKey')).toContain(templateDeclaration);
			expect(page(':Derived')).toContain('"x-mode": string;');
			expect(page(':Derived')).toContain('Inherited documentation.');
			expect(page(':Derived')).toContain('method(value: string): string;');
			expect(page(':Derived')).toContain('local: "override";');
			expect(page(':Derived')).not.toContain('internal:');
			expect(page(':Mapped')).toContain('"x-mode": string;');
			expect(page(':Mapped')).not.toContain('internal:');
			expect(page(':use')).toContain('[key }](/reference/symbols/main/EnvKey)');
			expect(page(':use')).toContain('[the key](/reference/symbols/main/EnvKey) and A \\| B.');
			expect(page(':use')).toContain('const example = "{@link EnvKey}";');
		} finally {
			await rm(root, { recursive: true });
		}
	});

	it('normalizes public entrypoints into a DreamCLI-owned docs model', {
		timeout: 60_000,
	}, async () => {
		const normalized = await collectModel();

		expect(normalized.collectorVersion).toBe(2);
		expect(normalized.entrypoints).toEqual([
			{
				entrypoint: '@kjanat/dreamcli',
				subpath: '.',
				sourcePath: 'src/index.ts',
				hasDocumentation: true,
				exportIds: expect.arrayContaining([
					'@kjanat/dreamcli:CLIBuilder',
					'@kjanat/dreamcli:cli',
					'@kjanat/dreamcli:isMainModule',
				]),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/completion',
				subpath: './completion',
				sourcePath: 'src/completion.ts',
				hasDocumentation: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/completion:generateCompletion']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/config',
				subpath: './config',
				sourcePath: 'src/config.ts',
				hasDocumentation: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/config:discoverConfig']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/json-schema',
				subpath: './json-schema',
				sourcePath: 'src/json-schema.ts',
				hasDocumentation: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/json-schema:generateSchema']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/prompt',
				subpath: './prompt',
				sourcePath: 'src/prompt.ts',
				hasDocumentation: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/prompt:createTerminalPrompter']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/runtime',
				subpath: './runtime',
				sourcePath: 'src/runtime.ts',
				hasDocumentation: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/runtime:RuntimeAdapter']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/schema',
				subpath: './schema',
				sourcePath: 'dreamcli.schema.json',
				hasDocumentation: false,
				exportIds: [],
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/testkit',
				subpath: './testkit',
				sourcePath: 'src/testkit.ts',
				hasDocumentation: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/testkit:runCommand']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/version',
				subpath: './version',
				sourcePath: 'src/version.ts',
				hasDocumentation: true,
				exportIds: [
					'@kjanat/dreamcli/version:DREAMCLI_REVISION',
					'@kjanat/dreamcli/version:DREAMCLI_VERSION',
				],
				missingExports: [],
			},
		]);
	});

	it('preserves symbol docs, overloads, and nested property types without leaking raw Deno shape', {
		timeout: 60_000,
	}, async () => {
		const normalized = await collectModel();

		const cliExport = normalized.exports.find((entry) => entry.id === '@kjanat/dreamcli:cli');
		expect(cliExport?.reflection.kind).toBe('function');
		expect(cliExport?.reflection.signatures).toHaveLength(2);
		expect(cliExport?.reflection.signatures[0]?.comment?.blockTags).toContainEqual({
			tag: '@example',
			name: null,
			content: expect.stringContaining("cli('mycli')"),
		});
		expect(cliExport?.reflection.signatures[0]?.parameters[0]?.name).toBe('name');
		expect(cliExport?.reflection.signatures[0]?.type).toEqual({
			kind: 'reference',
			name: 'CLIBuilder',
			target: expect.any(String),
			packageName: '@kjanat/dreamcli',
			qualifiedName: null,
			externalUrl: null,
			refersToTypeParameter: false,
			typeArguments: [],
		});

		const schemaExport = normalized.exports.find(
			(entry) => entry.id === '@kjanat/dreamcli:CLISchema',
		);
		expect(schemaExport?.reflection.kind).toBe('interface');
		expect(schemaExport?.reflection.comment?.summary).toContain(
			'Runtime descriptor for the CLI program.',
		);
		expect(schemaExport?.reflection.groups).toContainEqual({
			title: 'Properties',
			children: expect.arrayContaining([
				expect.objectContaining({ name: 'name' }),
				expect.objectContaining({ name: 'version' }),
			]),
		});

		const configSettings = schemaExport?.reflection.children.find(
			(child) => child.name === 'configSettings',
		);
		expect(configSettings?.comment?.summary).toContain('Config discovery settings.');
		expect(configSettings?.type).toEqual({
			kind: 'union',
			types: [
				{
					kind: 'reference',
					name: 'ConfigSettings',
					target: expect.any(String),
					packageName: '@kjanat/dreamcli',
					qualifiedName: null,
					externalUrl: null,
					refersToTypeParameter: false,
					typeArguments: [],
				},
				{ kind: 'intrinsic', name: 'undefined' },
			],
		});

		const runOptionsExport = normalized.exports.find(
			(entry) => entry.id === '@kjanat/dreamcli/testkit:RunOptions',
		);
		expect(runOptionsExport?.reflection.kind).toBe('interface');
		const stdinData =
			runOptionsExport?.reflection.kind === 'interface'
				? runOptionsExport.reflection.children.find((child) => child.name === 'stdinData')
				: undefined;
		expect(stdinData?.type).toEqual({
			kind: 'union',
			types: [
				{ kind: 'intrinsic', name: 'string' },
				{ kind: 'literal', value: null },
			],
		});

		const runtimeAdapterExport = normalized.exports.find(
			(entry) => entry.id === '@kjanat/dreamcli/runtime:RuntimeAdapter',
		);
		expect(runtimeAdapterExport?.reflection.kind).toBe('interface');
		const readFile =
			runtimeAdapterExport?.reflection.kind === 'interface'
				? runtimeAdapterExport.reflection.children.find((child) => child.name === 'readFile')
				: undefined;
		const readFileCallSignature =
			readFile?.type !== null && readFile?.type.kind === 'reflection'
				? readFile.type.declaration.signatures[0]
				: undefined;
		expect(readFileCallSignature?.type).toEqual({
			kind: 'reference',
			name: 'Promise',
			target: null,
			packageName: null,
			qualifiedName: null,
			externalUrl: null,
			refersToTypeParameter: false,
			typeArguments: [
				{
					kind: 'union',
					types: [
						{ kind: 'intrinsic', name: 'string' },
						{ kind: 'literal', value: null },
					],
				},
			],
		});
	});
});
