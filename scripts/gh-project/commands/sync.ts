/**
 * Sync command for the GitHub project helper.
 *
 * @module
 */

import { command, flag } from 'dreamcli';
import { computeReadyTaskIds, readPrdState } from '../lib/prd.ts';
import { applyWorkflowUpdates, loadProjectContext } from '../lib/project.ts';
import { ownerFlag, prdFlag, projectFlag } from '../lib/shared.ts';
import type { WorkflowUpdate } from '../lib/types.ts';

const sync = command('sync')
	.description('Sync project workflows from prd.json')
	.flag('owner', ownerFlag())
	.flag('project', projectFlag())
	.flag('prd', prdFlag())
	.flag('overwriteActive', flag.boolean().describe('Also overwrite In Progress and Blocked items'))
	.action(async ({ flags, out }) => {
		const [project, prd] = await Promise.all([
			loadProjectContext(flags.project, flags.owner),
			readPrdState(flags.prd),
		]);

		const ready = new Set(computeReadyTaskIds(prd.file));
		const updates: WorkflowUpdate[] = [];

		for (const task of prd.file.tasks) {
			const item = project.itemsByTaskId.get(task.id);
			if (item === undefined) {
				continue;
			}

			if (task.passes) {
				updates.push({ taskId: task.id, workflow: 'Done' });
				continue;
			}

			if (
				!flags.overwriteActive &&
				(item.workflow === 'In Progress' || item.workflow === 'Blocked')
			) {
				continue;
			}

			updates.push({
				taskId: task.id,
				workflow: ready.has(task.id) ? 'Ready' : 'Backlog',
			});
		}

		const applied = await applyWorkflowUpdates(project, updates);

		if (out.jsonMode) {
			out.json({ project: project.project.url, prd: prd.filePath, updates: applied });
			return;
		}

		if (applied.length === 0) {
			out.info('Project already in sync with prd.json');
			return;
		}

		for (const update of applied) {
			out.log(
				`${update.taskId}: Status ${update.previousStatus ?? 'unset'} -> ${update.status}, Workflow ${update.previousWorkflow ?? 'unset'} -> ${update.workflow}`,
			);
		}
	});

export { sync };
