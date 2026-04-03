/**
 * Runtime adapter interface. Core never imports runtime-specific modules directly;
 * all platform-dependent behavior flows through this contract.
 *
 * The adapter abstracts the minimal set of platform-dependent operations:
 * argv/env access, I/O streams, TTY detection, working directory, and
 * process exit. Concrete implementations exist for Node, Bun, and Deno.
 *
 * @module @kjanat/dreamcli/runtime/adapter
 */

import type { WriteFn } from '#internals/core/output/index.ts';
import type { ReadFn } from '#internals/core/prompt/index.ts';

// --- Runtime adapter interface — the single platform abstraction boundary

/**
 * Runtime adapter interface.
 *
 * Defines the minimal contract between the platform-agnostic core and
 * the host runtime (Node.js, Bun, Deno). Every platform-dependent
 * operation flows through this interface — the core never calls
 * `process.*`, `Deno.*`, or `Bun.*` directly.
 *
 * Adapters are designed to be:
 * - **Immutable in shape:** all properties are readonly
 * - **Minimal:** only the operations the framework actually needs
 * - **Testable:** easily stubbed in tests via `createTestAdapter()`
 *
 * @example
 * ```ts
 * // Production: auto-detected
 * cli('mycli').run(); // uses Node/Bun/Deno adapter
 *
 * // Test: explicit adapter
 * cli('mycli').run({ adapter: createTestAdapter({ argv: ['deploy'] }) });
 * ```
 */
interface RuntimeAdapter {
	/** Raw argv array (including binary + script path, e.g. `['node', 'cli.js', 'deploy']`). */
	readonly argv: readonly string[];

	/**
	 * Environment variables.
	 * Values are `string | undefined` — mirrors Node's `process.env` semantics.
	 */
	readonly env: Readonly<Record<string, string | undefined>>;

	/** Current working directory (absolute path). */
	readonly cwd: string;

	/** Writer for stdout. Framework routes `out.log`/`out.info` through this. */
	readonly stdout: WriteFn;

	/** Writer for stderr. Framework routes `out.warn`/`out.error` through this. */
	readonly stderr: WriteFn;

	/**
	 * Line reader for stdin. Used by the prompt engine for interactive input.
	 *
	 * Returns `null` on EOF (Ctrl+D on Unix, Ctrl+Z on Windows),
	 * indicating the user closed the input stream (treated as cancel).
	 */
	readonly stdin: ReadFn;

	/**
	 * Read all of stdin as a single string (for piped data).
	 *
	 * Returns the full stdin contents when data is piped (`stdinIsTTY` is
	 * false), or `null` when stdin is a TTY (no piped data available).
	 *
	 * Used by the resolve chain for args with `.stdin()` configured.
	 * Unlike {@link stdin} (which reads one line for prompts), this
	 * consumes the entire stream to EOF.
	 *
	 * @returns Full stdin contents as a string, or `null` if stdin is a TTY.
	 */
	readonly readStdin: () => Promise<string | null>;

	/** Whether stdout is connected to a TTY. */
	readonly isTTY: boolean;

	/** Whether stdin is connected to a TTY (used for prompt gating). */
	readonly stdinIsTTY: boolean;

	/**
	 * Exit the process with the given code.
	 * Must not return (divergent function).
	 */
	readonly exit: (code: number) => never;

	// --- Filesystem primitives (config file discovery) ---

	/**
	 * Read a file as UTF-8 text.
	 *
	 * Returns file contents on success, `null` if the file does not exist
	 * (ENOENT/NotFound). Throws on other I/O errors (permission denied,
	 * is-directory, etc.) — those indicate unexpected failures, not
	 * "try the next path".
	 *
	 * Used by config file discovery to probe multiple candidate paths.
	 */
	readonly readFile: (path: string) => Promise<string | null>;

	/**
	 * User home directory (absolute path).
	 *
	 * - Node/Bun: derived from `HOME` / `USERPROFILE` env
	 * - Deno: `Deno.env.get('HOME')` / `Deno.env.get('USERPROFILE')`
	 */
	readonly homedir: string;

	/**
	 * Platform-specific user configuration directory (absolute path).
	 *
	 * - Unix: `$XDG_CONFIG_HOME` or `~/.config`
	 * - Windows: `%APPDATA%` or `~\AppData\Roaming`
	 *
	 * Config discovery appends the app-specific subdirectory.
	 */
	readonly configDir: string;
}

// --- Test adapter — injectable stub for testing

/**
 * Options for creating a test adapter.
 *
 * All fields are optional — sensible defaults are applied for testing
 * scenarios (empty argv, empty env, noop stdout/stderr, non-TTY, exit
 * throws instead of killing the process).
 */
interface TestAdapterOptions {
	/** Raw argv (defaults to `['node', 'test']`). */
	readonly argv?: readonly string[];

	/** Environment variables (defaults to `{}`). */
	readonly env?: Readonly<Record<string, string | undefined>>;

	/** Working directory (defaults to `'/test'`). */
	readonly cwd?: string;

	/** Stdout writer (defaults to noop). */
	readonly stdout?: WriteFn;

	/** Stderr writer (defaults to noop). */
	readonly stderr?: WriteFn;

	/**
	 * Stdin line reader (defaults to returning `null` — immediate EOF).
	 *
	 * Use a custom `ReadFn` to simulate user input in tests.
	 */
	readonly stdin?: ReadFn;

	/**
	 * Piped stdin data for testing args with `.stdin()` configured.
	 *
	 * When provided and `stdinIsTTY` is `false`, `readStdin()` returns this
	 * string once, then `null` on subsequent reads. When absent, or when
	 * `stdinIsTTY` is `true`, `readStdin()` returns `null`.
	 *
	 * @example
	 * ```ts
	 * createTestAdapter({
	 *   stdinData: '{"key": "value"}',
	 * })
	 * ```
	 */
	readonly stdinData?: string;

	/** TTY flag for stdout (defaults to `false`). */
	readonly isTTY?: boolean;

	/** TTY flag for stdin (defaults to `false`). */
	readonly stdinIsTTY?: boolean;

	/**
	 * Exit function (defaults to throwing `ExitError`).
	 * The default throw-based exit allows tests to catch the exit code.
	 */
	readonly exit?: (code: number) => never;

	// --- Filesystem stubs ---

	/**
	 * File reader stub (defaults to returning `null` — all files not found).
	 *
	 * Supply a custom function to simulate a virtual filesystem in tests:
	 * ```ts
	 * createTestAdapter({
	 *   readFile: (path) => Promise.resolve(
	 *     path === '/home/test/.config/myapp/config.json'
	 *       ? '{"region":"eu"}'
	 *       : null
	 *   ),
	 * })
	 * ```
	 */
	readonly readFile?: (path: string) => Promise<string | null>;

	/** Home directory (defaults to `'/home/test'`). */
	readonly homedir?: string;

	/** Config directory (defaults to `'/home/test/.config'`). */
	readonly configDir?: string;
}

/**
 * Error thrown by the default test adapter exit function.
 *
 * In tests, `process.exit` would kill the test runner. Instead, the test
 * adapter throws this error, allowing tests to assert on exit codes:
 *
 * ```ts
 * try {
 *   await cli.run({ adapter: createTestAdapter() });
 * } catch (e) {
 *   if (e instanceof ExitError) expect(e.code).toBe(0);
 * }
 * ```
 */
class ExitError extends Error {
	/** @override */
	override readonly name = 'ExitError';

	/** The exit code passed to `exit()`. */
	readonly code: number;

	constructor(code: number) {
		super(`Process exited with code ${code}`);
		this.code = code;
	}
}

/** Noop writer — silently discards output. */
const noopWrite: WriteFn = () => {};

/** Noop reader — returns `null` (EOF) immediately. */
const eofRead: ReadFn = () => Promise.resolve(null);

/** Noop file reader — returns `null` (not found) for all paths. */
const noopReadFile: (path: string) => Promise<string | null> = () => Promise.resolve(null);

/**
 * Create a test runtime adapter with injectable process state.
 *
 * Use this in `@kjanat/dreamcli/testkit` tests when you need to simulate argv,
 * environment variables, TTY state, stdin, or config-file reads without
 * touching the host process.
 *
 * @param options - Optional overrides for any adapter field.
 * @returns A `RuntimeAdapter` suitable for test scenarios.
 *
 * @example
 * ```ts
 * const adapter = createTestAdapter({
 *   argv: ['node', 'cli.js', 'deploy', '--force'],
 *   env: { DEPLOY_REGION: 'us' },
 * });
 *
 * const result = await cli('mycli').run({ adapter });
 * ```
 */
function createTestAdapter(options?: TestAdapterOptions): RuntimeAdapter {
	const stdinIsTTY = options?.stdinIsTTY ?? false;
	let stdinData = !stdinIsTTY ? options?.stdinData : undefined;
	return {
		argv: options?.argv ?? ['node', 'test'],
		env: options?.env ?? {},
		cwd: options?.cwd ?? '/test',
		stdout: options?.stdout ?? noopWrite,
		stderr: options?.stderr ?? noopWrite,
		stdin: options?.stdin ?? eofRead,
		readStdin: () => {
			if (stdinData === undefined) {
				return Promise.resolve(null);
			}
			const result = stdinData;
			stdinData = undefined;
			return Promise.resolve(result);
		},
		isTTY: options?.isTTY ?? false,
		stdinIsTTY,
		exit:
			options?.exit ??
			((code: number): never => {
				throw new ExitError(code);
			}),
		readFile: options?.readFile ?? noopReadFile,
		homedir: options?.homedir ?? '/home/test',
		configDir: options?.configDir ?? '/home/test/.config',
	};
}

// --- Exports

export type { RuntimeAdapter, TestAdapterOptions };
export { createTestAdapter, ExitError };
