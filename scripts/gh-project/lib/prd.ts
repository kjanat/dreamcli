/**
 * PRD state helpers for the GitHub project helper.
 *
 * @module
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
	compareTasks,
	expectRecord,
	fail,
	formatError,
	parseJson,
	readArray,
	readBoolean,
	readOptionalNumber,
	readOptionalString,
	readOptionalStringArray,
	readString,
} from './shared.ts';
import type { PrdFile, PrdState, PrdTask } from './types.ts';

function findStateDir(prdName: string): string {
	let dir = process.cwd();
	for (;;) {
		const candidate = resolve(dir, '.opencode', 'state', prdName);
		if (existsSync(resolve(candidate, 'prd.json'))) {
			return candidate;
		}

		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}

	return fail(
		`Could not find .opencode/state/${prdName}/prd.json from ${process.cwd()}`,
		'Run this script from the repo or a subdirectory inside it',
	);
}

async function readPrdState(prdName: string): Promise<PrdState> {
	const dir = findStateDir(prdName);
	const filePath = resolve(dir, 'prd.json');
	let text: string;
	try {
		text = await Bun.file(filePath).text();
	} catch (error) {
		return fail(`Failed to read ${filePath}: ${formatError(error)}`);
	}

	const payload = parseJson(text);
	const record = expectRecord(payload, 'PRD file');
	const tasksRaw = readArray(record, 'tasks', 'PRD file');
	const tasks: PrdTask[] = [];

	for (const taskValue of tasksRaw) {
		const task = expectRecord(taskValue, 'PRD task');
		tasks.push({
			id: readString(task, 'id', 'PRD task'),
			phase: readOptionalNumber(task, 'phase', 'PRD task'),
			title: readString(task, 'title', 'PRD task'),
			description: readString(task, 'description', 'PRD task'),
			depends: readOptionalStringArray(task, 'depends', 'PRD task'),
			priority: readString(task, 'priority', 'PRD task'),
			passes: readBoolean(task, 'passes', 'PRD task'),
			overseerId: readOptionalString(task, 'overseerId', 'PRD task'),
		});
	}

	const file: PrdFile = {
		prdName: readString(record, 'prdName', 'PRD file'),
		spec: readOptionalString(record, 'spec', 'PRD file'),
		description: readString(record, 'description', 'PRD file'),
		tasks,
	};

	return {
		dir,
		filePath,
		file,
		taskById: new Map(tasks.map((task) => [task.id, task])),
	};
}

async function writePrdState(state: PrdState, file: PrdFile): Promise<PrdState> {
	const text = `${JSON.stringify(file, null, '  ')}\n`;
	try {
		await Bun.write(state.filePath, text);
	} catch (error) {
		return fail(`Failed to write ${state.filePath}: ${formatError(error)}`);
	}

	return {
		...state,
		file,
		taskById: new Map(file.tasks.map((task) => [task.id, task])),
	};
}

async function markPrdTaskPassed(state: PrdState, taskId: string): Promise<PrdState> {
	const existing = state.taskById.get(taskId);
	if (existing === undefined) {
		return fail(`Task '${taskId}' not found in ${state.filePath}`);
	}
	if (existing.passes) {
		return state;
	}

	const nextTasks = state.file.tasks.map((task) =>
		task.id === taskId ? { ...task, passes: true } : task,
	);

	return writePrdState(state, { ...state.file, tasks: nextTasks });
}

function computeReadyTaskIds(prd: PrdFile, extraPassed: readonly string[] = []): readonly string[] {
	const passed = new Set<string>(prd.tasks.filter((task) => task.passes).map((task) => task.id));
	for (const taskId of extraPassed) {
		passed.add(taskId);
	}

	return prd.tasks
		.filter((task) => !passed.has(task.id) && (task.depends ?? []).every((dep) => passed.has(dep)))
		.sort(compareTasks)
		.map((task) => task.id);
}

export { computeReadyTaskIds, markPrdTaskPassed, readPrdState };
