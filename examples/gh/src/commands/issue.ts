/**
 * Issue commands for the walkthrough `gh` example.
 *
 * @module
 */

import { arg, CLIError, flag, group } from 'dreamcli';

import issues from '$gh/data/issues.yaml' with { type: 'yaml' };
import { authedCommand } from '$gh/lib/auth.ts';
import { normalizeLimit } from '$gh/lib/utils.ts';

const issueLabelChoices = Array.from(new Set(issues.flatMap((issue) => issue.labels)))
	.sort()
	.map((label) => ({ value: label }));

const issueList = authedCommand('list')
	.description('List issues')
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

const issueTriage = authedCommand('triage')
	.description('Triage an issue with guided prompts')
	.arg('number', arg.number().describe('Issue number'))
	.flag('decision', flag.enum(['backlog', 'close']).required().describe('How to handle the issue'))
	.flag('label', flag.array(flag.string()).describe('Labels to keep when leaving the issue open'))
	.flag('comment', flag.boolean().describe('Post a follow-up comment'))
	.interactive(({ flags }) => {
		const labels = flags.label ?? [];

		return {
			label:
				flags.decision === 'backlog' && labels.length === 0
					? {
							kind: 'multiselect',
							message: 'Which labels still fit?',
							choices: issueLabelChoices,
						}
					: false,
			comment:
				flags.decision === 'close' && !flags.comment
					? { kind: 'confirm', message: 'Post a follow-up comment?' }
					: false,
		};
	})
	.action(({ args, flags, out }) => {
		const issue = issues.find((candidate) => candidate.number === args.number);

		if (!issue) {
			throw new CLIError(`Issue #${args.number} not found`, {
				code: 'NOT_FOUND',
				exitCode: 1,
				suggest: 'Try: gh issue list',
				details: { requested: args.number },
			});
		}

		const selectedLabels = flags.label ?? [];
		const labels =
			flags.decision === 'backlog' && selectedLabels.length > 0 ? selectedLabels : issue.labels;
		const triage = {
			number: issue.number,
			title: issue.title,
			decision: flags.decision,
			state: flags.decision === 'close' ? 'closed' : 'open',
			labels,
			commented: flags.decision === 'close' ? (flags.comment ?? false) : false,
		};

		if (out.jsonMode) {
			out.json(triage);
			return;
		}

		out.log(`#${triage.number} ${triage.title}`);
		if (triage.decision === 'close') {
			out.log('Status: closed');
			if (triage.commented) {
				out.info('Would post a follow-up comment');
			}
			return;
		}

		out.log('Status: open (backlog)');
		out.log(`Labels: ${triage.labels.length > 0 ? triage.labels.join(', ') : 'none'}`);
	});

export { issueList, issueTriage };

export const issue = group('issue')
	.description('Manage issues')
	.command(issueList)
	.command(issueTriage);
