/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import { collectPublicApiIndex, renderPublicApiIndex } from './api-index.ts';
import { packageJsonPath } from './paths.ts';

describe('api-index', () => {
	it('collects every public entrypoint with grouped symbols', async () => {
		const entrypoints = await collectPublicApiIndex(packageJsonPath);

		expect(entrypoints.map((entrypoint) => entrypoint.entrypoint)).toEqual([
			'dreamcli',
			'dreamcli/runtime',
			'dreamcli/schema',
			'dreamcli/testkit',
		]);

		const root = entrypoints.find((entrypoint) => entrypoint.entrypoint === 'dreamcli');
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

		const runtime = entrypoints.find((entrypoint) => entrypoint.entrypoint === 'dreamcli/runtime');
		expect(runtime?.sourcePath).toBe('src/runtime.ts');
		expect(runtime?.kindGroups.find((group) => group.kind === 'interface')?.symbols).toContainEqual(
			{
				name: 'RuntimeAdapter',
				kind: 'interface',
				sourcePath: 'src/runtime/adapter.ts',
			},
		);

		const schema = entrypoints.find((entrypoint) => entrypoint.entrypoint === 'dreamcli/schema');
		expect(schema?.kindGroups).toEqual([
			{
				kind: 'asset',
				title: 'Assets',
				symbols: [{ name: 'schema', kind: 'asset', sourcePath: 'dreamcli.schema.json' }],
			},
		]);

		const testkit = entrypoints.find((entrypoint) => entrypoint.entrypoint === 'dreamcli/testkit');
		expect(testkit?.sourcePath).toBe('src/testkit.ts');
		expect(testkit?.kindGroups.find((group) => group.kind === 'function')?.symbols).toContainEqual({
			name: 'runCommand',
			kind: 'function',
			sourcePath: 'src/core/testkit/index.ts',
		});
	});

	it('renders a markdown inventory page', async () => {
		const entrypoints = await collectPublicApiIndex(packageJsonPath);
		const markdown = renderPublicApiIndex(entrypoints);

		expect(markdown).toContain('# Generated API Index');
		expect(markdown).toContain('## `dreamcli`');
		expect(markdown).toContain('### Functions');
		expect(markdown).toContain(
			'| [`cli`](/reference/symbols/main/cli) | `src/core/cli/index.ts` |',
		);
		expect(markdown).toContain(
			'| [`Middleware`](/reference/symbols/main/middleware-type) | `src/core/schema/middleware.ts` |',
		);
		expect(markdown).toContain(
			'| [`RuntimeAdapter`](/reference/symbols/runtime/RuntimeAdapter) | `src/runtime/adapter.ts` |',
		);
		expect(markdown).toContain('| `schema` | `dreamcli.schema.json` |');
	});
});
