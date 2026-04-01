/**
 * Authentication commands for the walkthrough `gh` example.
 *
 * @module
 */

import { env } from 'node:process';
import { command, flag, group } from 'dreamcli';
import { redactToken } from '$gh/lib/auth.ts';

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
		out.log(`Logged in with token ${redactToken(flags.token)}`);
		out.info('Token would be saved to ~/.config/gh/config.json');
	});

const authStatus = command('status')
	.description('Show authentication status')
	.action(({ out }) => {
		const token = env.GH_TOKEN;

		if (token) {
			out.log('github.com');
			out.log(`Logged in with token ${redactToken(token)}`);
			return;
		}

		out.warn('Not logged in. Run `gh auth login`.');
	});

export const auth = group('auth')
	.description('Manage authentication')
	.command(authLogin)
	.command(authStatus);
