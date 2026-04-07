/**
 * Authentication commands for the walkthrough `gh` example.
 *
 * @module
 */

import { command, group } from '@kjanat/dreamcli';

import { redactToken, requireAuth, tokenFlag } from '../lib/auth.ts';

const authLogin = command('login')
	.description('Authenticate with GitHub')
	.flag(
		'token',
		tokenFlag('Authentication token')
			.required()
			.prompt({ kind: 'input', message: 'Paste your GitHub token:' }),
	)
	.action(({ flags, out }) => {
		const { token } = requireAuth(flags.token);
		const login = {
			host: 'github.com',
			token: redactToken(token),
			storedAt: '~/.config/gh/config.json',
		};

		if (out.jsonMode) {
			out.json(login);
			return;
		}

		// In a real CLI, validate the token via API and write to config.
		out.log(`Logged in with token ${login.token}`);
		out.info(`Token would be saved to ${login.storedAt}`);
	});

const authStatus = command('status')
	.description('Show authentication status')
	.flag('token', tokenFlag())
	.action(({ flags, out }) => {
		const token = flags.token?.trim();
		const status =
			token === undefined || token.length === 0
				? { authenticated: false, host: 'github.com' }
				: { authenticated: true, host: 'github.com', token: redactToken(token) };

		if (out.jsonMode) {
			out.json(status);
			return;
		}

		if (status.authenticated) {
			out.log(status.host);
			out.log(`Logged in with token ${status.token}`);
			return;
		}

		out.warn('Not logged in. Run `gh auth login`.');
	});

export { authLogin, authStatus };

export const auth = group('auth')
	.description('Manage authentication')
	.command(authLogin)
	.command(authStatus);
