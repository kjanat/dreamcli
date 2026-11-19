/** @module dreamcli/core/cli/inspection */

import type { Shell } from '#internals/core/completion/shell.ts';
import type { CLIError } from '#internals/core/errors/index.ts';
import type { CommandExecutionRequest } from '#internals/core/execution/index.ts';
import {
	buildRunResult,
	commandHelpMode,
	executeCommand,
	missingActionError,
	prepareCommandInputs,
} from '#internals/core/execution/index.ts';
import type { CapturedOutput } from '#internals/core/output/index.ts';
import type { ParseContext } from '#internals/core/parse/context.ts';
import type { ResolveResult } from '#internals/core/resolve/index.ts';
import type { CommandMeta, CommandSchema } from '#internals/core/schema/command.ts';
import type { RunResult } from '#internals/core/schema/run.ts';
import type { CLISchema } from './index.ts';

/** Resolved inputs for a single invocation. Later execution stages run on demand. */
export interface InspectedCommand extends ResolveResult {
	readonly kind: 'match';
	/** Canonical command names from the outermost group to the selected command. */
	readonly path: readonly string[];
	/** Program and leaf-command identity. */
	readonly meta: CommandMeta;
	/** Flag occurrences and metadata from argv transforms. */
	readonly parse: ParseContext;
	/** Resume this invocation once. Repeated calls share its promise and captured result. */
	readonly execute: () => Promise<RunResult>;
}

/** Structured routing and input resolution outcome returned by CLIBuilder.inspect(). */
export type InspectResult =
	| InspectedCommand
	| { readonly kind: 'root-version'; readonly version: string }
	| { readonly kind: 'root-help'; readonly schema: CLISchema; readonly mode: 'short' | 'all' }
	| {
			readonly kind: 'command-help';
			readonly path: readonly string[];
			readonly schema: CommandSchema;
			readonly mode: 'short' | 'all' | { readonly name: string; readonly group: string };
	  }
	| { readonly kind: 'root-completions'; readonly shell: Shell }
	| { readonly kind: 'dynamic-completion'; readonly argv: readonly string[] }
	| { readonly kind: 'dispatch-error'; readonly error: CLIError }
	| {
			readonly kind: 'command-error';
			readonly path: readonly string[];
			readonly stage: 'parse' | 'resolve';
			readonly error: CLIError;
			readonly parse?: ParseContext;
	  };

/** @internal Inspect a routed command without entering the action lifecycle. */
export async function inspectCommand(
	request: CommandExecutionRequest,
	captured: CapturedOutput,
	path: readonly string[],
): Promise<InspectResult> {
	const mode = commandHelpMode(request);
	if (mode !== undefined) return { kind: 'command-help', path, schema: request.schema, mode };
	if (!request.command.handler)
		return { kind: 'dispatch-error', error: missingActionError(request.schema) };

	try {
		const prepared = await prepareCommandInputs(request);
		if (prepared.kind === 'command-error') return { ...prepared, path };
		let execution: Promise<RunResult> | undefined;
		return {
			kind: 'match',
			path,
			...prepared.resolved,
			meta: Object.freeze({ ...request.meta }),
			flags: Object.freeze({ ...prepared.resolved.flags }),
			args: Object.freeze({ ...prepared.resolved.args }),
			parse: prepared.parse,
			execute: () =>
				(execution ??= Promise.resolve()
					.then(() => executeCommand(request, prepared))
					.then((result) => buildRunResult(result, captured))),
		};
	} finally {
		request.out.stopActive();
	}
}
