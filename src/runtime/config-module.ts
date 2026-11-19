/** Native executable config imports for Node, Bun, and Deno. @module */

import type { WorkerOptions } from 'node:worker_threads';
import { detectRuntime } from './detect.ts';

/** @internal */
export async function importConfigModule(path: string): Promise<unknown> {
	const { pathToFileURL } = await import('node:url');
	const module: { default?: unknown } = await import(/* @vite-ignore */ pathToFileURL(path).href);
	return module.default;
}

// A self-contained module also works when the consuming CLI is bundled into one file.
const workerSource = `
import { parentPort, workerData } from 'node:worker_threads';
const replyPort = await new Promise(resolve => parentPort.once('message', resolve));
try {
	const { default: config } = await import(workerData);
	if (config === null || typeof config !== 'object' ||
		![Object.prototype, null].includes(Object.getPrototypeOf(config))) {
		throw new TypeError('Config loader must return a plain object');
	}
	replyPort.postMessage({ ok: true, config });
} catch (error) {
	replyPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
} finally {
	replyPort.close();
}
`;

/** @internal Import an independent module graph; discard it even if the config left active timers. */
export async function importFreshConfigModule(path: string, timeoutMs = 30_000): Promise<unknown> {
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
		throw new RangeError('Config worker timeoutMs must be an integer between 1 and 2147483647');
	}
	const threads = await import('node:worker_threads');
	const { pathToFileURL } = await import('node:url');
	const options: WorkerOptions = { workerData: pathToFileURL(path).href };
	// Deno's default worker environment snapshots every variable and can prompt before import.
	if (detectRuntime() === 'deno') options.env = threads.SHARE_ENV;
	const worker = new threads.Worker(
		new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`),
		options,
	);
	const { port1, port2 } = new threads.MessageChannel();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<unknown>((resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error(`Config worker timed out after ${timeoutMs} ms`)),
				timeoutMs,
			);
			port1.once('message', (reply: unknown) => {
				if (reply && typeof reply === 'object' && 'ok' in reply) {
					if (reply.ok === true && 'config' in reply) return resolve(reply.config);
					if (reply.ok === false && 'message' in reply && typeof reply.message === 'string') {
						return reject(new Error(reply.message));
					}
				}
				reject(new Error('Invalid reply from config worker'));
			});
			port1.once('messageerror', reject);
			worker.once('error', reject);
			worker.once('exit', (code) =>
				reject(new Error(`Config worker exited before returning its export (code ${code})`)),
			);
			worker.postMessage(port2, [port2]);
		});
	} finally {
		clearTimeout(timer);
		port1.close();
		port2.close();
		await worker.terminate();
	}
}
