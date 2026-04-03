/**
 * Smoke tests for the walkthrough `gh` example.
 *
 * @module
 */

import { describe, expect, it } from 'bun:test';

import { runCommand } from '@kjanat/dreamcli/testkit';

import { authLogin, authStatus } from '$gh/commands/auth.ts';
import { issueList, issueTriage } from '$gh/commands/issue.ts';
import { prCreate, prList, prView } from '$gh/commands/pr.ts';
import { normalizeLimit, sleep } from '$gh/lib/utils.ts';

const token = 'ghp_test_token_1234';

// === auth login

describe('gh example — auth login', () => {
	it('logs the redacted token in human mode', async () => {
		const result = await runCommand(authLogin, [], {
			env: { GH_TOKEN: token },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			'Logged in with token ghp_test...1234\n',
			'Token would be saved to ~/.config/gh/config.json\n',
		]);
	});

	it('returns structured JSON in json mode', async () => {
		const result = await runCommand(authLogin, [], {
			env: { GH_TOKEN: token },
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			host: 'github.com',
			token: 'ghp_test...1234',
			storedAt: '~/.config/gh/config.json',
		});
	});
});

// === auth status

describe('gh example — auth status', () => {
	it('resolves GH_TOKEN through the command schema', async () => {
		const result = await runCommand(authStatus, [], {
			env: { GH_TOKEN: token },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['github.com\n', 'Logged in with token ghp_test...1234\n']);
	});

	it('warns when no token resolves', async () => {
		const result = await runCommand(authStatus, []);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual(['Not logged in. Run `gh auth login`.\n']);
	});

	it('returns structured JSON in json mode', async () => {
		const result = await runCommand(authStatus, [], {
			env: { GH_TOKEN: token },
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			authenticated: true,
			host: 'github.com',
			token: 'ghp_test...1234',
		});
	});
});

// === pr list

describe('gh example — pr list', () => {
	it('filters pull requests and emits JSON rows', async () => {
		const result = await runCommand(prList, ['--label', 'bug', '--limit', '2'], {
			env: { GH_TOKEN: token },
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual([
			{ '#': 137, title: 'Fix date parsing in Safari', state: 'open', author: 'dave' },
			{ '#': 141, title: 'Fix OAuth redirect loop', state: 'open', author: 'bob' },
		]);
	});

	it('requires authentication before listing', async () => {
		const result = await runCommand(prList, []);

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('AUTH_REQUIRED');
		expect(result.stderr.join('')).toContain('Authentication required');
	});
});

// === pr view

describe('gh example — pr view', () => {
	it('renders the human summary by default', async () => {
		const result = await runCommand(prView, ['142'], {
			env: { GH_TOKEN: token },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			'#142 Add dark mode toggle\nState:  open  Author: alice  Draft: false\nLabels: enhancement, ui\n',
		]);
	});

	it('renders only JSON in json mode', async () => {
		const result = await runCommand(prView, ['142'], {
			env: { GH_TOKEN: token },
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual([]);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			number: 142,
			title: 'Add dark mode toggle',
			state: 'open',
			author: 'alice',
			labels: ['enhancement', 'ui'],
			draft: false,
		});
	});

	it('returns a structured not-found error', async () => {
		const result = await runCommand(prView, ['999'], {
			env: { GH_TOKEN: token },
		});

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('NOT_FOUND');
		expect(result.stderr.join('')).toContain('Pull request #999 not found');
	});
});

// === pr create

describe('gh example — pr create', () => {
	it('creates a draft pull request in human mode', async () => {
		const result = await runCommand(
			prCreate,
			['--title', 'Fix login', '--body', 'Correct callback URL', '--draft'],
			{
				env: { GH_TOKEN: token },
			},
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			'#143 Fix login\n',
			'Marked as draft\n',
			'https://github.com/you/repo/pull/143\n',
		]);
		expect(result.activity).toEqual([
			{ type: 'spinner:start', text: 'Creating pull request...' },
			{ type: 'spinner:succeed', text: 'Pull request created' },
		]);
	});

	it('emits only JSON in json mode', async () => {
		const result = await runCommand(
			prCreate,
			['--title', 'Fix login', '--body', 'Correct callback URL'],
			{
				env: { GH_TOKEN: token },
				jsonMode: true,
			},
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual([]);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			number: 143,
			title: 'Fix login',
			url: 'https://github.com/you/repo/pull/143',
		});
	});
});

// === issue list

describe('gh example — issue list', () => {
	it('applies the state filter before rendering', async () => {
		const result = await runCommand(issueList, ['--state', 'closed'], {
			env: { GH_TOKEN: token },
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual([
			{ '#': 87, title: 'Typo in README', state: 'closed', author: 'grace' },
		]);
	});

	it('filters issues and emits JSON rows', async () => {
		const result = await runCommand(issueList, ['--state', 'all', '--label', 'bug'], {
			env: { GH_TOKEN: token },
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual([
			{ '#': 86, title: 'Dark mode colors wrong', state: 'open', author: 'alice' },
			{ '#': 89, title: 'Login fails on Firefox', state: 'open', author: 'eve' },
		]);
	});
});

// === issue triage

describe('gh example — issue triage', () => {
	it('guides backlog triage with conditional prompts', async () => {
		const result = await runCommand(issueTriage, ['89', '--decision', 'backlog'], {
			env: { GH_TOKEN: token },
			answers: [['bug', 'ui']],
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			'#89 Login fails on Firefox\n',
			'Status: open (backlog)\n',
			'Labels: bug, ui\n',
		]);
	});

	it('switches to the close branch and returns structured JSON', async () => {
		const result = await runCommand(issueTriage, ['89', '--decision', 'close'], {
			env: { GH_TOKEN: token },
			answers: [true],
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual([]);
		expect(JSON.parse(result.stdout[0] ?? '')).toEqual({
			number: 89,
			title: 'Login fails on Firefox',
			decision: 'close',
			state: 'closed',
			labels: ['bug'],
			commented: true,
		});
	});

	it('shows the close branch in human mode', async () => {
		const result = await runCommand(issueTriage, ['89', '--decision', 'close'], {
			env: { GH_TOKEN: token },
			answers: [true],
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			'#89 Login fails on Firefox\n',
			'Status: closed\n',
			'Would post a follow-up comment\n',
		]);
	});

	it('fails non-interactively when the required decision is missing', async () => {
		const result = await runCommand(issueTriage, ['89'], {
			env: { GH_TOKEN: token },
		});

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('REQUIRED_FLAG');
		expect(result.stderr.join('')).toContain('Missing required flag --decision');
	});

	it('returns a structured not-found error', async () => {
		const result = await runCommand(issueTriage, ['999', '--decision', 'backlog'], {
			env: { GH_TOKEN: token },
		});

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('NOT_FOUND');
		expect(result.stderr.join('')).toContain('Issue #999 not found');
	});
});

// === utils

describe('gh example — utils', () => {
	it('normalizes numeric limits', () => {
		expect(normalizeLimit(4.8)).toBe(4);
		expect(normalizeLimit(0)).toBe(1);
		expect(normalizeLimit(Number.POSITIVE_INFINITY)).toBe(10);
	});

	it('sleep resolves', async () => {
		expect(await sleep(0)).toBeUndefined();
	});
});
