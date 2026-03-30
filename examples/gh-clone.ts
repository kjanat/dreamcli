/**
 * Walkthrough example: a miniature `gh` (GitHub CLI) clone.
 *
 * Demonstrates every major dreamcli feature in a single, recognizable tool:
 * commands, groups, flags, arguments, middleware, env vars, prompts,
 * tables, JSON mode, spinners, and structured errors.
 *
 * Usage:
 *   GH_TOKEN=ghp_abc123 npx tsx examples/gh-clone.ts pr list
 *   GH_TOKEN=ghp_abc123 npx tsx examples/gh-clone.ts pr list --state all --json
 *   GH_TOKEN=ghp_abc123 npx tsx examples/gh-clone.ts pr view 142
 *   GH_TOKEN=ghp_abc123 npx tsx examples/gh-clone.ts pr create
 *   GH_TOKEN=ghp_abc123 npx tsx examples/gh-clone.ts issue list --label bug
 *   npx tsx examples/gh-clone.ts auth login
 *   npx tsx examples/gh-clone.ts auth status
 *   npx tsx examples/gh-clone.ts --help
 *
 * @module
 */

import process from "node:process";
import { arg, CLIError, cli, command, flag, group, middleware } from 'dreamcli';

// ── Mock data ─────────────────────────────────────────────────────────
// In a real CLI, this would come from the GitHub API.

type PR = {
	readonly number: number;
	readonly title: string;
	readonly state: 'open' | 'closed' | 'merged';
	readonly author: string;
	readonly labels: readonly string[];
	readonly draft: boolean;
};

type Issue = {
	readonly number: number;
	readonly title: string;
	readonly state: 'open' | 'closed';
	readonly author: string;
	readonly labels: readonly string[];
};

const pullRequests: readonly PR[] = [
	{
		number: 142,
		title: 'Add dark mode toggle',
		state: 'open',
		author: 'alice',
		labels: ['enhancement', 'ui'],
		draft: false,
	},
	{
		number: 141,
		title: 'Fix OAuth redirect loop',
		state: 'open',
		author: 'bob',
		labels: ['bug'],
		draft: false,
	},
	{
		number: 140,
		title: 'Bump dependencies',
		state: 'merged',
		author: 'dependabot',
		labels: ['chore'],
		draft: false,
	},
	{
		number: 139,
		title: 'Add rate limiting',
		state: 'closed',
		author: 'carol',
		labels: ['enhancement'],
		draft: true,
	},
	{
		number: 138,
		title: 'Refactor auth module',
		state: 'merged',
		author: 'alice',
		labels: ['refactor'],
		draft: false,
	},
	{
		number: 137,
		title: 'Fix date parsing in Safari',
		state: 'open',
		author: 'dave',
		labels: ['bug'],
		draft: false,
	},
];

const issues: readonly Issue[] = [
	{ number: 89, title: 'Login fails on Firefox', state: 'open', author: 'eve', labels: ['bug'] },
	{
		number: 88,
		title: 'Add keyboard shortcuts',
		state: 'open',
		author: 'frank',
		labels: ['enhancement'],
	},
	{ number: 87, title: 'Typo in README', state: 'closed', author: 'grace', labels: ['docs'] },
	{
		number: 86,
		title: 'Dark mode colors wrong',
		state: 'open',
		author: 'alice',
		labels: ['bug', 'ui'],
	},
];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Auth middleware ───────────────────────────────────────────────────
// Checks for a token in the GH_TOKEN env var.
// In a real CLI, you'd also check config files and the system keychain.

const requireAuth = middleware<{ token: string }>(async ({ next }) => {
	const token = process.env.GH_TOKEN;
	if (!token) {
		throw new CLIError('Authentication required', {
			code: 'AUTH_REQUIRED',
			suggest: 'Run `gh auth login` or set GH_TOKEN',
			exitCode: 1,
		});
	}
	return next({ token });
});

// ── Auth commands ─────────────────────────────────────────────────────

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
		// In a real CLI, validate the token via API and write to config
		const display = `${flags.token.slice(0, 8)}...${flags.token.slice(-4)}`;
		out.log(`Logged in with token ${display}`);
		out.info('Token would be saved to ~/.config/gh/config.json');
	});

const authStatus = command('status')
	.description('Show authentication status')
	.action(({ out }) => {
		const token = process.env.GH_TOKEN;
		if (token) {
			out.log('github.com');
			out.log(`  Logged in with token ${token.slice(0, 8)}...`);
		} else {
			out.warn('Not logged in. Run `gh auth login`.');
		}
	});

// ── PR commands ───────────────────────────────────────────────────────

const prList = command('list')
	.description('List pull requests')
	.middleware(requireAuth)
	.flag(
		'state',
		flag
			.enum(['open', 'closed', 'merged', 'all'])
			.default('open')
			.alias('s')
			.describe('Filter by state'),
	)
	.flag('limit', flag.number().default(10).alias('L').describe('Maximum number of results'))
	.flag('label', flag.string().alias('l').describe('Filter by label'))
	.action(({ flags, out }) => {
		let results = [...pullRequests];
		if (flags.state !== 'all') {
			results = results.filter((p) => p.state === flags.state);
		}
		if (flags.label !== undefined) {
			const label = flags.label;
			results = results.filter((p) => p.labels.includes(label));
		}
		results = results.slice(0, flags.limit);

		out.table(
			results.map((p) => ({ '#': p.number, title: p.title, state: p.state, author: p.author })),
		);
	});

const prView = command('view')
	.description('View a pull request')
	.middleware(requireAuth)
	.arg('number', arg.string().describe('PR number'))
	.action(({ args, out }) => {
		if (!/^\d+$/.test(args.number)) {
			throw new CLIError(`Invalid pull request number: ${args.number}`, {
				code: 'INVALID_INPUT',
				exitCode: 1,
				suggest: 'PR number must be a positive integer',
				details: { requested: args.number },
			});
		}

		const num = Number(args.number);
		const pr = pullRequests.find((p) => p.number === num);

		if (!pr) {
			throw new CLIError(`Pull request #${args.number} not found`, {
				code: 'NOT_FOUND',
				exitCode: 1,
				suggest: 'Try: gh pr list',
				details: { requested: args.number },
			});
		}

		out.json(pr);
		out.log(`#${pr.number} ${pr.title}`);
		out.log(`State:  ${pr.state}  Author: ${pr.author}  Draft: ${String(pr.draft)}`);
		out.log(`Labels: ${pr.labels.join(', ')}`);
	});

const prCreate = command('create')
	.description('Create a pull request')
	.middleware(requireAuth)
	.flag(
		'title',
		flag.string().alias('t').describe('PR title').prompt({ kind: 'input', message: 'Title:' }),
	)
	.flag(
		'body',
		flag.string().alias('b').describe('PR body').prompt({ kind: 'input', message: 'Body:' }),
	)
	.flag('draft', flag.boolean().alias('d').default(false).describe('Create as draft'))
	.action(async ({ flags, out }) => {
		const spinner = out.spinner('Creating pull request...');
		await sleep(1500);
		spinner.succeed('Pull request created');

		out.json({ number: 143, title: flags.title, url: 'https://github.com/you/repo/pull/143' });
		out.log(`#143 ${flags.title}`);
		if (flags.draft) out.info('Marked as draft');
		out.log('https://github.com/you/repo/pull/143');
	});

// ── Issue commands ────────────────────────────────────────────────────

const issueList = command('list')
	.description('List issues')
	.middleware(requireAuth)
	.flag(
		'state',
		flag.enum(['open', 'closed', 'all']).default('open').alias('s').describe('Filter by state'),
	)
	.flag('limit', flag.number().default(10).alias('L').describe('Maximum number of results'))
	.flag('label', flag.string().alias('l').describe('Filter by label'))
	.action(({ flags, out }) => {
		let results = [...issues];
		if (flags.state !== 'all') {
			results = results.filter((i) => i.state === flags.state);
		}
		if (flags.label !== undefined) {
			const label = flags.label;
			results = results.filter((i) => i.labels.includes(label));
		}
		results = results.slice(0, flags.limit);

		out.table(
			results.map((i) => ({ '#': i.number, title: i.title, state: i.state, author: i.author })),
		);
	});

// ── CLI assembly ──────────────────────────────────────────────────────

const auth = group('auth')
	.description('Manage authentication')
	.command(authLogin)
	.command(authStatus);

const pr = group('pr')
	.description('Manage pull requests')
	.command(prList)
	.command(prView)
	.command(prCreate);

const issue = group('issue').description('Manage issues').command(issueList);

cli('gh')
	.version('0.1.0')
	.description('A minimal GitHub CLI clone — dreamcli walkthrough example')
	.command(auth)
	.command(pr)
	.command(issue)
	.run();
