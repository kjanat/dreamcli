/**
 * CLI plugin lifecycle hooks.
 *
 * Plugins attach to `CLIBuilder` and observe command execution at stable
 * points: before parse, after resolve, before action, and after action.
 *
 * @module dreamcli/core/cli/plugin
 */

import type { DeprecationWarning } from '../resolve/index.ts';
import type { CommandMeta, CommandSchema, Out } from '../schema/command.ts';

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

/** Individual lifecycle hooks that a plugin may implement. */
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

/** Immutable plugin definition registered via `CLIBuilder.plugin()`. */
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
 */
function plugin(hooks: CLIPluginHooks, name?: string): CLIPlugin {
	return { hooks, ...(name !== undefined ? { name } : { name: undefined }) };
}

export type {
	BeforeParseParams,
	CLIPlugin,
	CLIPluginHooks,
	PluginCommandContext,
	ResolvedCommandParams,
};
export { plugin };
