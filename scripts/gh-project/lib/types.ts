/**
 * Shared types and constants for the GitHub project helper.
 *
 * @module
 */

const DEFAULT_OWNER = '@me';
const DEFAULT_PROJECT_NUMBER = 4;
const DEFAULT_PRD_NAME = 'dreamcli-re-foundation';
const ITEM_LIST_LIMIT = 100;

type ProjectStatus = 'Todo' | 'In Progress' | 'Done';
type Workflow = 'Backlog' | 'Ready' | 'In Progress' | 'Blocked' | 'Done';

interface ProjectView {
	readonly id: string;
	readonly url: string;
}

interface StatusOption {
	readonly id: string;
	readonly name: ProjectStatus;
}

interface StatusField {
	readonly id: string;
	readonly options: readonly StatusOption[];
}

interface WorkflowOption {
	readonly id: string;
	readonly name: Workflow;
}

interface WorkflowField {
	readonly id: string;
	readonly options: readonly WorkflowOption[];
}

interface FieldOption {
	readonly id: string;
	readonly name: string;
}

interface PhaseField {
	readonly id: string;
	readonly options: readonly FieldOption[];
}

interface PriorityField {
	readonly id: string;
	readonly options: readonly FieldOption[];
}

interface ProjectItem {
	readonly id: string;
	readonly taskId: string;
	readonly title: string;
	readonly status: string | undefined;
	readonly workflow: string | undefined;
	readonly phase: string | undefined;
	readonly priority: string | undefined;
}

interface ProjectContext {
	readonly owner: string;
	readonly projectNumber: number;
	readonly project: ProjectView;
	readonly statusField: StatusField;
	readonly workflowField: WorkflowField;
	readonly taskIdFieldId: string;
	readonly phaseField: PhaseField;
	readonly priorityField: PriorityField;
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
	readonly status: ProjectStatus;
	readonly previousStatus: string | undefined;
	readonly workflow: Workflow;
	readonly previousWorkflow: string | undefined;
}

type ListRow = {
	taskId: string;
	passes: string;
	status: string;
	workflow: string;
	phase: string;
	priority: string;
	title: string;
};

export type {
	AppliedWorkflowUpdate,
	FieldOption,
	ListRow,
	PhaseField,
	PrdFile,
	PrdState,
	PrdTask,
	PriorityField,
	ProjectContext,
	ProjectItem,
	ProjectStatus,
	ProjectView,
	StatusField,
	StatusOption,
	Workflow,
	WorkflowField,
	WorkflowOption,
	WorkflowUpdate,
};
export { DEFAULT_OWNER, DEFAULT_PRD_NAME, DEFAULT_PROJECT_NUMBER, ITEM_LIST_LIMIT };
