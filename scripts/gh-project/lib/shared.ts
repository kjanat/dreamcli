/**
 * Shared helpers for the GitHub project helper.
 *
 * @module
 */

import { CLIError, flag } from 'dreamcli';
import type { ListRow, PrdState, PrdTask, ProjectContext, Workflow } from './types.ts';
import { DEFAULT_OWNER, DEFAULT_PRD_NAME, DEFAULT_PROJECT_NUMBER } from './types.ts';

function fail(message: string, suggest?: string): never {
	throw new CLIError(message, {
		code: 'GH_PROJECT_ERROR',
		exitCode: 1,
		...(suggest !== undefined ? { suggest } : {}),
	});
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function parseJson(text: string): unknown {
	return JSON.parse(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, context: string): Record<string, unknown> {
	if (!isRecord(value)) {
		return fail(`Expected ${context} to be an object`);
	}

	return value;
}

function readString(record: Record<string, unknown>, key: string, context: string): string {
	const value = record[key];
	if (typeof value !== 'string') {
		return fail(`Expected ${context}.${key} to be a string`);
	}

	return value;
}

function readOptionalString(
	record: Record<string, unknown>,
	key: string,
	context: string,
): string | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		return fail(`Expected ${context}.${key} to be a string when present`);
	}

	return value;
}

function readOptionalNumber(
	record: Record<string, unknown>,
	key: string,
	context: string,
): number | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fail(`Expected ${context}.${key} to be a finite number when present`);
	}

	return value;
}

function readBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
	const value = record[key];
	if (typeof value !== 'boolean') {
		return fail(`Expected ${context}.${key} to be a boolean`);
	}

	return value;
}

function readArray(
	record: Record<string, unknown>,
	key: string,
	context: string,
): readonly unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) {
		return fail(`Expected ${context}.${key} to be an array`);
	}

	return value;
}

function readOptionalStringArray(
	record: Record<string, unknown>,
	key: string,
	context: string,
): readonly string[] | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		return fail(`Expected ${context}.${key} to be an array when present`);
	}

	const entries: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string') {
			return fail(`Expected every ${context}.${key} entry to be a string`);
		}
		entries.push(entry);
	}

	return entries;
}

function parseWorkflow(raw: unknown): Workflow {
	if (typeof raw !== 'string') {
		return fail(
			'Workflow must be a string',
			'Use one of: Backlog, Ready, In Progress, Blocked, Done',
		);
	}

	switch (raw) {
		case 'Backlog':
		case 'Ready':
		case 'In Progress':
		case 'Blocked':
		case 'Done':
			return raw;
		default:
			return fail(
				`Unsupported workflow '${raw}'`,
				'Use one of: Backlog, Ready, In Progress, Blocked, Done',
			);
	}
}

function compareTasks(a: PrdTask, b: PrdTask): number {
	const phaseA = a.phase ?? Number.MAX_SAFE_INTEGER;
	const phaseB = b.phase ?? Number.MAX_SAFE_INTEGER;
	if (phaseA !== phaseB) {
		return phaseA - phaseB;
	}

	return a.title.localeCompare(b.title);
}

function extractPhaseRank(phase: string | undefined): number {
	if (phase === undefined) {
		return Number.MAX_SAFE_INTEGER;
	}

	const match = /^(\d+)/.exec(phase);
	if (match === null) {
		return Number.MAX_SAFE_INTEGER;
	}

	const capture = match[1];
	if (capture === undefined) {
		return Number.MAX_SAFE_INTEGER;
	}

	return Number.parseInt(capture, 10);
}

function priorityRank(priority: string | undefined): number {
	switch (priority) {
		case 'architecture':
			return 1;
		case 'integration':
			return 2;
		case 'spike':
			return 3;
		case 'standard':
			return 4;
		case 'polish':
			return 5;
		default:
			return 99;
	}
}

function buildListRows(project: ProjectContext, prd: PrdState): readonly ListRow[] {
	return [...prd.file.tasks]
		.sort(compareTasks)
		.map((task) => {
			const item = project.itemsByTaskId.get(task.id);
			return {
				taskId: task.id,
				passes: task.passes ? 'yes' : 'no',
				workflow: item?.workflow ?? 'missing',
				phase: item?.phase ?? (task.phase !== undefined ? String(task.phase) : '-'),
				priority: item?.priority ?? task.priority,
				title: item?.title ?? task.title,
			};
		})
		.sort((a, b) => {
			const phaseDelta = extractPhaseRank(a.phase) - extractPhaseRank(b.phase);
			if (phaseDelta !== 0) {
				return phaseDelta;
			}

			const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority);
			if (priorityDelta !== 0) {
				return priorityDelta;
			}

			return a.title.localeCompare(b.title);
		});
}

function ownerFlag() {
	return flag.string().default(DEFAULT_OWNER).describe('GitHub project owner');
}

function projectFlag() {
	return flag.number().default(DEFAULT_PROJECT_NUMBER).describe('GitHub project number');
}

function prdFlag() {
	return flag.string().default(DEFAULT_PRD_NAME).describe('PRD state name under .opencode/state');
}

export {
	buildListRows,
	compareTasks,
	expectRecord,
	fail,
	formatError,
	ownerFlag,
	parseJson,
	parseWorkflow,
	prdFlag,
	projectFlag,
	readArray,
	readBoolean,
	readOptionalNumber,
	readOptionalString,
	readOptionalStringArray,
	readString,
};
