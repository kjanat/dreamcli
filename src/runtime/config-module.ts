/** Native executable config imports for Node, Bun, and Deno. @module */

/** @internal */
export async function importConfigModule(path: string): Promise<unknown> {
	const { pathToFileURL } = await import('node:url');
	const module: { default?: unknown } = await import(/* @vite-ignore */ pathToFileURL(path).href);
	return module.default;
}

// A self-contained module also works when the consuming CLI is bundled into one file.
const workerSource = `
import { parentPort, workerData } from 'node:worker_threads';
try {
	const { default: config } = await import(workerData);
	if (config === null || typeof config !== 'object' ||
		![Object.prototype, null].includes(Object.getPrototypeOf(config))) {
		throw new TypeError('Config loader must return a plain object');
	}
	parentPort.postMessage({ ok: true, config });
} catch (error) {
	parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
}
`;

/** @internal Import an independent module graph; discard it even if the config left active timers. */
export async function importFreshConfigModule(path: string): Promise<unknown> {
	const { Worker } = await import('node:worker_threads');
	const { pathToFileURL } = await import('node:url');
	const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`), {
		workerData: pathToFileURL(path).href,
	});
	try {
		return await new Promise<unknown>((resolve, reject) => {
			worker.once(
				'message',
				(reply: { ok: true; config: unknown } | { ok: false; message: string }) => {
					if (reply.ok) resolve(reply.config);
					else reject(new Error(reply.message));
				},
			);
			worker.once('messageerror', reject);
			worker.once('error', reject);
			worker.once('exit', (code) =>
				reject(new Error(`Config worker exited before returning its export (code ${code})`)),
			);
		});
	} finally {
		await worker.terminate();
	}
}
