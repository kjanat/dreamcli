/**
 * Test harness: command.run() with injected state, output capture.
 *
 * Provides `runCommand()` — the core execution pipeline that parses argv,
 * resolves values (CLI → env → config → default), creates an output channel,
 * and invokes the action handler. Returns a structured `RunResult` with
 * exitCode and captured output.
 *
 * `CommandBuilder.run()` delegates to `runCommand()`, making commands
 * testable without touching process state.
 *
 * @module dreamcli/core/testkit
 */

import type { BeforeParseParams, CLIPlugin, ResolvedCommandParams } from '../cli/plugin.ts';
import { CLIError } from '../errors/index.ts';
import type { HelpOptions } from '../help/index.ts';
import { formatHelp } from '../help/index.ts';
import type { CapturedOutput, Verbosity } from '../output/index.ts';
import { createCaptureOutput } from '../output/index.ts';
import { parse } from '../parse/index.ts';
import type { PromptEngine, TestAnswer } from '../prompt/index.ts';
import { createTestPrompter } from '../prompt/index.ts';
import type { DeprecationWarning, ResolveOptions } from '../resolve/index.ts';
import { resolve } from '../resolve/index.ts';
import type { ArgBuilder, ArgConfig } from '../schema/arg.ts';
import type {
	ActionHandler,
	CommandBuilder,
	CommandMeta,
	CommandSchema,
	Out,
} from '../schema/command.ts';
import type { FlagBuilder, FlagConfig } from '../schema/flag.ts';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * The runtime shape of action handler params — unbranded.
 *
 * This is what `ActionParams<F, A>` looks like after type erasure.
 * Used at the phantom-type boundary in `invokeHandler`.
 *
 * @internal
 */
interface HandlerParams {
	readonly flags: Readonly<Record<string, unknown>>;
	readonly args: Readonly<Record<string, unknown>>;
	readonly ctx: Readonly<Record<string, unknown>>;
	readonly out: Out;
	readonly meta: CommandMeta;
}

// ---------------------------------------------------------------------------
// Run options — injectable runtime state for testing
// ---------------------------------------------------------------------------

/**
 * Options accepted by `commandBuilder.run()` and `runCommand()`.
 *
 * Every field is optional — sensible defaults are applied. This is the
 * primary testing seam: inject env, config, I/O writers, etc. without
 * touching process state.
 */
interface RunOptions {
	/**
	 * Environment variables for flag resolution.
	 *
	 * Flags with `.env('VAR')` configured resolve from this record
	 * when no CLI value is provided (CLI → env → config → prompt → default).
	 */
	readonly env?: Readonly<Record<string, string | undefined>>;

	/**
	 * Configuration object for flag resolution.
	 *
	 * Flags with `.config('path')` configured resolve from this record
	 * when no CLI or env value is provided (CLI → env → config → prompt → default).
	 * Config is plain JSON — file loading is the caller's responsibility.
	 */
	readonly config?: Readonly<Record<string, unknown>>;

	/**
	 * Full stdin contents for args configured with `.stdin()`.
	 *
	 * Lets tests inject piped input without a runtime adapter.
	 */
	readonly stdinData?: string | null;

	/**
	 * Prompt engine for interactive flag resolution.
	 *
	 * When provided, flags with `.prompt()` configured that have no value
	 * after CLI/env/config resolution will be prompted interactively.
	 *
	 * When absent (and `answers` is also absent), prompting is skipped
	 * and resolution falls through to default/required.
	 *
	 * Takes precedence over `answers` when both are provided.
	 */
	readonly prompter?: PromptEngine;

	/**
	 * Pre-configured prompt answers for testing convenience.
	 *
	 * When provided, a test prompter is created from these answers via
	 * `createTestPrompter(answers)`. Each entry is consumed in order —
	 * use `PROMPT_CANCEL` to simulate cancellation.
	 *
	 * Ignored when an explicit `prompter` is provided.
	 *
	 * @example
	 * ```ts
	 * const result = await runCommand(cmd, [], {
	 *   answers: ['eu', true],
	 * });
	 * ```
	 */
	readonly answers?: readonly TestAnswer[];

	/**
	 * Verbosity level for the output channel.
	 * @default 'normal'
	 */
	readonly verbosity?: Verbosity;

	/**
	 * Enable JSON output mode.
	 *
	 * When `true`, `log` and `info` messages are redirected to stderr
	 * so that stdout is reserved exclusively for structured `json()` output.
	 * Errors are also rendered as JSON to stderr.
	 *
	 * @default false
	 */
	readonly jsonMode?: boolean;

	/**
	 * Whether stdout is connected to a TTY.
	 *
	 * Handlers can check `out.isTTY` to decide whether to emit decorative
	 * output (spinners, progress bars, ANSI codes). Defaults to `false`
	 * (safe default for tests — non-TTY until proven otherwise).
	 *
	 * @default false
	 */
	readonly isTTY?: boolean;

	/**
	 * Output channel override used by live CLI execution.
	 *
	 * @internal — `run()` passes a real output channel so activity renders to
	 * the terminal instead of being captured.
	 */
	readonly out?: Out;

	/**
	 * Capture buffers override paired with `out`.
	 *
	 * @internal — when omitted, `runCommand()` creates empty buffers for the
	 * returned `RunResult` while writing directly to the provided `out`.
	 */
	readonly captured?: CapturedOutput;

	/**
	 * Help formatting options (width, binName).
	 * Used when `--help` is detected.
	 */
	readonly help?: HelpOptions;

	/**
	 * Command schema with propagated flags merged in.
	 *
	 * When provided, used for parsing and resolution instead of `cmd.schema`.
	 * Set by the CLI dispatch layer after collecting propagated flags from
	 * the command ancestry path.
	 *
	 * @internal — set by dispatch layer, not for public use.
	 */
	readonly mergedSchema?: CommandSchema;

	/**
	 * CLI program metadata passed to action handlers and middleware.
	 *
	 * When provided (by CLI dispatch layer), handlers receive this as `meta`.
	 * When absent (standalone `runCommand()`), a minimal meta is constructed
	 * from the command's own schema.
	 *
	 * @internal — populated by CLI dispatch, not for public use.
	 */
	readonly meta?: CommandMeta;

	/**
	 * CLI plugins registered on the parent `CLIBuilder`.
	 *
	 * @internal — threaded through from CLI dispatch.
	 */
	readonly plugins?: readonly CLIPlugin[];
}

// ---------------------------------------------------------------------------
// Run result — re-exported from schema layer (canonical definition)
// ---------------------------------------------------------------------------

// RunResult is defined in schema/run.ts to avoid the schema→testkit dependency
// inversion. Re-exported here for public API continuity.
import type { RunResult } from '../schema/run.ts';

// ---------------------------------------------------------------------------
// Core execution pipeline
// ---------------------------------------------------------------------------

/**
 * Run a command builder against the given argv with injected options.
 *
 * This is the core execution pipeline:
 * 1. Detect `--help` / `-h` → print help text, exit 0
 * 2. Parse argv against the command schema
 * 3. Resolve values (CLI → env → config → default)
 * 4. Create a capture output channel
 * 5. Invoke the action handler
 * 6. Return structured result
 *
 * All errors are caught and converted to structured `RunResult`s with
 * appropriate exit codes. The function never throws.
 *
 * @param cmd - The command builder (must have an action handler)
 * @param argv - Raw argv strings (NOT including the command name itself)
 * @param options - Injectable runtime state
 * @returns Structured run result with exit code and captured output
 */
async function runCommand<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown> = Record<string, never>,
>(cmd: CommandBuilder<F, A, C>, argv: readonly string[], options?: RunOptions): Promise<RunResult> {
	let out: Out;
	let captured: CapturedOutput;
	if (options?.out !== undefined) {
		out = options.out;
		captured = options.captured ?? { stdout: [], stderr: [], activity: [] };
	} else {
		const captureOptions = {
			...(options?.verbosity !== undefined ? { verbosity: options.verbosity } : {}),
			...(options?.jsonMode !== undefined ? { jsonMode: options.jsonMode } : {}),
			...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
		};
		[out, captured] = createCaptureOutput(
			Object.keys(captureOptions).length > 0 ? captureOptions : undefined,
		);
	}

	// Use merged schema (with propagated flags) when provided by dispatch layer,
	// otherwise fall back to the command's own schema.
	const schema = options?.mergedSchema ?? cmd.schema;
	const meta: CommandMeta = options?.meta ?? {
		name: schema.name,
		bin: options?.help?.binName ?? schema.name,
		version: undefined,
		command: schema.name,
	};

	// -- Help detection -------------------------------------------------------
	if (argv.includes('--help') || argv.includes('-h')) {
		const helpText = formatHelp(schema, options?.help);
		out.log(helpText);
		return buildResult(0, captured, undefined);
	}

	// -- No action handler → error -------------------------------------------
	if (!cmd.handler) {
		const err = new CLIError(`Command '${cmd.schema.name}' has no action handler`, {
			code: 'NO_ACTION',
			suggest: `Add an .action() handler to the '${cmd.schema.name}' command`,
		});
		out.error(err.message);
		return buildResult(1, captured, err);
	}

	try {
		await runBeforeParseHooks(options?.plugins, {
			argv,
			command: schema,
			meta,
			out,
		});

		// -- Parse ---------------------------------------------------------------
		const parsed = parse(schema, argv);

		// -- Resolve -------------------------------------------------------------
		// Determine the prompt engine: explicit prompter takes precedence,
		// then answers convenience shortcut, then nothing (prompts skipped).
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

		// -- Deprecation warnings ------------------------------------------------
		for (const d of resolved.deprecations) {
			out.warn(formatDeprecation(d));
		}

		// -- Execute middleware chain + handler -----------------------------------
		// The resolver guarantees that resolved.flags and resolved.args match
		// the shape declared by the command's flag/arg builders. The phantom
		// types on CommandBuilder<F, A> are erased at runtime — the handler
		// is just a function accepting a plain object. `executeWithMiddleware`
		// runs the middleware chain then invokes the handler at the end.
		await runResolvedHooks(options?.plugins, 'beforeAction', resolvedParams);
		await executeWithMiddleware(cmd.schema, cmd.handler, resolved.flags, resolved.args, out, meta);
		await runResolvedHooks(options?.plugins, 'afterAction', resolvedParams);

		return buildResult(0, captured, undefined);
	} catch (err: unknown) {
		if (err instanceof CLIError) {
			if (options?.jsonMode === true) {
				out.json({ error: err.toJSON() });
			} else {
				out.error(err.message);
				if (err.suggest !== undefined) {
					out.error(`Suggestion: ${err.suggest}`);
				}
			}
			return buildResult(err.exitCode, captured, err);
		}

		// Unknown error — wrap and exit 1
		const message = err instanceof Error ? err.message : String(err);
		const wrapped = new CLIError(`Unexpected error: ${message}`, {
			code: 'UNEXPECTED_ERROR',
			cause: err,
		});
		if (options?.jsonMode === true) {
			out.json({ error: wrapped.toJSON() });
		} else {
			out.error(wrapped.message);
		}
		return buildResult(1, captured, wrapped);
	} finally {
		// Clean up any active spinner/progress timer that the handler
		// failed to stop (e.g. unhandled exception before terminal method).
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute the middleware chain followed by the action handler.
 *
 * Builds a continuation chain: each middleware's `next()` calls the next
 * middleware, with the final `next()` invoking the action handler.
 * Context accumulates via `{ ...ctx, ...additions }` at each step.
 *
 * This is the sole point where we bridge the phantom-type gap. The
 * parse→resolve pipeline guarantees the runtime values match the schema;
 * the phantom types guarantee the handler expects that schema.
 *
 * @internal
 */
async function executeWithMiddleware<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown>,
>(
	schema: CommandSchema,
	handler: ActionHandler<F, A, C>,
	flags: Readonly<Record<string, unknown>>,
	args: Readonly<Record<string, unknown>>,
	out: Out,
	meta: CommandMeta,
): Promise<void> {
	const middlewares = schema.middleware;

	// Terminal action — receives the final accumulated context.
	type ChainFn = (ctx: Readonly<Record<string, unknown>>) => Promise<void>;

	let chain: ChainFn = async (ctx) => {
		const params: HandlerParams = { flags, args, ctx, out, meta };
		// Phantom-type erasure: handler is (params: object) => void | Promise<void> at runtime.
		await (handler as (p: HandlerParams) => void | Promise<void>)(params);
	};

	// Wrap from back to front so the first registered middleware is outermost.
	for (let i = middlewares.length - 1; i >= 0; i--) {
		const mw = middlewares[i];
		if (mw === undefined) continue; // satisfy noUncheckedIndexedAccess
		const downstream = chain; // capture for closure
		chain = async (ctx) => {
			await mw({
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
	}

	// Start with empty context — middleware builds it up.
	await chain({});
}

/** Build a `RunResult` from parts. */
function buildResult(
	exitCode: number,
	captured: CapturedOutput,
	error: CLIError | undefined,
): RunResult {
	return {
		exitCode,
		stdout: captured.stdout,
		stderr: captured.stderr,
		activity: captured.activity,
		error,
	};
}

// ---------------------------------------------------------------------------
// Deprecation formatting (presentation layer — not resolve's responsibility)
// ---------------------------------------------------------------------------

/**
 * Format a structured deprecation warning for human-readable stderr output.
 *
 * This is a **consumer-side** formatting function — the resolve layer returns
 * structured `DeprecationWarning` data; consumers decide how to render it.
 *
 * @internal
 */
function formatDeprecation(d: DeprecationWarning): string {
	const entity = d.kind === 'flag' ? `flag --${d.name}` : `argument <${d.name}>`;
	return typeof d.message === 'string'
		? `Warning: ${entity} is deprecated: ${d.message}`
		: `Warning: ${entity} is deprecated`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { RunOptions, RunResult };
export { runCommand };
