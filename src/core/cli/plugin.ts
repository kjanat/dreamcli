/**
 * CLI plugin lifecycle hooks.
 *
 * Plugins attach to `CLIBuilder` and observe command execution at stable
 * points: before parse, after resolve, before action, and after action.
 *
 * @module dreamcli/core/cli/plugin
 */

import type { ParseContext } from '#internals/core/parse/context.ts';
import type { DeprecationWarning, SkippedPathCheck } from '#internals/core/resolve/index.ts';
import type { CommandMeta, CommandSchema, Out } from '#internals/core/schema/command.ts';

/** Shared hook payload for a concrete command execution. */
interface PluginCommandContext {
	/** Runtime command schema being executed. */
	readonly command: CommandSchema;
	/** CLI metadata for this execution. */
	readonly meta: CommandMeta;
	/** Output channel for this execution. */
	readonly out: Out;
}

/** Payload for `beforeParse`. */
interface BeforeParseParams extends PluginCommandContext {
	/** Leaf-command argv as dispatched, before any plugin transforms. */
	readonly argv: readonly string[];
}

/** Inputs for one plugin's leaf-command argv transform. */
interface TransformArgvParams extends BeforeParseParams {
	/** Shallow, read-only snapshot of metadata contributed by earlier transforms. */
	readonly metadata: Readonly<Record<string, unknown>>;
}

/** Changes returned by a transform. Omitted fields retain their previous values. */
interface TransformArgvResult {
	/** Replacement leaf-command arguments, in parser order. An empty array clears them. */
	readonly argv?: readonly string[];
	/** Top-level entries to merge into parse.metadata. Later transforms win on key collisions. */
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Payload for hooks that observe resolved inputs. */
interface ResolvedCommandParams extends PluginCommandContext {
	/** Flag spellings observed in this command invocation. */
	readonly parse: ParseContext;
	/** Fully resolved flag values. */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Fully resolved argument values. */
	readonly args: Readonly<Record<string, unknown>>;
	/** Structured deprecation warnings collected during resolution. */
	readonly deprecations: readonly DeprecationWarning[];
	/**
	 * Declared `flag.path()` / `arg.path()` checks that could not run because
	 * execution supplied no `stat` probe (or no `mkdir` for `create`). Always
	 * empty under `CLIBuilder.run()`, which supplies the adapter's filesystem.
	 */
	readonly skippedPathChecks: readonly SkippedPathCheck[];
}

/**
 * Individual lifecycle hooks that a plugin may implement.
 *
 * Hook order for a successful command run is:
 * `beforeParse` → `transformArgv` → `afterResolve` → `beforeAction` → middleware/action → `afterAction`.
 *
 * Hooks are awaited serially and run in plugin registration order at each
 * stage. Throwing from any hook aborts the command just like throwing from
 * middleware or the action handler. `afterAction` runs only after the
 * middleware chain and action complete successfully.
 */
interface CLIPluginHooks {
	/** Observe the original leaf-command argv. Return values are ignored. */
	readonly beforeParse?: (params: BeforeParseParams) => void | Promise<void>;
	/** Rewrite leaf-command argv after all beforeParse observers have run. */
	readonly transformArgv?: (
		params: TransformArgvParams,
	) => void | TransformArgvResult | Promise<void | TransformArgvResult>;
	/** Called after parse + resolve, before middleware or action execution. */
	readonly afterResolve?: (params: ResolvedCommandParams) => void | Promise<void>;
	/** Called immediately before the middleware chain and action handler run. */
	readonly beforeAction?: (params: ResolvedCommandParams) => void | Promise<void>;
	/** Called after the middleware chain and action handler complete successfully. */
	readonly afterAction?: (params: ResolvedCommandParams) => void | Promise<void>;
}

/**
 * Immutable plugin definition registered via `CLIBuilder.plugin()`.
 *
 * Use {@link plugin} to construct values of this shape instead of manually
 * assembling the object.
 */
interface CLIPlugin {
	/** Optional label for diagnostics and debugging. */
	readonly name: string | undefined;
	/** Lifecycle hooks implemented by the plugin. */
	readonly hooks: CLIPluginHooks;
}

/**
 * Create a CLI plugin from lifecycle hooks.
 *
 * @param hooks - Lifecycle hooks to register.
 * @param name - Optional plugin name for diagnostics.
 *
 * @example
 * ```ts
 * import { cli, command, plugin } from '@kjanat/dreamcli';
 *
 * const deploy = command('deploy').action(({ out }) => {
 *   out.log('deploying');
 * });
 *
 * const trace = plugin(
 *   {
 *     beforeParse: ({ argv, out }) => {
 *       out.info(`argv: ${argv.join(' ')}`);
 *     },
 *     afterResolve: ({ flags, args }) => {
 *       console.log({ flags, args });
 *     },
 *   },
 *   'trace',
 * );
 *
 * cli('mycli').plugin(trace).command(deploy).run();
 * ```
 *
 * @returns A frozen {@link CLIPlugin} definition.
 */
function plugin(hooks: CLIPluginHooks, name?: string): CLIPlugin {
	const frozenHooks = Object.freeze({ ...hooks });
	return Object.freeze({ hooks: frozenHooks, name });
}

export type {
	BeforeParseParams,
	CLIPlugin,
	CLIPluginHooks,
	PluginCommandContext,
	ResolvedCommandParams,
	TransformArgvParams,
	TransformArgvResult,
};
export { plugin };
