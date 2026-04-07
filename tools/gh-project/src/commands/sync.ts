/**
 * Sync command for the GitHub project helper.
 *
 * @module
 */

import { command, flag } from '@kjanat/dreamcli';
import { computeReadyTaskIds, readPrdState } from '#lib/prd.ts';
import { applyWorkflowUpdates, createProjectItem, loadProjectContext } from '#lib/project.ts';
import { ownerFlag, prdFlag, projectFlag } from '#lib/shared.ts';
import type { WorkflowUpdate } from '#lib/types.ts';

const sync = command('sync')
	.description('Sync project workflows from prd.json')
	.flag('owner', ownerFlag())
	.flag('project', projectFlag())
	.flag('prd', prdFlag())
	.flag(
		'overwrite-active',
		flag
			.boolean()
			.alias('overwriteActive', { hidden: true })
			.describe('Also overwrite In Progress and Blocked items'),
	)
	.action(async ({ flags, out }) => {
		const prd = await readPrdState(flags.prd);
		const project = await loadProjectContext(flags.project, flags.owner);

		const ready = new Set(computeReadyTaskIds(prd.file));

		// Create missing items sequentially to avoid GitHub API rate-limit bursts.
		// If this is parallelized later, add explicit throttling/backoff around createProjectItem().
		const itemsByTaskId = new Map(project.itemsByTaskId);
		const created: string[] = [];
		for (const task of prd.file.tasks) {
			if (!itemsByTaskId.has(task.id)) {
				const item = await createProjectItem(
					project,
					task.id,
					task.title,
					task.phase,
					task.priority,
				);
				itemsByTaskId.set(task.id, item);
				created.push(task.id);
			}
		}

		const augmented = { ...project, itemsByTaskId };

		const updates: WorkflowUpdate[] = [];
		for (const task of prd.file.tasks) {
			const item = augmented.itemsByTaskId.get(task.id);
			if (item === undefined) {
				continue;
			}

			if (task.passes) {
				updates.push({ taskId: task.id, workflow: 'Done' });
				continue;
			}

			if (
				!flags['overwrite-active'] &&
				(item.workflow === 'In Progress' || item.workflow === 'Blocked')
			) {
				continue;
			}

			updates.push({
				taskId: task.id,
				workflow: ready.has(task.id) ? 'Ready' : 'Backlog',
			});
		}

		const applied = await applyWorkflowUpdates(augmented, updates);

		if (out.jsonMode) {
			out.json({ project: project.project.url, prd: prd.filePath, created, updates: applied });
			return;
		}

		for (const taskId of created) {
			out.log(`Created: ${taskId}`);
		}

		if (applied.length === 0 && created.length === 0) {
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
