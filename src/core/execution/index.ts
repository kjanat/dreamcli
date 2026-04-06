/**
 * Shared command execution seam.
 *
 * Centralizes the parse -> resolve -> plugin -> handler pipeline so CLI and
 * testkit can converge on one owned execution path during the re-foundation.
 *
 * @module dreamcli/core/execution
 * @internal
 */

import type {
	BeforeParseParams,
	CLIPlugin,
	ResolvedCommandParams,
} from '#internals/core/cli/plugin.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { formatHelp } from '#internals/core/help/index.ts';
import type { CapturedOutput } from '#internals/core/output/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { createTestPrompter } from '#internals/core/prompt/index.ts';
import type { DeprecationWarning, ResolveOptions } from '#internals/core/resolve/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import type {
	CommandMeta,
	CommandSchema,
	Out,
	RunnableCommand,
} from '#internals/core/schema/command.ts';
import type { RunOptions, RunResult } from '#internals/core/schema/run.ts';

/**
 * Explicit executor input for a single command invocation.
 * @internal
 */
interface CommandExecutionRequest {
	/** The command instance whose handler will be invoked. */
	readonly command: RunnableCommand;
	/** Raw argument tokens to parse (excluding the program name). */
	readonly argv: readonly string[];
	/** Output channel for handler and error rendering. */
	readonly out: Out;
	/** Frozen schema definition (flags, args, metadata) for parsing and resolution. */
	readonly schema: CommandSchema;
	/** Runtime metadata (binary name, version) propagated to the handler. */
	readonly meta: CommandMeta;
	/** Optional overrides for env, config, prompter, plugins, and JSON mode. */
	readonly options?: RunOptions;
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
}

/**
 * Run the full parse -> resolve -> plugin -> handler pipeline for one command.
 *
 * Handles `--help` short-circuit, plugin lifecycle hooks, deprecation warnings,
 * and error wrapping. Both CLI dispatch and testkit `runCommand` converge here.
 * @internal
 */
async function executeCommand(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
	const { argv, command, meta, options, out, schema } = request;

	try {
		if (includesBeforeSeparator(argv, '--help') || includesBeforeSeparator(argv, '-h')) {
			const helpText = formatHelp(schema, options?.help);
			out.log(helpText);
			return { exitCode: 0, error: undefined };
		}

		const handler = command.handler;
		if (handler === undefined) {
			const error = new CLIError(`Command '${command.schema.name}' has no action handler`, {
				code: 'NO_ACTION',
				suggest: `Add an .action() handler to the '${command.schema.name}' command`,
			});
			out.error(error.message);
			return { exitCode: 1, error };
		}

		await runBeforeParseHooks(options?.plugins, {
			argv,
			command: schema,
			meta,
			out,
		});

		const parsed = parse(schema, argv);

		const effectivePrompter =
			options?.prompter ??
			(options?.answers !== undefined ? createTestPrompter(options.answers) : undefined);
		const resolveOptions: ResolveOptions = {
			...(options?.stdinData !== undefined ? { stdinData: options.stdinData } : {}),
			...(options?.env !== undefined ? { env: options.env } : {}),
			...(options?.config !== undefined ? { config: options.config } : {}),
			...(effectivePrompter !== undefined ? { prompter: effectivePrompter } : {}),
		};
		const resolved = await resolve(schema, parsed, resolveOptions);
		const resolvedParams: ResolvedCommandParams = {
			args: resolved.args,
			flags: resolved.flags,
			deprecations: resolved.deprecations,
			command: schema,
			meta,
			out,
		};

		await runResolvedHooks(options?.plugins, 'afterResolve', resolvedParams);

		for (const deprecation of resolved.deprecations) {
			out.warn(formatDeprecation(deprecation));
		}

		await runResolvedHooks(options?.plugins, 'beforeAction', resolvedParams);
		await executeWithExecutionSteps(command, handler, resolved.flags, resolved.args, out, meta);
		await runResolvedHooks(options?.plugins, 'afterAction', resolvedParams);

		return { exitCode: 0, error: undefined };
	} catch (error: unknown) {
		if (error instanceof CLIError) {
			if (options?.jsonMode === true) {
				out.json({ error: error.toJSON() });
			} else {
				out.error(error.message);
				if (error.suggest !== undefined) {
					out.error(`Suggestion: ${error.suggest}`);
				}
			}
			return { exitCode: error.exitCode, error };
		}

		const message = error instanceof Error ? error.message : String(error);
		const wrapped = new CLIError(`Unexpected error: ${message}`, {
			code: 'UNEXPECTED_ERROR',
			cause: error,
		});
		if (options?.jsonMode === true) {
			out.json({ error: wrapped.toJSON() });
		} else {
			out.error(wrapped.message);
		}
		return { exitCode: 1, error: wrapped };
	} finally {
		out.stopActive();
	}
}

type ResolvedHookName = Exclude<keyof CLIPlugin['hooks'], 'beforeParse'>;

async function runBeforeParseHooks(
	plugins: readonly CLIPlugin[] | undefined,
	params: BeforeParseParams,
): Promise<void> {
	if (plugins === undefined) return;
	for (const current of plugins) {
		const hook = current.hooks.beforeParse;
		if (hook !== undefined) await hook(params);
	}
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
	command: RunnableCommand,
	handler: NonNullable<RunnableCommand['handler']>,
	flags: Readonly<Record<string, unknown>>,
	args: Readonly<Record<string, unknown>>,
	out: Out,
	meta: CommandMeta,
): Promise<void> {
	const steps = command._executionSteps;

	type ChainFn = (ctx: Readonly<Record<string, unknown>>) => Promise<void>;

	let chain: ChainFn = async (ctx) => {
		await handler({ flags, args, ctx, out, meta });
	};

	for (let i = steps.length - 1; i >= 0; i--) {
		const step = steps[i];
		if (step === undefined) continue;
		const downstream = chain;
		switch (step.kind) {
			case 'derive':
				chain = async (ctx) => {
					const additions = await step.handler({ args, flags, ctx, out, meta });
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
						args,
						flags,
						ctx,
						out,
						meta,
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
	};
}

function formatDeprecation(deprecation: DeprecationWarning): string {
	const entity =
		deprecation.kind === 'flag' ? `flag --${deprecation.name}` : `argument <${deprecation.name}>`;
	return typeof deprecation.message === 'string'
		? `Warning: ${entity} is deprecated: ${deprecation.message}`
		: `Warning: ${entity} is deprecated`;
}

function includesBeforeSeparator(argv: readonly string[], token: string): boolean {
	for (const arg of argv) {
		if (arg === '--') return false;
		if (arg === token) return true;
	}
	return false;
}

export type { CommandExecutionRequest, CommandExecutionResult };
export { buildRunResult, executeCommand };
