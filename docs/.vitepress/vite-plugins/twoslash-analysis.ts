/** Analyze each expanded TypeScript fence once per production build. @module */
import { join } from 'node:path';
import { createSyncFn } from 'synckit';
import type { TwoslashGenericResult } from 'twoslash-protocol';
import type { Plugin } from 'vitepress';
import type { checkSnippet } from '../../scripts/tsrs-worker.ts';

export function createBuildAnalyzer(root: string) {
	const results = new Map<string, TwoslashGenericResult>();
	let check: ReturnType<typeof createSyncFn<typeof checkSnippet>> | undefined;
	let building = false;
	let nativeCount = 0;
	return {
		plugin: {
			name: 'dreamcli-twoslash-analysis',
			apply: 'build',
			configResolved() {
				building = true;
			},
		} satisfies Plugin,
		finish() {
			check?.(root, null);
			console.log(
				`Twoslash: ${nativeCount} snippets analyzed by tsrs, ${results.size - nativeCount} by TypeScript.`,
			);
			check = undefined;
			results.clear();
			building = false;
			nativeCount = 0;
		},
		typesCache: {
			read(code: string, lang = 'ts') {
				if (!building) return null;
				const key = `${lang}\0${code}`;
				const cached = results.get(key);
				if (cached) return cached;
				// Delegate inline compiler options, multi-file examples and completion assertions
				// to Twoslash, which defines their semantics. Shiki has already expanded includes.
				if (lang !== 'ts' || /^\s*\/\/\s*@|^\s*\/\/\s*\^\|/m.test(code)) return null;
				check ??= createSyncFn<typeof checkSnippet>(join(root, 'docs/scripts/tsrs-worker.ts'), {
					timeout: 60_000,
				});
				const result = check(root, code);
				if (result) {
					results.set(key, result);
					nativeCount++;
				}
				return result;
			},
			write(code: string, result: TwoslashGenericResult, lang = 'ts') {
				if (building) results.set(`${lang}\0${code}`, result);
			},
		},
	};
}
