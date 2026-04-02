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

import type { WriteFn } from '#internals/core/output/index.ts';
import type { ReadFn } from '#internals/core/prompt/index.ts';
import type { RuntimeAdapter } from './adapter.ts';
import { resolveConfigDirectory, resolveHomeDirectory } from './paths.ts';
import { assertRuntimeVersionSupported } from './support.ts';

// --- Node.js error shape — for ENOENT detection without @types/node

/**
 * Minimal shape for Node.js system errors (e.g. `ENOENT`, `EACCES`).
 *
 * Used to detect file-not-found when reading config files.
 * Only the `code` property is needed; other fields are ignored.
 *
 * @internal
 */
interface NodeSystemError {
	readonly code: string;
}

// --- Minimal process shape — avoids @types/node dependency

/**
 * Minimal subset of the Node.js `process` object needed by the adapter.
 *
 * We avoid importing `@types/node` to keep the core runtime-agnostic
 * at the type level. This interface declares only what `createNodeAdapter`
 * actually reads from the global.
 */
interface NodeProcess {
	readonly argv: readonly string[];
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly versions?: {
		readonly node?: string;
		readonly bun?: string;
	};
	cwd(): string;
	/** Platform identifier (e.g. `'linux'`, `'darwin'`, `'win32'`). */
	readonly platform: string;
	readonly stdin: {
		readonly isTTY?: boolean;
		/** Async iterable for reading all of stdin (used by readStdin). */
		[Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
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

// --- Process access — isolated for testability

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

// --- Filesystem & path helpers — config discovery primitives

/**
 * Detect whether an unknown thrown value is a Node.js system error
 * with a string `code` property (e.g. `'ENOENT'`, `'EACCES'`).
 *
 * @internal
 */
function isNodeSystemError(err: unknown): err is NodeSystemError {
	if (typeof err !== 'object' || err === null || !('code' in err)) return false;
	// After the `in` check, TS narrows err to `object & Record<'code', unknown>`.
	const candidate: { code: unknown } = err;
	return typeof candidate.code === 'string';
}

/**
 * Resolve the user's home directory from environment variables.
 *
 * **Windows** (`win32`): `USERPROFILE` → `HOMEDRIVE`+`HOMEPATH` (both required) → `HOME` → `C:\`
 * **Unix**: `HOME` → `/`
 *
 * `HOMEPATH` alone is never used — it is a relative fragment (e.g. `\Users\alice`) that only
 * makes sense when combined with `HOMEDRIVE` (e.g. `C:`). Using `HOMEPATH` without `HOMEDRIVE`
 * could resolve against the working drive, producing an incorrect path.
 *
 * We avoid importing `node:os` to keep the factory synchronous and
 * to maintain the pattern of deriving everything from the process object.
 *
 * @internal
 */
function resolveHomedir(
	env: Readonly<Record<string, string | undefined>>,
	platform: string,
): string {
	return resolveHomeDirectory(env, platform === 'win32');
}

/**
 * Resolve the platform-specific user configuration directory.
 *
 * - Unix: `$XDG_CONFIG_HOME` (if set), otherwise `~/.config`
 * - Windows: `%APPDATA%` (if set), otherwise `~\AppData\Roaming`
 *
 * @internal
 */
function resolveConfigDir(
	env: Readonly<Record<string, string | undefined>>,
	platform: string,
	homedir: string,
): string {
	return resolveConfigDirectory(env, platform === 'win32', homedir);
}

function assertProcessRuntimeSupported(proc: NodeProcess): void {
	if (proc.versions?.bun !== undefined) {
		assertRuntimeVersionSupported('bun', proc.versions.bun);
		return;
	}

	assertRuntimeVersionSupported('node', proc.versions?.node);
}

// --- Node adapter factory

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
	assertProcessRuntimeSupported(p);

	const stdoutWrite: WriteFn = (data) => {
		p.stdout.write(data);
	};
	const stderrWrite: WriteFn = (data) => {
		p.stderr.write(data);
	};

	// Stdin line reading via readline — created lazily on first call.
	// This avoids importing readline unless prompting actually occurs.
	const stdinRead: ReadFn = () => createNodeReadLine(p);

	// --- Filesystem primitives for config discovery ---

	const readFile = async (path: string): Promise<string | null> => {
		const fs = await import('node:fs/promises');
		try {
			return await fs.readFile(path, 'utf8');
		} catch (err: unknown) {
			// ENOENT = file not found → null (expected for config discovery probing)
			if (isNodeSystemError(err) && err.code === 'ENOENT') {
				return null;
			}
			throw err; // Permission denied, is-directory, etc. → caller handles
		}
	};

	const homedir = resolveHomedir(p.env, p.platform);
	const configDir = resolveConfigDir(p.env, p.platform, homedir);

	const stdinIsTTY = p.stdin.isTTY === true;

	return {
		argv: p.argv,
		env: p.env,
		cwd: p.cwd(),
		stdout: stdoutWrite,
		stderr: stderrWrite,
		stdin: stdinRead,
		readStdin: () => readNodeStdinAll(p, stdinIsTTY),
		isTTY: p.stdout.isTTY === true,
		stdinIsTTY,
		exit: (code) => p.exit(code),
		readFile,
		homedir,
		configDir,
	};
}

/**
 * Read all of stdin as a single string (for piped data).
 *
 * Returns `null` immediately if stdin is a TTY — the user is typing
 * interactively, so there's no piped data to consume. When stdin is
 * piped, collects all chunks via the async iterator until EOF and
 * returns the decoded string, which may be empty for an empty pipe.
 *
 * @internal
 */
async function readNodeStdinAll(proc: NodeProcess, stdinIsTTY: boolean): Promise<string | null> {
	if (stdinIsTTY) return null;

	const chunks: string[] = [];
	const decoder = new TextDecoder();

	for await (const chunk of proc.stdin) {
		chunks.push(decoder.decode(chunk, { stream: true }));
	}
	// Flush any remaining bytes held by the streaming decoder
	chunks.push(decoder.decode());

	return chunks.join('');
}

/**
 * Read a single line from Node's stdin via its async iterator.
 *
 * Iterates stdin chunks manually (without `for-await` to avoid calling
 * `iterator.return()` which would close the stream). Returns `null`
 * on EOF.
 *
 * @internal
 */
async function createNodeReadLine(proc: NodeProcess): Promise<string | null> {
	const iter = proc.stdin[Symbol.asyncIterator]();
	const decoder = new TextDecoder();
	let buffer = '';
	let result = await iter.next();

	while (!result.done) {
		buffer += decoder.decode(result.value, { stream: true });
		const nlIndex = buffer.indexOf('\n');
		if (nlIndex !== -1) {
			return buffer.slice(0, nlIndex).replace(/\r$/, '');
		}
		result = await iter.next();
	}

	// Flush remaining bytes after stream end
	buffer += decoder.decode();
	return buffer.length > 0 ? buffer : null;
}

// --- Exports

export type { NodeProcess };
export { createNodeAdapter };
