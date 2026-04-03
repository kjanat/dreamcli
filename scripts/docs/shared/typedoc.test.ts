/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import { collectPublicApiIndex } from './api-index.ts';
import { packageJsonPath } from './paths.ts';
import { collectTypeDocModel } from './typedoc.ts';

describe('typedoc normalization', () => {
	it('normalizes public entrypoints into a DreamCLI-owned docs model', {
		timeout: 20_000,
	}, async () => {
		const publicApi = await collectPublicApiIndex(packageJsonPath);
		const { normalized, rawProject } = await collectTypeDocModel(packageJsonPath, publicApi);

		expect(rawProject.schemaVersion).toBe(normalized.typedocSchemaVersion);
		expect(normalized.entrypoints).toEqual([
			{
				entrypoint: '@kjanat/dreamcli',
				subpath: '.',
				sourcePath: 'src/index.ts',
				hasTypeDoc: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli:CLIBuilder', '@kjanat/dreamcli:cli']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/runtime',
				subpath: './runtime',
				sourcePath: 'src/runtime.ts',
				hasTypeDoc: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/runtime:RuntimeAdapter']),
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/schema',
				subpath: './schema',
				sourcePath: 'dreamcli.schema.json',
				hasTypeDoc: false,
				exportIds: [],
				missingExports: [],
			},
			{
				entrypoint: '@kjanat/dreamcli/testkit',
				subpath: './testkit',
				sourcePath: 'src/testkit.ts',
				hasTypeDoc: true,
				exportIds: expect.arrayContaining(['@kjanat/dreamcli/testkit:runCommand']),
				missingExports: [],
			},
		]);
	});

	it('preserves symbol docs, overloads, and nested property types without leaking raw TypeDoc shape', {
		timeout: 20_000,
	}, async () => {
		const publicApi = await collectPublicApiIndex(packageJsonPath);
		const { normalized } = await collectTypeDocModel(packageJsonPath, publicApi);

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
			childNames: expect.arrayContaining(['name', 'version']),
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
	});
});
