/**
 * Node.js runtime adapter implementation.
 *
 * Bridges the platform-agnostic `RuntimeAdapter` interface to Node.js's
 * `globalThis.process` object. This adapter is also compatible with Bun,
 * which provides a Node-compatible `process` global.
 *
 * The adapter reads process state once at creation time and exposes it
 * through the immutable `RuntimeAdapter` interface. I/O writers wrap
 * `process.stdout.write` and `process.stderr.write`.
 *
 * @module dreamcli/runtime/node
 */

import type { WriteFn } from '../core/output/index.js';
import type { ReadFn } from '../core/prompt/index.js';
import type { RuntimeAdapter } from './adapter.js';

// ---------------------------------------------------------------------------
// Minimal process shape — avoids @types/node dependency
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the Node.js `process` object needed by the adapter.
 *
 * We avoid importing `@types/node` to keep the core runtime-agnostic
 * at the type level. This interface declares only what `createNodeAdapter`
 * actually reads from the global.
 *
 * @internal
 */
interface NodeProcess {
	readonly argv: readonly string[];
	readonly env: Readonly<Record<string, string | undefined>>;
	cwd(): string;
	readonly stdin: {
		readonly isTTY?: boolean;
	};
	readonly stdout: {
		readonly isTTY?: boolean;
		write(data: string): unknown;
	};
	readonly stderr: {
		write(data: string): unknown;
	};
	exit(code: number): never;
}

// ---------------------------------------------------------------------------
// Process access — isolated for testability
// ---------------------------------------------------------------------------

/**
 * Access the global `process` object without importing `@types/node`.
 *
 * Cast through `unknown` to avoid TypeScript errors when `@types/node`
 * isn't installed. Safe because this adapter is only used on Node/Bun
 * where `globalThis.process` is always defined.
 *
 * @internal
 */
function getNodeProcess(): NodeProcess {
	return (globalThis as unknown as { process: NodeProcess }).process;
}

// ---------------------------------------------------------------------------
// Node adapter factory
// ---------------------------------------------------------------------------

/**
 * Create a runtime adapter backed by Node.js `process` globals.
 *
 * Reads `process.argv`, `process.env`, `process.cwd()`, and wraps
 * `process.stdout.write`/`process.stderr.write` as `WriteFn` functions.
 *
 * Also works on Bun, which provides a Node-compatible `process` global.
 *
 * @param proc - Override the process object (useful for testing the adapter itself).
 * @returns A `RuntimeAdapter` backed by Node.js process state.
 *
 * @example
 * ```ts
 * import { cli } from 'dreamcli';
 * import { createNodeAdapter } from 'dreamcli/runtime/node';
 *
 * cli('mycli')
 *   .command(deploy)
 *   .run({ adapter: createNodeAdapter() });
 * ```
 */
function createNodeAdapter(proc?: NodeProcess): RuntimeAdapter {
	const p = proc ?? getNodeProcess();

	const stdoutWrite: WriteFn = (data) => {
		p.stdout.write(data);
	};
	const stderrWrite: WriteFn = (data) => {
		p.stderr.write(data);
	};

	// Stdin line reading via readline — created lazily on first call.
	// This avoids importing readline unless prompting actually occurs.
	const stdinRead: ReadFn = () => createNodeReadLine(p);

	return {
		argv: p.argv,
		env: p.env,
		cwd: p.cwd(),
		stdout: stdoutWrite,
		stderr: stderrWrite,
		stdin: stdinRead,
		isTTY: p.stdout.isTTY === true,
		stdinIsTTY: p.stdin.isTTY === true,
		exit: (code) => p.exit(code),
	};
}

/**
 * Read a single line from Node's stdin using the readline module.
 *
 * Creates a one-shot readline interface for each call, reads one line,
 * then closes it. Returns `null` on EOF.
 *
 * This is intentionally simple (no raw mode) — the terminal prompter
 * handles retries and validation. The readline interface is created
 * per-call to avoid holding stdin open between prompts.
 *
 * @internal
 */
async function createNodeReadLine(proc: NodeProcess): Promise<string | null> {
	// Dynamic import avoids pulling readline into environments that don't need it.
	// Node and Bun both provide 'readline' — Deno has its own adapter.
	const rlMod = await import('node:readline');

	return new Promise<string | null>((resolve) => {
		const rl = rlMod.createInterface({
			input: proc.stdin,
			terminal: false,
		});

		let answered = false;

		rl.once('line', (line: string) => {
			answered = true;
			rl.close();
			resolve(line);
		});

		rl.once('close', () => {
			if (!answered) {
				resolve(null); // EOF
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { createNodeAdapter };
export type { NodeProcess };
