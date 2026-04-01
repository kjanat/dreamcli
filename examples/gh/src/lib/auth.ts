/**
 * Authentication guard for the walkthrough `gh` example.
 *
 * @module
 */

import { CLIError } from 'dreamcli';

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
