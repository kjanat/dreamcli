/**
 * List command for the GitHub project helper.
 *
 * @module
 */

import { command, flag } from 'dreamcli';
import { readPrdState } from '../lib/prd.ts';
import { loadProjectContext } from '../lib/project.ts';
import { buildListRows, ownerFlag, parseWorkflow, prdFlag, projectFlag } from '../lib/shared.ts';
import type { ListRow } from '../lib/types.ts';

const list = command('list')
	.description('List PRD tasks alongside GitHub workflow state')
	.flag('owner', ownerFlag())
	.flag('project', projectFlag())
	.flag('prd', prdFlag())
	.flag('workflow', flag.custom(parseWorkflow).describe('Filter rows by workflow'))
	.action(async ({ flags, out }) => {
		const [project, prd] = await Promise.all([
			loadProjectContext(flags.project, flags.owner),
			readPrdState(flags.prd),
		]);

		const rows = buildListRows(project, prd).filter((row) =>
			flags.workflow !== undefined ? row.workflow === flags.workflow : true,
		);

		if (out.jsonMode) {
			out.json(rows);
			return;
		}

		if (rows.length === 0) {
			out.warn('No matching tasks');
			return;
		}

		out.table<ListRow>(rows, [
			{ key: 'taskId', header: 'Task ID' },
			{ key: 'passes', header: 'Passes' },
			{ key: 'status', header: 'Status' },
			{ key: 'workflow', header: 'Workflow' },
			{ key: 'phase', header: 'Phase' },
			{ key: 'priority', header: 'Priority' },
			{ key: 'title', header: 'Title' },
		]);
	});

export { list };
