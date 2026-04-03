/**
 * Pull request commands for the walkthrough `gh` example.
 *
 * @module
 */

import { arg, CLIError, flag, group } from '@kjanat/dreamcli';

import pullRequests from '$gh/data/pull-requests.yaml' with { type: 'yaml' };
import { authedCommand } from '$gh/lib/auth.ts';
import { normalizeLimit, sleep } from '$gh/lib/utils.ts';

const prList = authedCommand('list')
	.description('List pull requests')
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
			results = results.filter((pr) => pr.state === flags.state);
		}

		if (flags.label !== undefined) {
			const label = flags.label;
			results = results.filter((pr) => pr.labels.includes(label));
		}

		results = results.slice(0, normalizeLimit(flags.limit));

		out.table(
			results.map((pr) => ({
				'#': pr.number,
				title: pr.title,
				state: pr.state,
				author: pr.author,
			})),
		);
	});

const prView = authedCommand('view')
	.description('View a pull request')
	.arg('number', arg.number().describe('PR number'))
	.action(({ args, out }) => {
		const pr = pullRequests.find((candidate) => candidate.number === args.number);

		if (!pr) {
			throw new CLIError(`Pull request #${args.number} not found`, {
				code: 'NOT_FOUND',
				exitCode: 1,
				suggest: 'Try: gh pr list',
				details: { requested: args.number },
			});
		}

		if (out.jsonMode) {
			out.json(pr);
			return;
		}

		out.log(`\
#${pr.number} ${pr.title}
State:  ${pr.state}  Author: ${pr.author}  Draft: ${String(pr.draft)}
Labels: ${pr.labels.join(', ')}`);
	});

const prCreate = authedCommand('create')
	.description('Create a pull request')
	.flag(
		'title',
		flag
			.string()
			.required()
			.alias('t')
			.describe('PR title')
			.prompt({ kind: 'input', message: 'Title:' }),
	)
	.flag(
		'body',
		flag
			.string()
			.required()
			.alias('b')
			.describe('PR body')
			.prompt({ kind: 'input', message: 'Body:' }),
	)
	.flag('draft', flag.boolean().alias('d').default(false).describe('Create as draft'))
	.action(async ({ flags, out }) => {
		const spinner = out.spinner('Creating pull request...');
		await sleep(1500);
		spinner.succeed('Pull request created');

		const createdPr = {
			number: 143,
			title: flags.title,
			url: 'https://github.com/you/repo/pull/143',
		};

		if (out.jsonMode) {
			out.json(createdPr);
			return;
		}

		out.log(`#${createdPr.number} ${createdPr.title}`);
		if (flags.draft) {
			out.info('Marked as draft');
		}
		out.log(createdPr.url);
	});

export { prCreate, prList, prView };

export const pr = group('pr')
	.description('Manage pull requests')
	.command(prList)
	.command(prView)
	.command(prCreate);
