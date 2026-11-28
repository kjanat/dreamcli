/** @module */
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { ownTsrsProcess } from '../../scripts/tsrs-process.ts';

// A version-manager shim may forward to Node in a separate process.
const node = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();

it('can close a server that has already exited', async () => {
	const child = spawn(node, ['-e', '']);
	const close = ownTsrsProcess(child, async () => {
		throw new Error('unexpected shutdown');
	});
	await once(child, 'close');
	await close();
	await close();
});

it('reaps a server that ignores shutdown and termination', async () => {
	const child = spawn(node, [
		'-e',
		"process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
	]);
	const close = ownTsrsProcess(child, () => new Promise<void>(() => {}), 100);
	try {
		await once(child.stdout, 'data');
		expect(close()).toBe(close());
		await expect(close()).rejects.toThrow(/tsrs exited with/);
		expect(child.signalCode).toBe(process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL');
	} finally {
		child.kill('SIGKILL');
	}
});
