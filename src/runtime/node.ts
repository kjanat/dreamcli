/**
 * Node.js runtime adapter implementation.
 *
 * Bridges the platform-agnostic {@linkcode RuntimeAdapter} interface to Node.js's
 * `globalThis.process` object. This adapter is also compatible with Bun,
 * which provides a Node-compatible `process` global.
 *
 * The adapter reads process state once at creation time and exposes it
 * through the immutable {@linkcode RuntimeAdapter} interface. I/O writers wrap
 * `process.stdout.write` and `process.stderr.write`.
 *
 * @module @kjanat/dreamcli/runtime/node
 */

import type { WriteFn } from '#internals/core/output/index.ts';
import type { ReadFn } from '#internals/core/prompt/index.ts';
import type { RuntimeAdapter, TerminalSize } from './adapter.ts';
import { resolveConfigDirectory, resolveHomeDirectory } from './paths.ts';

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
	/** Raw process arguments (`[binary, script, ...userArgs]`). */
	readonly argv: readonly string[];
	/** Environment variables (values are `undefined` for unset keys). */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Runtime version strings — used for version-guard checks. */
	readonly versions?: {
		readonly node?: string;
		readonly bun?: string;
	};
	/** Return the current working directory. */
	cwd(): string;
	/** Platform identifier (e.g. `'linux'`, `'darwin'`, `'win32'`). */
	readonly platform: string;
	/** Standard input stream with TTY detection and async iteration. */
	readonly stdin: {
		readonly isTTY?: boolean;
		/** Async iterable for reading all of stdin (used by readStdin). */
		[Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
	};
	/** Standard output stream with TTY detection and write. */
	readonly stdout: {
		readonly isTTY?: boolean;
		readonly columns?: number;
		readonly rows?: number;
		getWindowSize?(): readonly [number, number];
		on?(event: 'resize', listener: () => void): unknown;
		off?(event: 'resize', listener: () => void): unknown;
		removeListener?(event: 'resize', listener: () => void): unknown;
		write(data: string): unknown;
	};
	/** Standard error stream with write. */
	readonly stderr: {
		write(data: string): unknown;
	};
	/** Terminate the process with the given exit code. */
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

// --- Node adapter factory

/**
 * Create a runtime adapter backed by Node.js `process` globals.
 *
 * Reads `process.argv`, `process.env`, `process.cwd()`, and wraps
 * `process.stdout.write`/`process.stderr.write` as {@linkcode WriteFn} functions.
 *
 * Also works on Bun, which provides a Node-compatible `process` global.
 *
 * @param proc - Override the process object (useful for testing the adapter itself).
 * @returns A {@linkcode RuntimeAdapter} backed by Node.js process state.
 *
 * @example
 * ```ts
 * import { cli } from '@kjanat/dreamcli';
 * import { createNodeAdapter } from '@kjanat/dreamcli/runtime/node';
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
	const stdinRead = createNodeReadLine(p);

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

	const stat = async (path: string): Promise<'file' | 'directory' | null> => {
		const fs = await import('node:fs/promises');
		try {
			const info = await fs.stat(path);
			return info.isDirectory() ? 'directory' : 'file';
		} catch (err: unknown) {
			// ENOENT/ENOTDIR = nothing at this path → null (expected for path checks)
			if (isNodeSystemError(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
				return null;
			}
			throw err; // Permission denied, etc. → caller handles
		}
	};

	const mkdir = async (path: string): Promise<void> => {
		const fs = await import('node:fs/promises');
		await fs.mkdir(path, { recursive: true });
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
		getTerminalSize: () => readNodeTerminalSize(p),
		onTerminalResize: (listener) => onNodeTerminalResize(p, listener),
		exit: (code) => p.exit(code),
		readFile,
		stat,
		mkdir,
		homedir,
		configDir,
	};
}

/** Normalize terminal dimensions and discard unusable values. @internal */
function normalizeTerminalSize(
	columns: number | undefined,
	rows: number | undefined,
): TerminalSize | undefined {
	if (columns === undefined || rows === undefined) return undefined;
	if (!Number.isFinite(columns) || !Number.isFinite(rows)) return undefined;
	if (columns <= 0 || rows <= 0) return undefined;
	return { columns, rows };
}

/** Read Node/Bun terminal dimensions from stdout. @internal */
function readNodeTerminalSize(proc: NodeProcess): TerminalSize | undefined {
	if (proc.stdout.isTTY !== true) return undefined;

	try {
		const size = proc.stdout.getWindowSize?.();
		if (size !== undefined) {
			const [columns, rows] = size;
			const normalized = normalizeTerminalSize(columns, rows);
			if (normalized !== undefined) return normalized;
		}
	} catch {
		// Fall through to columns/rows below.
	}

	return normalizeTerminalSize(proc.stdout.columns, proc.stdout.rows);
}

/** Subscribe to Node/Bun stdout resize events when available. @internal */
function onNodeTerminalResize(proc: NodeProcess, listener: () => void): (() => void) | undefined {
	if (proc.stdout.isTTY !== true || proc.stdout.on === undefined) return undefined;

	if (proc.stdout.off !== undefined) {
		proc.stdout.on('resize', listener);
		return () => {
			proc.stdout.off?.('resize', listener);
		};
	}

	if (proc.stdout.removeListener !== undefined) {
		proc.stdout.on('resize', listener);
		return () => {
			proc.stdout.removeListener?.('resize', listener);
		};
	}

	return undefined;
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
function createNodeReadLine(proc: NodeProcess): ReadFn {
	const iter = proc.stdin[Symbol.asyncIterator]();
	const decoder = new TextDecoder();
	let buffer = '';
	let done = false;

	return async (): Promise<string | null> => {
		for (;;) {
			const nlIndex = buffer.indexOf('\n');
			if (nlIndex !== -1) {
				const line = buffer.slice(0, nlIndex).replace(/\r$/, '');
				buffer = buffer.slice(nlIndex + 1);
				return line;
			}

			if (done) {
				if (buffer.length === 0) return null;
				const line = buffer;
				buffer = '';
				return line;
			}

			const result = await iter.next();
			if (result.done) {
				buffer += decoder.decode();
				done = true;
				continue;
			}

			buffer += decoder.decode(result.value, { stream: true });
		}
	};
}

// --- Exports

export type { NodeProcess };
export { createNodeAdapter };
