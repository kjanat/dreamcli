/**
 * Issue commands for the walkthrough `gh` example.
 *
 * @module
 */

import { command, flag, group } from 'dreamcli';
import issues from '$gh/data/issues.yaml' with { type: 'yaml' };
import { requireAuth } from '$gh/lib/auth.ts';
import { normalizeLimit } from '$gh/lib/utils.ts';

const issueList = command('list')
	.description('List issues')
	.flag('token', flag.string().env('GH_TOKEN').describe('GitHub token'))
	.derive(({ flags }) => requireAuth(flags.token))
	.flag(
		'state',
		flag.enum(['open', 'closed', 'all']).default('open').alias('s').describe('Filter by state'),
	)
	.flag('limit', flag.number().default(10).alias('L').describe('Maximum number of results'))
	.flag('label', flag.string().alias('l').describe('Filter by label'))
	.action(({ flags, out }) => {
		let results = [...issues];

		if (flags.state !== 'all') {
			results = results.filter((issue) => issue.state === flags.state);
		}

		if (flags.label !== undefined) {
			const label = flags.label;
			results = results.filter((issue) => issue.labels.includes(label));
		}

		results = results.slice(0, normalizeLimit(flags.limit));

		out.table(
			results.map((issue) => ({
				'#': issue.number,
				title: issue.title,
				state: issue.state,
				author: issue.author,
			})),
		);
	});

export const issue = group('issue').description('Manage issues').command(issueList);
