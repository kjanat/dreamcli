/**
 * Shell targets, token normalization, and shell detection for completion.
 *
 * Kept apart from the generators so the CLI builder and planner can validate
 * a `--completions <shell>` request without loading any script generator.
 *
 * @module dreamcli/core/completion/shell
 */

import type { CompletionOptions } from './shells/shared.ts';

// --- Shell type — supported completion targets

/**
 * Supported shell targets for completion script generation.
 *
 * `bash`, `zsh`, `fish`, and `powershell` are implemented today.
 */
type Shell = 'bash' | 'zsh' | 'fish' | 'powershell';

/**
 * Implemented shell values as a frozen readonly non-empty tuple.
 *
 * Use this tuple for user-facing validation and shell selection UIs.
 * It intentionally matches the shipped {@link Shell} union exactly so docs,
 * help output, and completion generation advertise the same support surface.
 *
 * @see {@link Shell} for the union type matching these entries.
 */
const SHELLS: Readonly<readonly ['bash', 'zsh', 'fish', 'powershell']> = Object.freeze([
	'bash',
	'zsh',
	'fish',
	'powershell',
] as const satisfies readonly ['bash', 'zsh', 'fish', 'powershell']);

// --- Shell token normalization

/**
 * Normalize a raw shell token — a bare name (`zsh`), a `$SHELL` path
 * (`/bin/zsh`), or a Windows executable (`…\pwsh.exe`) — to a supported
 * {@link Shell}, or `undefined` when it does not map to one.
 *
 * Mirrors the matching used by the `completions` subcommand so the subcommand
 * and the eager `--completions <shell>` flag accept exactly the same inputs.
 *
 * @param raw - User-supplied shell token or interpreter path.
 * @returns The resolved {@link Shell}, or `undefined` if unrecognized.
 */
function normalizeShell(raw: string): Shell | undefined {
	const segments = raw.split(/[\\/]/);
	const basename = segments[segments.length - 1] ?? raw;
	const name = basename.replace(/\.(?:exe|cmd|bat)$/i, '');
	if (name === 'pwsh') return 'powershell';
	return (SHELLS as readonly string[]).includes(name) ? (name as Shell) : undefined;
}

/**
 * Auto-detect the current shell from environment variables.
 *
 * Resolution order:
 * 1. `$SHELL` parsed as an interpreter path (`/bin/zsh` → `zsh`). It wins when
 *    it names a shell we support — a pwsh session launched from bash inherits
 *    `SHELL=/bin/bash`, and the login shell the user opted into should be
 *    honored over the fallback.
 * 2. Otherwise, the presence of `$PSModulePath` signals PowerShell. PowerShell
 *    never sets `$SHELL` on any platform but always exports `PSModulePath` for
 *    module discovery, so it is the reliable pwsh signal.
 *
 * Returns `undefined` when no signal resolves, leaving the caller to ask the
 * user for an explicit shell.
 *
 * @param env - Environment record (e.g. `process.env` or an adapter's env).
 * @returns The detected {@link Shell}, or `undefined`.
 */
function detectShell(env: Readonly<Record<string, string | undefined>>): Shell | undefined {
	const shellVar = env.SHELL;
	const fromShell =
		shellVar !== undefined && shellVar !== '' ? normalizeShell(shellVar) : undefined;
	if (fromShell !== undefined) return fromShell;
	if (env.PSModulePath !== undefined) return 'powershell';
	return undefined;
}

// --- Exports

export type { CompletionOptions, Shell };
export { detectShell, normalizeShell, SHELLS };
