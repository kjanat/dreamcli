/**
 * Shared command execution seam.
 *
 * Centralizes the parse -> resolve -> plugin -> handler pipeline so CLI and
 * testkit can converge on one owned execution path during the re-foundation.
 *
 * @module dreamcli/core/execution
 * @internal
 */

import { builtinEnabled } from '#internals/core/cli/builtins.ts';
import type {
	BeforeParseParams,
	CLIPlugin,
	ResolvedCommandParams,
} from '#internals/core/cli/plugin.ts';
import { CLIError, ParseError } from '#internals/core/errors/index.ts';
import {
	loadJsonSchema,
	loadPromptSession,
	loadTestPrompter,
} from '#internals/core/feature-loaders.ts';
import { formatHelp, formatHelpTopic } from '#internals/core/help/index.ts';
import type { CapturedOutput } from '#internals/core/output/index.ts';
import { clearRequestedExitCode, getRequestedExitCode } from '#internals/core/output/index.ts';
import { copyTransformedArgv, sliceArgv } from '#internals/core/parse/argv-boundaries.ts';
import type { ParseContext } from '#internals/core/parse/context.ts';
import {
	parseForExecution,
	pendingFlagErrors,
	requestedHelpMode,
} from '#internals/core/parse/index.ts';
import type { Ask } from '#internals/core/prompt/definitions.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import type { PromptSession } from '#internals/core/prompt/session.ts';
import type { TestAnswer } from '#internals/core/prompt/test-prompter.ts';
import type {
	DeprecationWarning,
	ResolveOptions,
	ResolveResult,
	SkippedPathCheck,
} from '#internals/core/resolve/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import type {
	CommandMeta,
	CommandSchema,
	ErasedActionHandler,
	ExecutionStep,
	Out,
} from '#internals/core/schema/command.ts';
import type { InternalRunOptions, RunResult } from '#internals/core/schema/run.ts';
import { invocationSelectsStdin } from '#internals/core/schema/source.ts';
import { validateCommandInputs } from './constraints.ts';

/**
 * The executable half of a command: what to run, and what wraps it.
 *
 * The schema travels on the request instead, already merged with propagated
 * ancestor flags.
 * @internal
 */
interface ExecutableCommand {
	/** Action handler, `undefined` when the command declares none. */
	readonly handler: ErasedActionHandler | undefined;
	/** Derive and middleware steps in registration order. */
	readonly steps: readonly ExecutionStep[];
}

/**
 * Explicit executor input for a single command invocation.
 * @internal
 */
interface CommandExecutionRequest {
	/** The handler and execution steps to run. */
	readonly command: ExecutableCommand;
	/** Raw argument tokens to parse (excluding the program name). */
	readonly argv: readonly string[];
	/** Output channel for handler and error rendering. */
	readonly out: Out;
	/** Frozen schema definition (flags, args, metadata) for parsing and resolution. */
	readonly schema: CommandSchema;
	/** Runtime metadata (binary name, version) propagated to the handler. */
	readonly meta: CommandMeta;
	/** Optional overrides for env, config, prompter, plugins, and JSON mode. */
	readonly options?: InternalRunOptions;
}

/**
 * Minimal executor result before output buffers are assembled into `RunResult`.
 * @internal
 */
interface CommandExecutionResult {
	/** Process exit code (`0` on success, error-specific otherwise). */
	readonly exitCode: number;
	/** The structured error if the command failed, `undefined` on success. */
	readonly error: CLIError | undefined;
	/**
	 * Path checks resolution could not run. Absent when execution never reached
	 * resolution, which {@link buildRunResult} reports as an empty list.
	 */
	readonly skippedPathChecks?: readonly SkippedPathCheck[];
}

/**
 * Run the full parse -> resolve -> plugin -> handler pipeline for one command.
 *
 * Handles `--help` short-circuit, plugin lifecycle hooks, deprecation warnings,
 * and error wrapping. Both CLI dispatch and testkit `runCommand` converge here.
 * @internal
 */
async function executeCommand(
	request: CommandExecutionRequest,
	prepared?: PreparedCommandInputs,
): Promise<CommandExecutionResult> {
	const { command, meta, options, out, schema } = request;
	if (!prepared) clearRequestedExitCode(out);
	// Filled once resolution completes, so a handler failure after a skipped
	// check still reports the skip alongside the error.
	let skippedPathChecks: readonly SkippedPathCheck[] = [];

	try {
		const helpMode = prepared ? undefined : commandHelpMode(request);
		if (helpMode !== undefined) {
			// `options.jsonMode` carries the resolved JSON mode from the CLI/testkit
			// layer (root `--json` is stripped from argv pre-dispatch) — an injected
			// `out` may predate it, so the channel flag alone is not authoritative.
			if (out.jsonMode || options?.jsonMode === true) {
				const { generateCommandSchema } = await loadJsonSchema();
				out.json(
					generateCommandSchema(
						schema,
						{ envPrefix: options?.envPrefix, groupOrder: options?.help?.groupOrder },
						{
							name: options?.help?.binName ?? schema.name,
							version: options?.help?.version,
						},
					),
				);
				return { exitCode: 0, error: undefined };
			}
			// Standalone `cmd.run()` / testkit paths reach here without the CLI
			// builder's help merge — default the palette from the output channel.
			// Help names the variables resolution reads, so a run-level namespace
			// reaches the annotations unless the help options already carry one,
			// and help spells flags the way this run's parser accepts them.
			const caseParity = options?.flags?.caseParity ?? options?.help?.caseParity;
			const width = options?.help?.width ?? out.terminalSize?.columns;
			const help = {
				...options?.help,
				...(width !== undefined ? { width } : {}),
				...(helpMode === 'all' ? { showAdvanced: true } : {}),
				...(options?.envPrefix !== undefined && options.help?.envPrefix === undefined
					? { envPrefix: options.envPrefix }
					: {}),
				...(caseParity !== undefined ? { caseParity } : {}),
			};
			const renderOptions = help.colors !== undefined ? help : { ...help, colors: out.color };
			if (typeof helpMode === 'object') {
				const helpText = formatHelpTopic(schema, helpMode.group, renderOptions);
				if (helpText === undefined) {
					throw new CLIError(
						`Help topic '${helpMode.name}' has no flags in group '${helpMode.group}'`,
						{
							code: 'INVALID_SCHEMA',
							details: { command: schema.name, topic: helpMode.name, group: helpMode.group },
						},
					);
				}
				out.log(helpText);
			} else {
				out.log(formatHelp(schema, renderOptions));
			}
			return { exitCode: 0, error: undefined };
		}

		const handler = command.handler;
		if (handler === undefined) {
			const error = missingActionError(schema);
			out.error(error.message);
			return { exitCode: 1, error };
		}

		const inputs = prepared ?? (await prepareCommandInputs(request));
		if (inputs.kind === 'command-error') throw inputs.error;
		const { resolved, parse, effectivePrompter } = inputs;
		skippedPathChecks = resolved.skippedPathChecks;
		const resolvedParams: ResolvedCommandParams = {
			parse,
			args: resolved.args,
			flags: resolved.flags,
			deprecations: resolved.deprecations,
			skippedPathChecks,
			command: schema,
			meta,
			out,
		};

		await runResolvedHooks(options?.plugins, 'afterResolve', resolvedParams);
		if (schema.constraints !== undefined || schema.validators !== undefined) {
			await validateCommandInputs(schema, resolved);
		}

		for (const deprecation of resolved.deprecations) {
			out.warn(formatDeprecation(deprecation));
		}

		await runResolvedHooks(options?.plugins, 'beforeAction', resolvedParams);
		let session: Promise<PromptSession> | undefined;
		const ask: Ask = async (config) => {
			out.stopActive();
			session ??= loadPromptSession().then((createPromptSession) =>
				createPromptSession({
					...(effectivePrompter !== undefined ? { prompter: effectivePrompter } : {}),
					write: (text) => out.error(text.replace(/\n$/, '')),
				}),
			);
			return (await session).ask(config);
		};
		await executeWithExecutionSteps(command, handler, resolved, parse, out, meta, ask);
		await runResolvedHooks(options?.plugins, 'afterAction', resolvedParams);

		return { exitCode: getRequestedExitCode(out) ?? 0, error: undefined, skippedPathChecks };
	} catch (error: unknown) {
		const failure = asCLIError(error);
		if (options?.jsonMode === true) {
			out.json({ error: failure.toJSON() });
		} else {
			out.error(failure.message);
			if (failure.suggest !== undefined) out.error(`Suggestion: ${failure.suggest}`);
		}
		return { exitCode: failure.exitCode, error: failure, skippedPathChecks };
	} finally {
		out.stopActive();
		clearRequestedExitCode(out);
	}
}

function commandHelpMode({ options, argv, schema }: CommandExecutionRequest) {
	return builtinEnabled(options?.builtins, 'help')
		? requestedHelpMode(argv, schema.helpTopics)
		: undefined;
}

function missingActionError(schema: CommandSchema): CLIError {
	return new CLIError(`Command '${schema.name}' has no action handler`, {
		code: 'NO_ACTION',
		suggest: `Add an .action() handler to the '${schema.name}' command`,
	});
}

function asCLIError(error: unknown): CLIError {
	return error instanceof CLIError
		? error
		: new CLIError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, {
				code: 'UNEXPECTED_ERROR',
				cause: error,
			});
}

interface PreparedCommandInputs {
	readonly kind: 'prepared';
	readonly parse: ParseContext;
	readonly resolved: ResolveResult;
	readonly effectivePrompter: PromptEngine | undefined;
}

/** @internal Prepare once for immediate or deferred execution. */
async function prepareCommandInputs({ argv, meta, options, out, schema }: CommandExecutionRequest) {
	let parse: ParseContext | undefined;
	try {
		const transformed = await prepareCommandArgv(options?.plugins, {
			argv,
			command: schema,
			meta,
			out,
		});

		const { parsed, context } = parseForExecution(
			schema,
			transformed.argv,
			transformed.metadata,
			options?.flags,
		);
		parse = context;
		const stdinData =
			options?.readStdin &&
			!pendingFlagErrors(parsed.flags)?.size &&
			invocationSelectsStdin(schema.flags, schema.args, parsed)
				? await options.readStdin()
				: options?.stdinData;

		const effectivePrompter = options?.prompter ?? (await scriptedPrompter(options?.answers));
		const resolveOptions: ResolveOptions = {
			...(stdinData !== undefined ? { stdinData } : {}),
			...(options?.env !== undefined ? { env: options.env } : {}),
			...(options?.config !== undefined ? { config: options.config } : {}),
			...(effectivePrompter !== undefined ? { prompter: effectivePrompter } : {}),
			...(options?.stat !== undefined ? { stat: options.stat } : {}),
			...(options?.mkdir !== undefined ? { mkdir: options.mkdir } : {}),
			...(options?.pathChecks !== undefined ? { pathChecks: options.pathChecks } : {}),
			...(options?.envPrefix !== undefined ? { envPrefix: options.envPrefix } : {}),
		};
		const resolved = await resolve(schema, parsed, resolveOptions);
		return {
			kind: 'prepared' as const,
			resolved,
			parse,
			effectivePrompter,
		} satisfies PreparedCommandInputs;
	} catch (error) {
		const stage: 'parse' | 'resolve' =
			parse === undefined || error instanceof ParseError ? 'parse' : 'resolve';
		return {
			kind: 'command-error' as const,
			stage,
			error: asCLIError(error),
			...(parse ? { parse } : {}),
		};
	}
}

type ResolvedHookName = Exclude<keyof CLIPlugin['hooks'], 'beforeParse' | 'transformArgv'>;

async function scriptedPrompter(
	answers: readonly TestAnswer[] | undefined,
): Promise<PromptEngine | undefined> {
	if (answers === undefined) return undefined;
	const createTestPrompter = await loadTestPrompter();
	return createTestPrompter(answers);
}

const emptyMetadata: Readonly<Record<string, unknown>> = Object.freeze({ __proto__: null });

async function prepareCommandArgv(
	plugins: readonly CLIPlugin[] | undefined,
	params: BeforeParseParams,
) {
	let argv = params.argv;
	let metadata = emptyMetadata;
	if (!plugins?.length) return { argv, metadata };

	for (const { hooks } of plugins) {
		const { beforeParse } = hooks;
		if (beforeParse !== undefined) await beforeParse(params);
	}
	for (const { hooks } of plugins) {
		if (!hooks.transformArgv) continue;
		if (argv === params.argv) argv = Object.freeze(sliceArgv(argv, 0));
		const result = await hooks.transformArgv({ ...params, argv, metadata });
		if (result?.argv !== undefined && result.argv !== argv) {
			argv = Object.freeze(copyTransformedArgv(argv, result.argv));
		}
		if (result?.metadata !== undefined) {
			metadata = Object.freeze({ __proto__: null, ...metadata, ...result.metadata });
		}
	}
	return { argv, metadata };
}

async function runResolvedHooks(
	plugins: readonly CLIPlugin[] | undefined,
	hookName: ResolvedHookName,
	params: ResolvedCommandParams,
): Promise<void> {
	if (plugins === undefined) return;
	for (const current of plugins) {
		const hook = current.hooks[hookName];
		if (hook !== undefined) await hook(params);
	}
}

async function executeWithExecutionSteps(
	command: ExecutableCommand,
	handler: NonNullable<ExecutableCommand['handler']>,
	resolved: ResolveResult,
	parse: ParseContext,
	out: Out,
	meta: CommandMeta,
	ask: Ask,
): Promise<void> {
	const steps = command.steps;
	const { args, flags } = resolved;
	const params = { args, flags, sources: resolved.provenance, parse, out, meta, ask };

	type ChainFn = (ctx: Readonly<Record<string, unknown>>) => Promise<void>;

	let chain: ChainFn = async (ctx) => {
		await handler({ ...params, ctx });
	};

	for (let i = steps.length - 1; i >= 0; i--) {
		const step = steps[i];
		if (step === undefined) continue;
		const downstream = chain;
		switch (step.kind) {
			case 'derive':
				chain = async (ctx) => {
					const additions = await step.handler({ ...params, ctx });
					if (additions === undefined) {
						await downstream(ctx);
						return;
					}
					if (typeof additions !== 'object' || additions === null || Array.isArray(additions)) {
						throw new CLIError('derive() must return an object or undefined', {
							code: 'INVALID_BUILDER_STATE',
							suggest:
								'Return an object to add context, or return nothing for validation-only derive handlers',
						});
					}
					await downstream({ ...ctx, ...additions });
				};
				break;
			case 'middleware':
				chain = async (ctx) => {
					await step.handler({
						...params,
						ctx,
						next: async (additions) => {
							await downstream({ ...ctx, ...additions });
						},
					});
				};
				break;
		}
	}

	await chain({});
}

/**
 * Assemble a {@linkcode CommandExecutionResult} and captured output buffers into a public `RunResult`.
 * @internal
 */
function buildRunResult(result: CommandExecutionResult, captured: CapturedOutput): RunResult {
	return {
		exitCode: result.exitCode,
		stdout: captured.stdout,
		stderr: captured.stderr,
		activity: captured.activity,
		error: result.error,
		skippedPathChecks: result.skippedPathChecks ?? [],
	};
}

function formatDeprecation(deprecation: DeprecationWarning): string {
	const entity =
		deprecation.kind === 'flag' ? `flag --${deprecation.name}` : `argument <${deprecation.name}>`;
	return typeof deprecation.message === 'string'
		? `Warning: ${entity} is deprecated: ${deprecation.message}`
		: `Warning: ${entity} is deprecated`;
}

export type { CommandExecutionRequest, CommandExecutionResult, ExecutableCommand };
export {
	buildRunResult,
	commandHelpMode,
	executeCommand,
	missingActionError,
	prepareCommandInputs,
};
