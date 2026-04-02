/**
 * Finish command for the GitHub project helper.
 *
 * @module
 */

import { arg, command, flag } from 'dreamcli';
import { computeReadyTaskIds, markPrdTaskPassed, readPrdState } from '../lib/prd.ts';
import { applyWorkflowUpdates, loadProjectContext } from '../lib/project.ts';
import { ownerFlag, prdFlag, projectFlag } from '../lib/shared.ts';
import type { WorkflowUpdate } from '../lib/types.ts';

const finish = command('finish')
	.description('Mark a task Done, optionally mark passes=true, and unblock ready tasks')
	.arg('taskId', arg.string().describe('PRD task id'))
	.flag('owner', ownerFlag())
	.flag('project', projectFlag())
	.flag('prd', prdFlag())
	.flag('ready', flag.array(flag.string()).describe('Additional tasks to mark Ready'))
	.flag('skipPass', flag.boolean().describe('Do not write passes=true to prd.json'))
	.action(async ({ args, flags, out }) => {
		let prd = await readPrdState(flags.prd);
		if (!flags.skipPass) {
			prd = await markPrdTaskPassed(prd, args.taskId);
		}

		const readyFromPrd = computeReadyTaskIds(prd.file, [args.taskId]);
		const updates: WorkflowUpdate[] = [{ taskId: args.taskId, workflow: 'Done' }];

		for (const taskId of readyFromPrd) {
			if (taskId !== args.taskId) {
				updates.push({ taskId, workflow: 'Ready' });
			}
		}
		for (const taskId of flags.ready) {
			if (taskId !== args.taskId) {
				updates.push({ taskId, workflow: 'Ready' });
			}
		}

		const project = await loadProjectContext(flags.project, flags.owner);
		const applied = await applyWorkflowUpdates(project, updates);

		if (out.jsonMode) {
			out.json({
				project: project.project.url,
				prd: prd.filePath,
				passUpdated: !flags.skipPass,
				updates: applied,
			});
			return;
		}

		if (!flags.skipPass) {
			out.log(`Marked ${args.taskId} passed in ${prd.filePath}`);
		}
		if (applied.length === 0) {
			out.info('No workflow changes needed');
			return;
		}

		for (const update of applied) {
			out.log(`${update.taskId}: ${update.previousWorkflow ?? 'unset'} -> ${update.workflow}`);
		}
	});

export { finish };
