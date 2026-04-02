/**
 * Set command for the GitHub project helper.
 *
 * @module
 */

import { arg, command } from 'dreamcli';

import { applyWorkflowUpdates, loadProjectContext } from '../lib/project.ts';
import { ownerFlag, parseWorkflow, projectFlag } from '../lib/shared.ts';

const setWorkflow = command('set')
	.description('Set a project task to any workflow value')
	.arg('taskId', arg.string().describe('PRD task id'))
	.arg('workflow', arg.custom(parseWorkflow).describe('Workflow value'))
	.flag('owner', ownerFlag())
	.flag('project', projectFlag())
	.action(async ({ args, flags, out }) => {
		const project = await loadProjectContext(flags.project, flags.owner);
		const applied = await applyWorkflowUpdates(project, [
			{ taskId: args.taskId, workflow: args.workflow },
		]);

		if (out.jsonMode) {
			out.json({ project: project.project.url, updates: applied });
			return;
		}

		if (applied.length === 0) {
			out.info(`${args.taskId} already ${args.workflow}`);
			return;
		}

		for (const update of applied) {
			out.log(
				`${update.taskId}: Status ${update.previousStatus ?? 'unset'} -> ${update.status}, Workflow ${update.previousWorkflow ?? 'unset'} -> ${update.workflow}`,
			);
		}
	});

export { setWorkflow };
