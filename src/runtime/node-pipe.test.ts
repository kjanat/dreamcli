/**
 * Node adapter output through a real pipe, in a child process of the running runtime.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const PAYLOAD_BYTES = 1_000_000;
const nodeAdapterUrl = new URL('./node.ts', import.meta.url).href;

interface ChildResult {
	readonly code: number | null;
	readonly stdoutBytes: number;
	readonly stderr: string;
}

/** Run a script that writes the payload through the Node adapter, flushes, and exits. */
function runChild(exitCode: number, closeReader: boolean): Promise<ChildResult> {
	const script = [
		`import { createNodeAdapter } from ${JSON.stringify(nodeAdapterUrl)};`,
		'const adapter = createNodeAdapter();',
		`adapter.stdout('x'.repeat(${PAYLOAD_BYTES}));`,
		'await adapter.flush?.();',
		`adapter.exit(${exitCode});`,
	].join('\n');
	const args =
		process.versions.bun === undefined ? ['--input-type=module', '-e', script] : ['-e', script];

	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdoutBytes = 0;
		let stderr = '';
		if (closeReader) child.stdout.destroy();
		child.stdout.on('data', (chunk: Uint8Array) => {
			stdoutBytes += chunk.byteLength;
		});
		child.stderr.on('data', (chunk: Uint8Array) => {
			stderr += new TextDecoder().decode(chunk);
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, stdoutBytes, stderr }));
	});
}

describe.skipIf('Deno' in globalThis)('createNodeAdapter through a pipe', () => {
	it('delivers every byte before exiting', async () => {
		const result = await runChild(0, false);

		expect(result).toEqual({ code: 0, stdoutBytes: PAYLOAD_BYTES, stderr: '' });
	});

	it('exits with the requested code when the reader is gone', async () => {
		const result = await runChild(3, true);

		expect(result.code).toBe(3);
		expect(result.stderr).toBe('');
	});
});
