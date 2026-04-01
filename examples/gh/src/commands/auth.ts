/**
 * Authentication commands for the walkthrough `gh` example.
 *
 * @module
 */

import { env } from 'node:process';

import { CLIError, command, flag, group } from 'dreamcli';

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

const authLogin = command('login')
	.description('Authenticate with GitHub')
	.flag(
		'token',
		flag
			.string()
			.env('GH_TOKEN')
			.required()
			.describe('Authentication token')
			.prompt({ kind: 'input', message: 'Paste your GitHub token:' }),
	)
	.action(({ flags, out }) => {
		// In a real CLI, validate the token via API and write to config.
		const display = `${flags.token.slice(0, 8)}...${flags.token.slice(-4)}`;
		out.log(`Logged in with token ${display}`);
		out.info('Token would be saved to ~/.config/gh/config.json');
	});

const authStatus = command('status')
	.description('Show authentication status')
	.action(({ out }) => {
		const token = env.GH_TOKEN;

		if (token) {
			out.log(`\
github.com
  Logged in with token ${token.slice(0, 8)}...`);
			return;
		}

		out.warn('Not logged in. Run `gh auth login`.');
	});

export const auth = group('auth')
	.description('Manage authentication')
	.command(authLogin)
	.command(authStatus);
