/**
 * Authentication guard and authenticated-command factory for the walkthrough `gh` example.
 *
 * @module
 */

import { CLIError, command, flag } from 'dreamcli';

export function requireAuth(token: string | undefined): { readonly token: string } {
	if (!token) {
		throw new CLIError('Authentication required', {
			code: 'AUTH_REQUIRED',
			suggest: 'Run `gh auth login` or set GH_TOKEN',
			exitCode: 1,
		});
	}

	return { token };
}

/** A {@linkcode command} pre-wired with a `--token` / `GH_TOKEN` flag and auth guard. */
export function authedCommand(name: string) {
	return command(name)
		.flag('token', flag.string().env('GH_TOKEN').describe('GitHub token'))
		.derive(({ flags }) => requireAuth(flags.token));
}
