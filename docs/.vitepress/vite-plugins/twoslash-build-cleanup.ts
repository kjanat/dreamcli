/** Expose the build's disposer to the outer VitePress invocation. @module */
import type { Plugin } from 'vitepress';
import { disposeMdItInstance } from 'vitepress';
import type { createBuildAnalyzer } from './twoslash-analysis.ts';
import type { twoslashPayloads } from './twoslash-payloads.ts';

export const cleanupPluginName = 'dreamcli-twoslash-cleanup';

export function twoslashBuildCleanup(
	analyzer: ReturnType<typeof createBuildAnalyzer>,
	popups: ReturnType<typeof twoslashPayloads>,
) {
	let active = false;
	function finish(success: boolean) {
		if (!active) return;
		active = false;
		let save = false;
		try {
			analyzer.finish();
			save = success;
		} finally {
			try {
				popups.finish(save);
			} finally {
				disposeMdItInstance();
			}
		}
	}
	return {
		name: cleanupPluginName,
		apply: 'build',
		configResolved() {
			active = true;
		},
		api: { finish },
		closeBundle(error) {
			if (error) finish(false);
		},
	} satisfies Plugin;
}
