/**
 * Start command for the GitHub project helper.
 *
 * @module
 */

import { arg, command } from 'dreamcli';

import { applyWorkflowUpdates, loadProjectContext } from '../lib/project.ts';
import { ownerFlag, projectFlag } from '../lib/shared.ts';

const start = command('start')
	.description('Mark a project task In Progress')
	.arg('taskId', arg.string().describe('PRD task id'))
	.flag('owner', ownerFlag())
	.flag('project', projectFlag())
	.action(async ({ args, flags, out }) => {
		const project = await loadProjectContext(flags.project, flags.owner);
		const applied = await applyWorkflowUpdates(project, [
			{ taskId: args.taskId, workflow: 'In Progress' },
		]);

		if (out.jsonMode) {
			out.json({ project: project.project.url, updates: applied });
			return;
		}

		if (applied.length === 0) {
			out.info(`${args.taskId} already In Progress`);
			return;
		}

		out.log(`Set ${args.taskId} -> In Progress`);
	});

export { start };
