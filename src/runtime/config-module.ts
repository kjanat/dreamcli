/** Native executable config imports for Node, Bun, and Deno. @module */

/** @internal */
export async function importConfigModule(path: string): Promise<unknown> {
	const { pathToFileURL } = await import('node:url');
	const module: { default?: unknown } = await import(/* @vite-ignore */ pathToFileURL(path).href);
	return module.default;
}
