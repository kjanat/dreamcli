/**
 * Authentication guard and authenticated-command factory for the walkthrough `gh` example.
 *
 * @module
 */

import { CLIError, command, flag } from 'dreamcli';

export function requireAuth(token: string | undefined): { readonly token: string } {
	const normalizedToken = token?.trim();
	if (!normalizedToken) {
		throw new CLIError('Authentication required', {
			code: 'AUTH_REQUIRED',
			suggest: 'Run `gh auth login` or set GH_TOKEN',
			exitCode: 1,
		});
	}

	return { token: normalizedToken };
}

/** Redacts a token for display, keeping the first 8 and last 4 characters visible. */
export function redactToken(token: string): string {
	if (token.length <= 12) return '***';
	return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

/** A {@linkcode command} pre-wired with a `--token` / `GH_TOKEN` flag and auth guard. */
export function authedCommand(name: string) {
	return command(name)
		.flag('token', flag.string().env('GH_TOKEN').describe('GitHub token'))
		.derive(({ flags }) => requireAuth(flags.token));
}
