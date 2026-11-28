/** @module */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vitepress';
import { expect, it } from 'vitest';
import { buildDocs } from '../../scripts/build.ts';
import { createBuildAnalyzer } from '../vite-plugins/twoslash-analysis.ts';
import { twoslashBuildCleanup } from '../vite-plugins/twoslash-build-cleanup.ts';
import { twoslashPayloads } from '../vite-plugins/twoslash-payloads.ts';
import { rootDirPath } from './paths.ts';

it('recovers from a failed VitePress build in the same process', async () => {
	const fixture = await mkdtemp(join(rootDirPath, 'node_modules/.docs-build-'));
	const analyzer = createBuildAnalyzer(rootDirPath);
	const popups = twoslashPayloads();
	const markdown = {
		shikiSetup: popups.shikiSetup,
		codeTransformers: [popups.twoslash({ typesCache: analyzer.typesCache }), popups.transformer],
	};
	let fail = true;
	const failure: Plugin = {
		name: 'fail-after-render',
		generateBundle() {
			if (fail) throw new Error('injected build failure');
		},
	};
	const run = () =>
		buildDocs(fixture, {
			onAfterConfigResolve(config) {
				config.markdown = markdown;
				config.vite = {
					plugins: [
						analyzer.plugin,
						popups.plugin,
						twoslashBuildCleanup(analyzer, popups),
						failure,
					],
				};
			},
		});
	try {
		await writeFile(
			join(fixture, 'unchanged.md'),
			'# Stable\n\n~~~ts twoslash\nconst stableValue = 1;\n~~~\n',
		);
		await writeFile(
			join(fixture, 'index.md'),
			'# Test\n\n~~~ts twoslash\nconst oldValue = 42;\n~~~\n',
		);
		await expect(run()).rejects.toThrow(/injected build failure/);
		expect(analyzer.typesCache.read('const probe = 1')).toBeNull();
		fail = false;
		await writeFile(
			join(fixture, 'index.md'),
			'# Test\n\n~~~ts twoslash\nconst newValue = "ok";\n~~~\n',
		);
		await run();
		const dir = join(fixture, '.vitepress/dist/assets/twoslash');
		const bodies = await Promise.all(
			(await readdir(dir)).map((name) => readFile(join(dir, name), 'utf8')),
		);
		expect(bodies.join('')).toContain('newValue');
		expect(bodies.join('')).toContain('stableValue');
		expect(bodies.join('')).not.toContain('oldValue');
		expect(analyzer.typesCache.read('const probe = 1')).toBeNull();
	} finally {
		await rm(fixture, { recursive: true, force: true });
	}
}, 30000);
