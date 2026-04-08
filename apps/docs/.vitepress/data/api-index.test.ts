/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import { collectPublicApiIndex } from './api-index.ts';
import { packageJsonPath } from './paths.ts';

describe('api-index', () => {
	it('collects every public entrypoint with grouped symbols', async () => {
		const entrypoints = await collectPublicApiIndex(packageJsonPath);

		expect(entrypoints.map((entrypoint) => entrypoint.entrypoint)).toEqual([
			'@kjanat/dreamcli',
			'@kjanat/dreamcli/runtime',
			'@kjanat/dreamcli/schema',
			'@kjanat/dreamcli/testkit',
		]);

		const root = entrypoints.find((entrypoint) => entrypoint.entrypoint === '@kjanat/dreamcli');
		expect(root?.sourcePath).toBe('src/index.ts');
		expect(root?.kindGroups.find((group) => group.kind === 'class')?.symbols).toContainEqual({
			name: 'CLIBuilder',
			kind: 'class',
			sourcePath: 'src/core/cli/index.ts',
		});
		expect(root?.kindGroups.find((group) => group.kind === 'function')?.symbols).toContainEqual({
			name: 'cli',
			kind: 'function',
			sourcePath: 'src/core/cli/index.ts',
		});
		expect(root?.kindGroups.find((group) => group.kind === 'interface')?.symbols).toContainEqual({
			name: 'CLIOptions',
			kind: 'interface',
			sourcePath: 'src/core/cli/index.ts',
		});

		const runtime = entrypoints.find(
			(entrypoint) => entrypoint.entrypoint === '@kjanat/dreamcli/runtime',
		);
		expect(runtime?.sourcePath).toBe('src/runtime.ts');
		expect(runtime?.kindGroups.find((group) => group.kind === 'interface')?.symbols).toContainEqual(
			{
				name: 'RuntimeAdapter',
				kind: 'interface',
				sourcePath: 'src/runtime/adapter.ts',
			},
		);

		const schema = entrypoints.find(
			(entrypoint) => entrypoint.entrypoint === '@kjanat/dreamcli/schema',
		);
		expect(schema?.kindGroups).toEqual([
			{
				kind: 'asset',
				title: 'Assets',
				symbols: [{ name: 'schema', kind: 'asset', sourcePath: 'dreamcli.schema.json' }],
			},
		]);

		const testkit = entrypoints.find(
			(entrypoint) => entrypoint.entrypoint === '@kjanat/dreamcli/testkit',
		);
		expect(testkit?.sourcePath).toBe('src/testkit.ts');
		expect(testkit?.kindGroups.find((group) => group.kind === 'function')?.symbols).toContainEqual({
			name: 'runCommand',
			kind: 'function',
			sourcePath: 'src/core/testkit/index.ts',
		});
	});
});
