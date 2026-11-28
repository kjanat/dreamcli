/** Shut down the language server and wait until its stdio has closed. @module */
import type { ChildProcess } from 'node:child_process';

export function ownTsrsProcess(child: ChildProcess, shutdown: () => Promise<void>, graceMs = 2000) {
	let closed = false;
	const stopped = new Promise<void>((resolve) => {
		child.once('close', () => {
			closed = true;
			resolve();
		});
	});
	let closing: Promise<void> | undefined;
	function checkExit() {
		if (child.exitCode !== 0)
			throw new Error(`tsrs exited with ${child.signalCode ?? child.exitCode}`);
	}
	async function close() {
		if (closed) return checkExit();
		const terminate = setTimeout(() => child.kill('SIGTERM'), graceMs);
		const kill = setTimeout(() => child.kill('SIGKILL'), graceMs * 2);
		try {
			if (child.exitCode === null && child.signalCode === null) {
				await Promise.race([stopped, shutdown()]);
			}
		} finally {
			try {
				await stopped;
			} finally {
				clearTimeout(terminate);
				clearTimeout(kill);
			}
		}
		checkExit();
	}
	return () => (closing ??= close());
}
