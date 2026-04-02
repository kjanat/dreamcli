/**
 * Smoke tests for the walkthrough `gh` example.
 *
 * @module
 */

import { describe, expect, it } from 'bun:test';

import { runCommand } from 'dreamcli/testkit';

import { authStatus } from '$gh/commands/auth.ts';
import { issueTriage } from '$gh/commands/issue.ts';
import { prView } from '$gh/commands/pr.ts';

const token = 'ghp_test_token_1234';

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

	it('fails non-interactively when the required decision is missing', async () => {
		const result = await runCommand(issueTriage, ['89'], {
			env: { GH_TOKEN: token },
		});

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('REQUIRED_FLAG');
		expect(result.stderr.join('')).toContain('Missing required flag --decision');
	});
});
