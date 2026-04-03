/**
 * Deno runtime adapter implementation.
 *
 * Bridges the platform-agnostic `RuntimeAdapter` interface to Deno's
 * namespace APIs (`Deno.args`, `Deno.env`, `Deno.cwd()`, etc.).
 *
 * Deno requires explicit permissions for some operations. The adapter
 * handles missing permissions gracefully:
 *
 * - **`--allow-env`**: needed for `Deno.env.toObject()`. Without it,
 *   the adapter falls back to an empty env (flags using env sources
 *   simply won't resolve from env).
 * - **`--allow-read`**: needed for `Deno.readTextFile()`. Without it,
 *   `readFile` returns `null` (same as file-not-found).
 *
 * No permissions are needed for `Deno.args`, `Deno.stdout`, `Deno.stderr`,
 * `Deno.stdin`, `Deno.exit()`, or TTY detection.
 *
 * @module @kjanat/dreamcli/runtime/deno
 */

import type { WriteFn } from '#internals/core/output/index.ts';
import type { ReadFn } from '#internals/core/prompt/index.ts';
import type { RuntimeAdapter } from './adapter.ts';
import { resolveConfigDirectory, resolveHomeDirectory } from './paths.ts';
import { assertRuntimeVersionSupported } from './support.ts';

// --- Minimal Deno namespace shape — avoids @types/deno dependency

/**
 * Minimal subset of the Deno namespace needed by the adapter.
 *
 * We avoid `@types/deno` to keep the core runtime-agnostic at the type level.
 * This interface declares only what `createDenoAdapter` actually reads.
 *
 * The `env` property is optional because it requires `--allow-env` permission.
 * When permission is denied, the adapter catches the error and falls back to
 * an empty env object.
 */
interface DenoNamespace {
	readonly build: {
		readonly os:
			| 'darwin'
			| 'linux'
			| 'android'
			| 'windows'
			| 'freebsd'
			| 'netbsd'
			| 'aix'
			| 'solaris'
			| 'illumos';
	};
	readonly version?: {
		readonly deno?: string;
	};
	/** Raw command-line args (excludes the binary/script — Deno pre-strips them). */
	readonly args: readonly string[];

	/** Environment variable access (requires `--allow-env`). */
	readonly env: {
		/** Get a single env var. Returns `undefined` if unset or permission denied. */
		get(key: string): string | undefined;
		/** Get all env vars as a plain object. Throws on permission denied. */
		toObject(): Record<string, string>;
	};

	/** Current working directory (may throw if `--allow-read` is denied for cwd). */
	cwd(): string;

	readonly stdout: {
		/** Write raw bytes to stdout synchronously. */
		writeSync(p: Uint8Array): number;
		/** Whether stdout is connected to a TTY. */
		isTerminal(): boolean;
	};

	readonly stderr: {
		/** Write raw bytes to stderr synchronously. */
		writeSync(p: Uint8Array): number;
	};

	readonly stdin: {
		/** Whether stdin is connected to a TTY. */
		isTerminal(): boolean;
		/** Readable stream for stdin bytes. */
		readonly readable: ReadableStream<Uint8Array>;
	};

	/** Exit the process with the given code. */
	exit(code: number): never;

	/** Read a file as UTF-8 text (requires `--allow-read`). */
	readTextFile(path: string): Promise<string>;
}

// --- Permission-safe helpers

/**
 * Detect whether an unknown thrown value is a Deno error by name.
 *
 * @internal
 */
function isDenoErrorNamed(err: unknown, name: string): boolean {
	if (typeof err !== 'object' || err === null || !('name' in err)) return false;
	// After the `in` check, TS narrows err to `object & Record<'name', unknown>`.
	const candidate: { name: unknown } = err;
	return typeof candidate.name === 'string' && candidate.name === name;
}

/**
 * Safely read all environment variables. Returns empty object if
 * `--allow-env` permission is not granted.
 *
 * @internal
 */
function safeEnvToObject(deno: DenoNamespace): Readonly<Record<string, string | undefined>> {
	try {
		return deno.env.toObject();
	} catch (err: unknown) {
		if (isDenoErrorNamed(err, 'PermissionDenied')) return {};
		throw err;
	}
}

/**
 * Safely get the current working directory. Returns `/` if the cwd is
 * inaccessible due to missing permissions.
 *
 * @internal
 */
function safeCwd(deno: DenoNamespace): string {
	try {
		return deno.cwd();
	} catch (err: unknown) {
		if (isDenoErrorNamed(err, 'PermissionDenied')) return '/';
		throw err;
	}
}

// --- Deno adapter factory

/**
 * Create a runtime adapter backed by the Deno namespace.
 *
 * Reads `Deno.args`, `Deno.env`, `Deno.cwd()`, and wraps Deno's stream-based
 * I/O into the `WriteFn`/`ReadFn` functions expected by the framework.
 *
 * Unlike Node/Bun, Deno strips the binary and script path from `Deno.args`.
 * The adapter prepends synthetic entries (`['deno', 'run']`) so the argv
 * shape matches the `RuntimeAdapter` contract (binary + script + user args).
 *
 * @param ns - Override the Deno namespace (useful for testing the adapter itself).
 * @returns A `RuntimeAdapter` backed by Deno's namespace APIs.
 *
 * @example
 * ```ts
 * import { cli } from '@kjanat/dreamcli';
 * import { createDenoAdapter } from '@kjanat/dreamcli/runtime';
 *
 * cli('mycli')
 *   .command(deploy)
 *   .run({ adapter: createDenoAdapter() });
 * ```
 */
function createDenoAdapter(ns?: DenoNamespace): RuntimeAdapter {
	const d = ns ?? getDenoNamespace();
	assertRuntimeVersionSupported('deno', d.version?.deno);
	const encoder = new TextEncoder();

	// --- Synthetic argv: Deno.args has user args only (no binary/script) ---
	const argv: readonly string[] = ['deno', 'run', ...d.args];

	// --- Environment (permission-safe) ---
	const env = safeEnvToObject(d);

	// --- CWD (permission-safe) ---
	const cwd = safeCwd(d);

	// --- I/O writers ---
	const stdoutWrite: WriteFn = (data) => {
		d.stdout.writeSync(encoder.encode(data));
	};
	const stderrWrite: WriteFn = (data) => {
		d.stderr.writeSync(encoder.encode(data));
	};

	// --- Stdin line reading ---
	const stdinRead: ReadFn = () => readDenoStdinLine(d);

	// --- Filesystem ---
	const readFile = async (path: string): Promise<string | null> => {
		try {
			return await d.readTextFile(path);
		} catch (err: unknown) {
			// NotFound = file doesn't exist → null (expected for config probing)
			if (isDenoErrorNamed(err, 'NotFound')) return null;
			// PermissionDenied = --allow-read not granted → treat as not found
			// (config discovery is opt-in; failing silently is the graceful path)
			if (isDenoErrorNamed(err, 'PermissionDenied')) return null;
			throw err; // Other I/O errors propagate
		}
	};

	// --- Home directory ---
	const homedir = resolveDenoHomedir(env, d.build.os === 'windows');

	// --- Config directory ---
	const configDir = resolveDenoConfigDir(env, homedir, d.build.os === 'windows');

	const stdinIsTTY = d.stdin.isTerminal();

	return {
		argv,
		env,
		cwd,
		stdout: stdoutWrite,
		stderr: stderrWrite,
		stdin: stdinRead,
		readStdin: () => readDenoStdinAll(d, stdinIsTTY),
		isTTY: d.stdout.isTerminal(),
		stdinIsTTY,
		exit: (code) => d.exit(code),
		readFile,
		homedir,
		configDir,
	};
}

// --- Deno namespace access — isolated for testability

/**
 * Access the global `Deno` namespace.
 *
 * Cast through `unknown` to avoid TypeScript errors when Deno types
 * aren't installed. Safe because this adapter is only used on Deno
 * where `globalThis.Deno` is always defined.
 *
 * @internal
 */
function getDenoNamespace(): DenoNamespace {
	return (globalThis as unknown as { Deno: DenoNamespace }).Deno;
}

// --- Stdin reading — line (prompts) and full (piped data)

/**
 * Read all of stdin as a single string (for piped data).
 *
 * Returns `null` immediately if stdin is a TTY — the user is typing
 * interactively, so there's no piped data to consume. When stdin is
 * piped, collects all chunks via the `ReadableStream` until EOF and
 * returns the decoded string, which may be empty for an empty pipe.
 *
 * @internal
 */
async function readDenoStdinAll(deno: DenoNamespace, stdinIsTTY: boolean): Promise<string | null> {
	if (stdinIsTTY) return null;

	const reader = deno.stdin.readable.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];

	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) {
				// Flush any trailing bytes held by the streaming decoder
				chunks.push(decoder.decode());
				break;
			}
			chunks.push(decoder.decode(value, { stream: true }));
		}
	} finally {
		reader.releaseLock();
	}

	return chunks.join('');
}

/**
 * Read a single line from Deno's stdin.
 *
 * Uses the `ReadableStream` API with a manual buffer to read until
 * a newline character is found. Returns `null` on EOF.
 *
 * This is intentionally simple — the terminal prompter handles retries
 * and validation.
 *
 * @internal
 */
async function readDenoStdinLine(deno: DenoNamespace): Promise<string | null> {
	const reader = deno.stdin.readable.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) {
				// Flush any trailing bytes held by the streaming decoder
				// (partial multibyte UTF-8 sequences buffered internally).
				buffer += decoder.decode();
				return buffer.length > 0 ? buffer : null;
			}
			buffer += decoder.decode(value, { stream: true });
			const newlineIndex = buffer.indexOf('\n');
			if (newlineIndex !== -1) {
				// Return the line without the newline character.
				// Remaining data after the newline is lost — this is acceptable
				// because each prompt reads one line at a time.
				return buffer.slice(0, newlineIndex).replace(/\r$/, '');
			}
		}
	} finally {
		reader.releaseLock();
	}
}

// --- Home / config directory resolution

/**
 * Resolve the user's home directory from environment variables.
 *
 * Deno doesn't expose `os.homedir()` without `--allow-sys`, so we derive
 * it from env vars — same approach as the Node adapter.
 *
 * @internal
 */
function resolveDenoHomedir(
	env: Readonly<Record<string, string | undefined>>,
	isWindows: boolean,
): string {
	return resolveHomeDirectory(env, isWindows);
}

/**
 * Resolve the platform-specific user configuration directory.
 *
 * Uses `Deno.build.os` for platform detection, then applies the same fallback
 * chain as the Node adapter.
 *
 * @internal
 */
function resolveDenoConfigDir(
	env: Readonly<Record<string, string | undefined>>,
	homedir: string,
	isWindows: boolean,
): string {
	return resolveConfigDirectory(env, isWindows, homedir);
}

// --- Exports

export type { DenoNamespace };
export { createDenoAdapter };
