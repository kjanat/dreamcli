/**
 * Shared types and constants for the GitHub project helper.
 *
 * @module
 */

const DEFAULT_OWNER = '@me';
const DEFAULT_PROJECT_NUMBER = 4;
const DEFAULT_PRD_NAME = 'dreamcli-re-foundation';
const ITEM_LIST_LIMIT = 100;

type Workflow = 'Backlog' | 'Ready' | 'In Progress' | 'Blocked' | 'Done';

interface ProjectView {
	readonly id: string;
	readonly url: string;
}

interface WorkflowOption {
	readonly id: string;
	readonly name: Workflow;
}

interface WorkflowField {
	readonly id: string;
	readonly options: readonly WorkflowOption[];
}

interface ProjectItem {
	readonly id: string;
	readonly taskId: string;
	readonly title: string;
	readonly workflow: string | undefined;
	readonly phase: string | undefined;
	readonly priority: string | undefined;
}

interface ProjectContext {
	readonly owner: string;
	readonly projectNumber: number;
	readonly project: ProjectView;
	readonly workflowField: WorkflowField;
	readonly items: readonly ProjectItem[];
	readonly itemsByTaskId: ReadonlyMap<string, ProjectItem>;
}

interface PrdTask {
	readonly id: string;
	readonly phase: number | undefined;
	readonly title: string;
	readonly description: string;
	readonly depends: readonly string[] | undefined;
	readonly priority: string;
	readonly passes: boolean;
	readonly overseerId: string | undefined;
}

interface PrdFile {
	readonly prdName: string;
	readonly spec: string | undefined;
	readonly description: string;
	readonly tasks: readonly PrdTask[];
}

interface PrdState {
	readonly dir: string;
	readonly filePath: string;
	readonly file: PrdFile;
	readonly taskById: ReadonlyMap<string, PrdTask>;
}

interface WorkflowUpdate {
	readonly taskId: string;
	readonly workflow: Workflow;
}

interface AppliedWorkflowUpdate {
	readonly taskId: string;
	readonly workflow: Workflow;
	readonly previousWorkflow: string | undefined;
}

type ListRow = {
	taskId: string;
	passes: string;
	workflow: string;
	phase: string;
	priority: string;
	title: string;
};

export type {
	AppliedWorkflowUpdate,
	ListRow,
	PrdFile,
	PrdState,
	PrdTask,
	ProjectContext,
	ProjectItem,
	ProjectView,
	Workflow,
	WorkflowField,
	WorkflowOption,
	WorkflowUpdate,
};
export { DEFAULT_OWNER, DEFAULT_PRD_NAME, DEFAULT_PROJECT_NUMBER, ITEM_LIST_LIMIT };
