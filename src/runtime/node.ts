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
// Node.js error shape — for ENOENT detection without @types/node
// ---------------------------------------------------------------------------

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
	/** Platform identifier (e.g. `'linux'`, `'darwin'`, `'win32'`). */
	readonly platform: string;
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
// Filesystem & path helpers — config discovery primitives
// ---------------------------------------------------------------------------

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
	if (platform === 'win32') {
		if (env.USERPROFILE) return env.USERPROFILE;
		if (env.HOMEDRIVE && env.HOMEPATH) {
			return env.HOMEDRIVE + env.HOMEPATH;
		}
		return env.HOME || 'C:\\';
	}
	return env.HOME || '/';
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
	if (platform === 'win32') {
		return env.APPDATA || `${homedir}\\AppData\\Roaming`;
	}
	return env.XDG_CONFIG_HOME || `${homedir}/.config`;
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
		readFile,
		homedir,
		configDir,
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
