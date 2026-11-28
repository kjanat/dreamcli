/** Run VitePress with cleanup covering configuration, bundling, and rendering failures. @module */
import { build } from 'vitepress';
import type { twoslashBuildCleanup } from '../.vitepress/vite-plugins/twoslash-build-cleanup.ts';
import { cleanupPluginName } from '../.vitepress/vite-plugins/twoslash-build-cleanup.ts';

export async function buildDocs(
	root: string,
	options: NonNullable<Parameters<typeof build>[1]> = {},
) {
	let cleanup: ReturnType<typeof twoslashBuildCleanup>['api'] | undefined;
	try {
		await build(root, {
			...options,
			async onAfterConfigResolve(config) {
				await options.onAfterConfigResolve?.(config);
				const plugin = config.vite?.plugins?.find(
					(p): p is ReturnType<typeof twoslashBuildCleanup> =>
						!!p && typeof p === 'object' && 'name' in p && p.name === cleanupPluginName,
				);
				if (!plugin) throw new Error('Missing Twoslash cleanup plugin in the docs config');
				cleanup = plugin.api;
			},
		});
	} catch (error) {
		try {
			cleanup?.finish(false);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Docs build and Twoslash cleanup failed', {
				cause: error,
			});
		}
		throw error;
	}
	cleanup?.finish(true);
}

if (import.meta.main) await buildDocs('.');
