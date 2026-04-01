/**
 * CLI plugin lifecycle hooks.
 *
 * Plugins attach to `CLIBuilder` and observe command execution at stable
 * points: before parse, after resolve, before action, and after action.
 *
 * @module dreamcli/core/cli/plugin
 */

import type { DeprecationWarning } from '#internals/core/resolve/index.ts';
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
	/** Raw argv that will be parsed for the leaf command. */
	readonly argv: readonly string[];
}

/** Payload for hooks that observe resolved inputs. */
interface ResolvedCommandParams extends PluginCommandContext {
	/** Fully resolved flag values. */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Fully resolved argument values. */
	readonly args: Readonly<Record<string, unknown>>;
	/** Structured deprecation warnings collected during resolution. */
	readonly deprecations: readonly DeprecationWarning[];
}

/**
 * Individual lifecycle hooks that a plugin may implement.
 *
 * Hook order for a successful command run is:
 * `beforeParse` → `afterResolve` → `beforeAction` → middleware/action → `afterAction`.
 *
 * Hooks are awaited serially and run in plugin registration order at each
 * stage. Throwing from any hook aborts the command just like throwing from
 * middleware or the action handler. `afterAction` runs only after the
 * middleware chain and action complete successfully.
 */
interface CLIPluginHooks {
	/** Called immediately before leaf-command argv is parsed. */
	readonly beforeParse?: (params: BeforeParseParams) => void | Promise<void>;
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
 * cli('mycli').plugin(trace).command(deploy);
 * ```
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
};
export { plugin };
