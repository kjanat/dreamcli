/**
 * One resolution, driven through every host adapter.
 *
 * The adapter supplies argv, the environment, and the stdin buffer, so the same
 * invocation must produce the same values and the same provenance on Node, Bun,
 * and Deno.
 *
 * @module dreamcli/runtime/adapter-resolution.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { ResolutionProvenance } from '#internals/core/schema/provenance.ts';
import type { RuntimeAdapter } from './adapter.ts';
import { ExitError } from './adapter.ts';
import { createAdapter } from './auto.ts';
import type { DenoNamespace } from './deno.ts';
import { createDenoAdapter } from './deno.ts';
import type { NodeProcess } from './node.ts';
import { createNodeAdapter } from './node.ts';

// === adapters over injected host state

/** What every adapter under test is handed. */
interface HostState {
	/** User arguments, without the binary and script entries. */
	readonly args: readonly string[];
	/** Environment variables the adapter reports. */
	readonly env: Readonly<Record<string, string>>;
	/** Bytes a pipe delivers, or `undefined` for a TTY with nothing piped. */
	readonly stdin: string | undefined;
}

/** A Node process stub whose stdin yields the piped bytes in two chunks. */
function nodeProcess(state: HostState, stdout: (text: string) => void): NodeProcess {
	const encoder = new TextEncoder();
	const piped = state.stdin;
	return {
		argv: ['node', 'cli.js', ...state.args],
		env: state.env,
		versions: { node: '22.22.2' },
		cwd: () => '/',
		platform: 'linux',
		stdin: {
			isTTY: piped === undefined,
			async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
				if (piped === undefined) return;
				const split = Math.ceil(piped.length / 2);
				yield encoder.encode(piped.slice(0, split));
				yield encoder.encode(piped.slice(split));
			},
		},
		stdout: {
			write: (data: string) => {
				stdout(data);
				return true;
			},
		},
		stderr: { write: () => true },
		exit: (code: number): never => {
			throw new ExitError(code);
		},
	};
}

/** A Deno namespace stub with the same host state behind Deno's stream APIs. */
function denoNamespace(state: HostState, stdout: (text: string) => void): DenoNamespace {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const piped = state.stdin;
	let delivered = false;

	return {
		build: { os: 'linux' },
		args: [...state.args],
		env: {
			get: (key: string) => state.env[key],
			toObject: () => ({ ...state.env }),
		},
		cwd: () => '/',
		stdout: {
			writeSync: (data: Uint8Array) => {
				stdout(decoder.decode(data));
				return data.length;
			},
			isTerminal: () => false,
		},
		stderr: { writeSync: (data: Uint8Array) => data.length },
		stdin: {
			isTerminal: () => piped === undefined,
			readable: {
				getReader: () => ({
					read: () => {
						if (piped === undefined || delivered) {
							return Promise.resolve({ done: true, value: new Uint8Array(0) });
						}
						delivered = true;
						return Promise.resolve({ done: false, value: encoder.encode(piped) });
					},
					releaseLock: () => {},
				}),
			} as ReadableStream<Uint8Array>,
		},
		exit: (code: number): never => {
			throw new ExitError(code);
		},
		readTextFile: () => Promise.reject(Object.assign(new Error('not found'), { name: 'NotFound' })),
		stat: () => Promise.reject(Object.assign(new Error('not found'), { name: 'NotFound' })),
		mkdir: () => Promise.resolve(),
		version: { deno: '2.6.0' },
	};
}

/** Build the adapter each host produces for the same state. */
const HOSTS: ReadonlyArray<
	readonly [string, (state: HostState, stdout: (text: string) => void) => RuntimeAdapter]
> = [
	['node', (state, stdout) => createNodeAdapter(nodeProcess(state, stdout))],
	[
		'bun',
		(state, stdout) => {
			// Bun exposes a Node-compatible `process`, so `createAdapter` builds the
			// Node adapter from the global rather than from an argument.
			vi.stubGlobal('process', nodeProcess(state, stdout));
			return createAdapter({ Bun: { version: '1.3.12' }, process: { versions: { node: '22' } } });
		},
	],
	['deno', (state, stdout) => createDenoAdapter(denoNamespace(state, stdout))],
];

// === the command every host runs

/** What one invocation produced, as the action saw it. */
interface Observed {
	readonly body: string | undefined;
	readonly region: string | undefined;
	readonly target: string | undefined;
	readonly bodySource: ResolutionProvenance | undefined;
	readonly regionSource: ResolutionProvenance | undefined;
	readonly targetSource: ResolutionProvenance | undefined;
}

/** Run one invocation through the adapter a host produced. */
async function runThrough(
	adapter: RuntimeAdapter,
): Promise<{ readonly observed: Observed | undefined; readonly exitCode: number }> {
	let observed: Observed | undefined;
	const send = command('send')
		.flag('region', flag.string().env('REGION').default('us'))
		.arg('target', arg.string().optional())
		.flag('body', flag.string().stdin())
		.action(({ flags, args, sources }) => {
			observed = {
				body: flags.body,
				region: flags.region,
				target: args.target,
				bodySource: sources.flags.body,
				regionSource: sources.flags.region,
				targetSource: sources.args.target,
			};
		});

	let exitCode = 0;
	try {
		await cli('mycli').command(send).run({ adapter });
	} catch (error) {
		if (!(error instanceof ExitError)) throw error;
		exitCode = error.code;
	}
	return { observed, exitCode };
}

describe('every host adapter drives the same resolution', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	for (const [host, build] of HOSTS) {
		it(`reads argv, env, and the pipe on ${host}`, async () => {
			const { observed, exitCode } = await runThrough(
				build({ args: ['send', 'prod'], env: { REGION: 'eu' }, stdin: 'piped body\n' }, () => {}),
			);

			expect(exitCode).toBe(0);
			expect(observed).toEqual({
				body: 'piped body\n',
				region: 'eu',
				target: 'prod',
				bodySource: { stage: 'stdin', via: 'stdin', trigger: 'fallback' },
				regionSource: { stage: 'env', envVar: 'REGION' },
				targetSource: { stage: 'cli' },
			});
		});

		it(`keeps a typed value ahead of the pipe on ${host}`, async () => {
			const { observed } = await runThrough(
				build({ args: ['send', '--body', 'typed'], env: {}, stdin: 'piped body\n' }, () => {}),
			);

			expect(observed?.body).toBe('typed');
			expect(observed?.bodySource).toEqual({ stage: 'cli' });
			expect(observed?.regionSource).toEqual({ stage: 'default' });
		});

		it(`reads the pipe for an explicit dash on ${host}`, async () => {
			const { observed } = await runThrough(
				build({ args: ['send', '--body', '-'], env: {}, stdin: 'dashed\n' }, () => {}),
			);

			expect(observed?.body).toBe('dashed\n');
			expect(observed?.bodySource).toEqual({ stage: 'cli', via: 'stdin', trigger: 'dash' });
		});

		it(`falls back to the default with nothing piped on ${host}`, async () => {
			const { observed } = await runThrough(
				build({ args: ['send'], env: {}, stdin: undefined }, () => {}),
			);

			expect(observed?.body).toBeUndefined();
			expect(observed?.bodySource).toBeUndefined();
			expect(observed?.region).toBe('us');
			expect(observed?.regionSource).toEqual({ stage: 'default' });
		});
	}
});
