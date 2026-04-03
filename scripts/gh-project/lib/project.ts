/**
 * GitHub Project helpers for the GitHub project helper CLI.
 *
 * @module
 */

import { $ } from 'bun';
import {
	expectRecord,
	fail,
	formatError,
	parseJson,
	parseProjectStatus,
	parseWorkflow,
	readArray,
	readOptionalString,
	readString,
	statusForWorkflow,
} from './shared.ts';
import type {
	AppliedWorkflowUpdate,
	FieldOption,
	PhaseField,
	PriorityField,
	ProjectContext,
	ProjectItem,
	ProjectView,
	StatusField,
	StatusOption,
	WorkflowField,
	WorkflowOption,
	WorkflowUpdate,
} from './types.ts';
import { ITEM_LIST_LIMIT } from './types.ts';

async function ghJson(command: string, run: () => Promise<string>): Promise<unknown> {
	try {
		return parseJson(await run());
	} catch (error) {
		return fail(`Failed to run gh ${command}: ${formatError(error)}`);
	}
}

async function ghProjectView(projectNumber: number, owner: string): Promise<unknown> {
	return ghJson(`project view ${projectNumber} --owner ${owner} --format json`, () =>
		$`gh project view ${projectNumber} --owner ${owner} --format json`.text(),
	);
}

async function ghProjectFieldList(projectNumber: number, owner: string): Promise<unknown> {
	return ghJson(`project field-list ${projectNumber} --owner ${owner} --format json`, () =>
		$`gh project field-list ${projectNumber} --owner ${owner} --format json`.text(),
	);
}

async function ghProjectItemList(projectNumber: number, owner: string): Promise<unknown> {
	return ghJson(
		`project item-list ${projectNumber} --owner ${owner} --limit ${ITEM_LIST_LIMIT} --format json`,
		() =>
			$`gh project item-list ${projectNumber} --owner ${owner} --limit ${ITEM_LIST_LIMIT} --format json`.text(),
	);
}

async function ghProjectItemEdit(
	itemId: string,
	projectId: string,
	fieldId: string,
	optionId: string,
): Promise<void> {
	try {
		await $`gh project item-edit --id ${itemId} --project-id ${projectId} --field-id ${fieldId} --single-select-option-id ${optionId}`;
	} catch (error) {
		return fail(`Failed to update project item ${itemId}: ${formatError(error)}`);
	}
}

async function ghProjectItemCreate(
	projectNumber: number,
	owner: string,
	title: string,
): Promise<string> {
	const result = await ghJson('project item-create', () =>
		$`gh project item-create ${projectNumber} --owner ${owner} --title ${title} --format json`.text(),
	);
	const record = expectRecord(result, 'item-create result');
	return readString(record, 'id', 'item-create result');
}

async function ghProjectItemEditText(
	itemId: string,
	projectId: string,
	fieldId: string,
	value: string,
): Promise<void> {
	try {
		await $`gh project item-edit --id ${itemId} --project-id ${projectId} --field-id ${fieldId} --text ${value}`;
	} catch (error) {
		return fail(`Failed to set text field on item ${itemId}: ${formatError(error)}`);
	}
}

function parseProjectView(payload: unknown): ProjectView {
	const record = expectRecord(payload, 'project view');
	return {
		id: readString(record, 'id', 'project view'),
		url: readString(record, 'url', 'project view'),
	};
}

function parseStatusField(payload: unknown): StatusField {
	const record = expectRecord(payload, 'field list');
	const fields = readArray(record, 'fields', 'field list');

	for (const fieldValue of fields) {
		const field = expectRecord(fieldValue, 'field list field');
		const name = readOptionalString(field, 'name', 'field list field');
		if (name !== 'Status') {
			continue;
		}

		const optionsRaw = readArray(field, 'options', 'Status field');
		const options: StatusOption[] = [];
		for (const optionValue of optionsRaw) {
			const option = expectRecord(optionValue, 'Status field option');
			options.push({
				id: readString(option, 'id', 'Status field option'),
				name: parseProjectStatus(readString(option, 'name', 'Status field option')),
			});
		}

		return {
			id: readString(field, 'id', 'Status field'),
			options,
		};
	}

	return fail('Could not find built-in Status field on project 4');
}

function parseWorkflowField(payload: unknown): WorkflowField {
	const record = expectRecord(payload, 'field list');
	const fields = readArray(record, 'fields', 'field list');

	for (const fieldValue of fields) {
		const field = expectRecord(fieldValue, 'field list field');
		const name = readOptionalString(field, 'name', 'field list field');
		if (name !== 'Workflow') {
			continue;
		}

		const optionsRaw = readArray(field, 'options', 'Workflow field');
		const options: WorkflowOption[] = [];
		for (const optionValue of optionsRaw) {
			const option = expectRecord(optionValue, 'Workflow field option');
			options.push({
				id: readString(option, 'id', 'Workflow field option'),
				name: parseWorkflow(readString(option, 'name', 'Workflow field option')),
			});
		}

		return {
			id: readString(field, 'id', 'Workflow field'),
			options,
		};
	}

	return fail('Could not find Workflow field on project 4');
}

function parseTaskIdFieldId(payload: unknown): string {
	const record = expectRecord(payload, 'field list');
	const fields = readArray(record, 'fields', 'field list');

	for (const fieldValue of fields) {
		const field = expectRecord(fieldValue, 'field list field');
		if (readOptionalString(field, 'name', 'field list field') === 'PRD Task ID') {
			return readString(field, 'id', 'PRD Task ID field');
		}
	}

	return fail('Could not find PRD Task ID field on project');
}

function parsePhaseField(payload: unknown): PhaseField {
	const field = parseSelectField(payload, 'Phase');
	return {
		id: field.id,
		options: field.options,
	};
}

function parsePriorityField(payload: unknown): PriorityField {
	const field = parseSelectField(payload, 'Task Priority');
	return {
		id: field.id,
		options: field.options,
	};
}

function parseSelectField(
	payload: unknown,
	fieldName: string,
): { readonly id: string; readonly options: readonly FieldOption[] } {
	const record = expectRecord(payload, 'field list');
	const fields = readArray(record, 'fields', 'field list');

	for (const fieldValue of fields) {
		const field = expectRecord(fieldValue, 'field list field');
		if (readOptionalString(field, 'name', 'field list field') !== fieldName) {
			continue;
		}

		const optionsRaw = readArray(field, 'options', `${fieldName} field`);
		const options: FieldOption[] = [];
		for (const optionValue of optionsRaw) {
			const option = expectRecord(optionValue, `${fieldName} field option`);
			options.push({
				id: readString(option, 'id', `${fieldName} field option`),
				name: readString(option, 'name', `${fieldName} field option`),
			});
		}

		return { id: readString(field, 'id', `${fieldName} field`), options };
	}

	return fail(`Could not find ${fieldName} field on project`);
}

function parseProjectItems(payload: unknown): readonly ProjectItem[] {
	const record = expectRecord(payload, 'item list');
	const itemsRaw = readArray(record, 'items', 'item list');
	const items: ProjectItem[] = [];

	for (const itemValue of itemsRaw) {
		const item = expectRecord(itemValue, 'project item');
		const taskId = readOptionalString(item, 'pRD Task ID', 'project item');
		if (taskId === undefined || taskId.length === 0) {
			continue;
		}

		const contentValue = item.content;
		const content =
			contentValue !== undefined ? expectRecord(contentValue, 'project item content') : undefined;
		const title =
			readOptionalString(item, 'title', 'project item') ??
			(content !== undefined
				? readOptionalString(content, 'title', 'project item content')
				: undefined) ??
			taskId;

		items.push({
			id: readString(item, 'id', 'project item'),
			taskId,
			title,
			status: readOptionalString(item, 'status', 'project item'),
			workflow: readOptionalString(item, 'workflow', 'project item'),
			phase: readOptionalString(item, 'phase', 'project item'),
			priority: readOptionalString(item, 'task Priority', 'project item'),
		});
	}

	return items;
}

async function loadProjectContext(projectNumber: number, owner: string): Promise<ProjectContext> {
	const [viewPayload, fieldPayload, itemPayload] = await Promise.all([
		ghProjectView(projectNumber, owner),
		ghProjectFieldList(projectNumber, owner),
		ghProjectItemList(projectNumber, owner),
	]);

	const items = parseProjectItems(itemPayload);
	return {
		owner,
		projectNumber,
		project: parseProjectView(viewPayload),
		statusField: parseStatusField(fieldPayload),
		workflowField: parseWorkflowField(fieldPayload),
		taskIdFieldId: parseTaskIdFieldId(fieldPayload),
		phaseField: parsePhaseField(fieldPayload),
		priorityField: parsePriorityField(fieldPayload),
		items,
		itemsByTaskId: new Map(items.map((item) => [item.taskId, item])),
	};
}

function dedupeWorkflowUpdates(updates: readonly WorkflowUpdate[]): readonly WorkflowUpdate[] {
	const latest = new Map<string, WorkflowUpdate['workflow']>();
	for (const update of updates) {
		latest.set(update.taskId, update.workflow);
	}

	return Array.from(latest, ([taskId, workflow]) => ({ taskId, workflow }));
}

async function applyWorkflowUpdates(
	project: ProjectContext,
	updates: readonly WorkflowUpdate[],
): Promise<readonly AppliedWorkflowUpdate[]> {
	const deduped = dedupeWorkflowUpdates(updates);
	const applied: AppliedWorkflowUpdate[] = [];

	for (const update of deduped) {
		const item = project.itemsByTaskId.get(update.taskId);
		if (item === undefined) {
			return fail(
				`Task '${update.taskId}' does not exist in GitHub Project ${project.projectNumber}`,
				'Run bun run gh-project:sync after adding missing project items',
			);
		}

		const status = statusForWorkflow(update.workflow);
		if (item.workflow === update.workflow && item.status === status) {
			continue;
		}

		const statusOption = project.statusField.options.find((entry) => entry.name === status);
		if (statusOption === undefined) {
			return fail(`Status option '${status}' is missing from project ${project.projectNumber}`);
		}
		const option = project.workflowField.options.find((entry) => entry.name === update.workflow);
		if (option === undefined) {
			return fail(
				`Workflow option '${update.workflow}' is missing from project ${project.projectNumber}`,
			);
		}

		if (item.status !== status) {
			await ghProjectItemEdit(item.id, project.project.id, project.statusField.id, statusOption.id);
		}
		await ghProjectItemEdit(item.id, project.project.id, project.workflowField.id, option.id);
		applied.push({
			taskId: update.taskId,
			status,
			previousStatus: item.status,
			workflow: update.workflow,
			previousWorkflow: item.workflow,
		});
	}

	return applied;
}

async function createProjectItem(
	project: ProjectContext,
	taskId: string,
	title: string,
	phase: number | undefined,
	priority: string,
): Promise<ProjectItem> {
	const itemId = await ghProjectItemCreate(project.projectNumber, project.owner, title);

	await ghProjectItemEditText(itemId, project.project.id, project.taskIdFieldId, taskId);

	if (phase !== undefined) {
		const phaseOption = project.phaseField.options.find((o) => {
			const leading = /^(\d+)/.exec(o.name)?.[1];
			return leading !== undefined && Number.parseInt(leading, 10) === phase;
		});
		if (phaseOption !== undefined) {
			await ghProjectItemEdit(itemId, project.project.id, project.phaseField.id, phaseOption.id);
		}
	}

	const priorityOption = project.priorityField.options.find((o) => o.name === priority);
	if (priorityOption !== undefined) {
		await ghProjectItemEdit(
			itemId,
			project.project.id,
			project.priorityField.id,
			priorityOption.id,
		);
	}

	return {
		id: itemId,
		taskId,
		title,
		status: undefined,
		workflow: undefined,
		phase: phase !== undefined ? String(phase) : undefined,
		priority,
	};
}

export { applyWorkflowUpdates, createProjectItem, loadProjectContext };
