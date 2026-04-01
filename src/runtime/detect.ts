/**
 * Auto-detects the current JavaScript runtime environment.
 *
 * Uses `globalThis` feature detection (version globals) to identify
 * the runtime without importing platform-specific modules. This is
 * the recommended approach because each runtime defines a unique
 * global marker:
 *
 * - **Bun:** `globalThis.Bun.version` (string)
 * - **Deno:** `globalThis.Deno.version` (object with `deno` key)
 * - **Node:** `globalThis.process.versions.node` (string)
 *
 * Detection order matters: Bun provides a Node-compatible `process`
 * global, so it must be checked *before* Node to avoid misidentification.
 *
 * @module dreamcli/runtime/detect
 */

// --- Runtime type

/**
 * Known JavaScript runtime environments.
 *
 * - `'node'` — Node.js
 * - `'bun'` — Bun
 * - `'deno'` — Deno
 * - `'unknown'` — Unrecognized environment
 */
type Runtime = 'node' | 'bun' | 'deno' | 'unknown';

/**
 * All known runtime values as a readonly tuple.
 *
 * Useful for validation, iteration, and exhaustiveness checks.
 *
 * @example
 * ```ts
 * if (RUNTIMES.includes(value)) {
 *   // value is a valid Runtime
 * }
 * ```
 */
const RUNTIMES: readonly ['node', 'bun', 'deno', 'unknown'] = [
	'node',
	'bun',
	'deno',
	'unknown',
] as const satisfies readonly Runtime[];

// --- Minimal global shapes — avoid importing @types/* for each runtime

/**
 * Minimal `globalThis` shape used for runtime detection.
 *
 * Each field is optional — only the present one identifies the runtime.
 * Typed as `unknown` where we only need truthiness; version fields are
 * typed just enough to distinguish runtimes safely.
 */
interface GlobalForDetect {
	readonly Bun?: { readonly version?: string };
	readonly Deno?: { readonly version?: { readonly deno?: string } };
	readonly process?: { readonly versions?: { readonly node?: string; readonly bun?: string } };
}

// --- Detection

/**
 * Detect the current JavaScript runtime.
 *
 * Uses `globalThis` feature detection to identify the host runtime.
 * Detection order is significant: Bun is checked before Node because
 * Bun exposes a Node-compatible `process` global.
 *
 * @param globals - Override `globalThis` for testing. Production callers
 *   should omit this parameter.
 * @returns The detected {@link Runtime} identifier.
 *
 * @example
 * ```ts
 * const rt = detectRuntime();
 * // rt === 'node' | 'bun' | 'deno' | 'unknown'
 * ```
 */
function detectRuntime(globals?: GlobalForDetect): Runtime {
	const g = globals ?? (globalThis as unknown as GlobalForDetect);

	// Bun first — it also has `process.versions.node`
	if (typeof g.Bun?.version === 'string') return 'bun';

	// Deno — check the nested version object
	if (typeof g.Deno?.version?.deno === 'string') return 'deno';

	// Node.js — last because Bun mimics it
	if (typeof g.process?.versions?.node === 'string') return 'node';

	return 'unknown';
}

// --- Exports

export type { GlobalForDetect, Runtime };
export { detectRuntime, RUNTIMES };
