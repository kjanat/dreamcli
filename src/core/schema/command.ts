/**
 * Command schema builder with flag/arg composition and type accumulation.
 *
 * The `command()` factory returns an immutable `CommandBuilder` whose generic
 * parameters track accumulated flag and arg builder types. Chaining `.flag()`
 * and `.arg()` calls produces progressively narrower types. The `.action()`
 * handler receives fully typed `{ args, flags, ctx, out }`.
 *
 * @module dreamcli/core/schema/command
 */

import type { ArgBuilder, ArgConfig, ArgSchema, InferArgs } from './arg.js';
import type { FlagBuilder, FlagConfig, FlagSchema, InferFlags } from './flag.js';
import type { PromptConfig } from './prompt.js';

// ---------------------------------------------------------------------------
// Type-level configuration (phantom state tracked through the chain)
// ---------------------------------------------------------------------------

/**
 * Compile-time state carried through the command builder chain.
 *
 * `F` accumulates named flag builders; `A` accumulates named arg builders.
 * Both start empty (`{}`) and grow as `.flag()` / `.arg()` are called.
 */
interface CommandConfig {
	readonly flags: Record<string, FlagBuilder<FlagConfig>>;
	readonly args: Record<string, ArgBuilder<ArgConfig>>;
}

// ---------------------------------------------------------------------------
// Interactive resolver types
// ---------------------------------------------------------------------------

/**
 * Parameters received by the interactive resolver function.
 *
 * `flags` contains partially resolved values — present for flags resolved
 * via CLI, env, or config, `undefined` for unresolved flags. The resolver
 * uses this to decide which prompts to show based on current state.
 */
interface InteractiveParams<F extends Record<string, FlagBuilder<FlagConfig>>> {
	/** Partially resolved flag values (after CLI/env/config, before prompts). */
	readonly flags: Readonly<Partial<InferFlags<F>>>;
}

/**
 * A record mapping flag names to prompt configs or falsy values.
 *
 * - `PromptConfig` — show this prompt for the flag
 * - `false | undefined | null | 0 | ''` — skip prompting for this flag
 *
 * Only flag names that need prompting should have truthy values.
 * Flags not mentioned are handled by their per-flag `.prompt()` config.
 */
type InteractiveResult = Readonly<Record<string, PromptConfig | false | undefined | null | 0 | ''>>;

/**
 * Interactive resolver function for command-level prompt control.
 *
 * Called after CLI/env/config resolution but before per-flag prompts fire.
 * Receives partially resolved values and returns a prompt schema for
 * flags that should be prompted. Commands without `.interactive()` use
 * per-flag prompt configs directly.
 *
 * @example
 * ```ts
 * const deploy = command('deploy')
 *   .flag('region', flag.enum(['us', 'eu', 'ap']))
 *   .interactive(({ flags }) => ({
 *     region: !flags.region && {
 *       kind: 'select',
 *       message: 'Select region',
 *     },
 *   }))
 *   .action(({ flags }) => { ... });
 * ```
 */
type InteractiveResolver<F extends Record<string, FlagBuilder<FlagConfig>>> = (
	params: InteractiveParams<F>,
) => InteractiveResult;

/**
 * Type-erased interactive resolver stored on `CommandSchema`.
 *
 * At runtime, the resolver receives `{ flags: Record<string, unknown> }`
 * and returns `Record<string, PromptConfig | falsy>`. The phantom types
 * from `CommandBuilder<F, A>` are erased.
 *
 * @internal
 */
type ErasedInteractiveResolver = (params: {
	readonly flags: Readonly<Record<string, unknown>>;
}) => InteractiveResult;

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

/**
 * Minimal output channel stub — the real `Out` will be defined in
 * `src/core/output/` (task output-1). For now we expose the shape that
 * handlers will use so the command builder's `.action()` signature is
 * correct from day one.
 */
interface Out {
	/** Write to stdout (normal output). */
	log(message: string): void;
	/** Informational (may be suppressed in quiet mode). */
	info(message: string): void;
	/** Warning to stderr. */
	warn(message: string): void;
	/** Error to stderr. */
	error(message: string): void;
}

/**
 * The bag of values received by an action handler.
 *
 * - `args`  — fully resolved positional arguments
 * - `flags` — fully resolved flags
 * - `ctx`   — middleware-provided context (typed via middleware chain)
 * - `out`   — output channel
 *
 * The `C` parameter defaults to `Record<string, never>`, making `ctx`
 * property access a type error until middleware extends it. Each
 * `.middleware()` call on `CommandBuilder` widens `C` via intersection.
 */
interface ActionParams<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown> = Record<string, never>,
> {
	readonly args: Readonly<InferArgs<A>>;
	readonly flags: Readonly<InferFlags<F>>;
	readonly ctx: Readonly<C>;
	readonly out: Out;
}

/**
 * Action handler function signature.
 *
 * May be sync or async — the framework will `await` the return value
 * regardless. The `C` parameter carries the accumulated middleware
 * context type (defaults to empty).
 */
type ActionHandler<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown> = Record<string, never>,
> = (params: ActionParams<F, A, C>) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Runtime schema data
// ---------------------------------------------------------------------------

/** A single usage example shown in help text. */
interface CommandExample {
	/** The command invocation (e.g. `'deploy production --force'`). */
	readonly command: string;
	/** Optional description of what this example does. */
	readonly description?: string;
}

/**
 * The runtime descriptor built by `CommandBuilder`. Consumers (parser, help
 * generator, CLI dispatcher) read this to understand the command's shape.
 */
interface CommandSchema {
	/** The command name (used for dispatch, e.g. `'deploy'`). */
	readonly name: string;
	/** Human-readable description for help text. */
	readonly description: string | undefined;
	/** Alternative names for this command. */
	readonly aliases: readonly string[];
	/** Whether this command is hidden from help listings. */
	readonly hidden: boolean;
	/** Usage examples for help text. */
	readonly examples: readonly CommandExample[];
	/** Named flag schemas, keyed by flag name. */
	readonly flags: Readonly<Record<string, FlagSchema>>;
	/** Ordered positional arg entries (name + schema). */
	readonly args: readonly CommandArgEntry[];
	/** Whether an action handler has been registered. */
	readonly hasAction: boolean;
	/**
	 * Command-level interactive resolver for schema-driven prompt control.
	 *
	 * When set, called after CLI/env/config resolution with partially resolved
	 * flag values. Returns prompt configs for flags that need interactive input.
	 * Takes precedence over per-flag `.prompt()` configs for flags it returns
	 * configs for; flags not mentioned fall back to their per-flag configs.
	 *
	 * @see InteractiveResolver
	 */
	readonly interactive: ErasedInteractiveResolver | undefined;
}

/** A named positional arg entry in the command schema. */
interface CommandArgEntry {
	readonly name: string;
	readonly schema: ArgSchema;
}

// ---------------------------------------------------------------------------
// CommandBuilder — immutable builder with type-level tracking
// ---------------------------------------------------------------------------

/**
 * Immutable command schema builder.
 *
 * The type parameters `F` (flags), `A` (args), and `C` (context) are
 * phantom types that accumulate builder types as `.flag()`, `.arg()`,
 * and `.middleware()` are chained. The `.action()` handler receives
 * fully typed `ActionParams<F, A, C>`.
 *
 * `C` defaults to `Record<string, never>`, making `ctx` property
 * access a type error until middleware extends it via `.middleware()`.
 *
 * @example
 * ```ts
 * const deploy = command('deploy')
 *   .description('Deploy to an environment')
 *   .arg('target', arg.string().describe('Deploy target'))
 *   .flag('force', flag.boolean().alias('f'))
 *   .flag('region', flag.enum(['us', 'eu', 'ap']))
 *   .action(async ({ args, flags, out }) => {
 *     // args.target: string
 *     // flags.force: boolean
 *     // flags.region: 'us' | 'eu' | 'ap' | undefined
 *     out.log(`Deploying ${args.target}...`);
 *   });
 * ```
 */
class CommandBuilder<
	// biome-ignore lint/complexity/noBannedTypes: {} is the correct initial accumulator for intersection-based type growth (F & Record<N, B>)
	F extends Record<string, FlagBuilder<FlagConfig>> = {},
	// biome-ignore lint/complexity/noBannedTypes: {} is the correct initial accumulator for intersection-based type growth (A & Record<N, B>)
	A extends Record<string, ArgBuilder<ArgConfig>> = {},
	C extends Record<string, unknown> = Record<string, never>,
> {
	/** @internal Runtime schema descriptor. */
	readonly schema: CommandSchema;

	/** @internal The action handler, if registered. */
	readonly handler: ActionHandler<F, A, C> | undefined;

	/**
	 * @internal Type brands — exist only in the type system (`declare`
	 * produces no runtime property). Used for type inference.
	 */
	declare readonly _flags: F;
	declare readonly _args: A;
	declare readonly _ctx: C;

	constructor(schema: CommandSchema, handler?: ActionHandler<F, A, C>) {
		this.schema = schema;
		this.handler = handler;
	}

	// -- Interactive resolver ------------------------------------------------

	/**
	 * Register a command-level interactive resolver for schema-driven prompts.
	 *
	 * The resolver is called after CLI/env/config resolution with partially
	 * resolved flag values. It returns a prompt schema for flags that need
	 * interactive input based on the current state.
	 *
	 * For flags the resolver returns a `PromptConfig`, that config is used
	 * instead of any per-flag `.prompt()` config. For flags returned as falsy
	 * (or not mentioned), per-flag `.prompt()` configs are used as fallback.
	 *
	 * Commands without `.interactive()` use per-flag prompt configs directly.
	 *
	 * @example
	 * ```ts
	 * const deploy = command('deploy')
	 *   .flag('region', flag.enum(['us', 'eu', 'ap']))
	 *   .flag('force', flag.boolean())
	 *   .interactive(({ flags }) => ({
	 *     region: !flags.region && {
	 *       kind: 'select',
	 *       message: 'Select region',
	 *     },
	 *   }))
	 *   .action(({ flags }) => { ... });
	 * ```
	 */
	interactive(resolver: InteractiveResolver<F>): CommandBuilder<F, A, C> {
		// The resolver is type-erased for storage on CommandSchema.
		// At runtime, `InteractiveResolver<F>` is just `(params: { flags }) => Record<...>`.
		// The phantom types on F are erased — the resolver's runtime behaviour is
		// identical to `ErasedInteractiveResolver`.
		const erased = resolver as unknown as ErasedInteractiveResolver;
		return new CommandBuilder({ ...this.schema, interactive: erased }, this.handler);
	}

	// -- Metadata modifiers --------------------------------------------------

	/** Set the command's description for help text. */
	description(text: string): CommandBuilder<F, A, C> {
		return new CommandBuilder({ ...this.schema, description: text }, this.handler);
	}

	/** Add an alternative name for this command. */
	alias(name: string): CommandBuilder<F, A, C> {
		return new CommandBuilder(
			{ ...this.schema, aliases: [...this.schema.aliases, name] },
			this.handler,
		);
	}

	/** Hide this command from help listings. */
	hidden(): CommandBuilder<F, A, C> {
		return new CommandBuilder({ ...this.schema, hidden: true }, this.handler);
	}

	/** Add a usage example to help text. */
	example(cmd: string, description?: string): CommandBuilder<F, A, C> {
		const entry: CommandExample =
			description !== undefined ? { command: cmd, description } : { command: cmd };
		return new CommandBuilder(
			{ ...this.schema, examples: [...this.schema.examples, entry] },
			this.handler,
		);
	}

	// -- Flag accumulation ---------------------------------------------------

	/**
	 * Register a named flag on this command.
	 *
	 * The flag name is added to the type-level `F` map. Duplicate flag names
	 * are prevented at the type level via the `Exclude` constraint.
	 */
	flag<N extends string, B extends FlagBuilder<FlagConfig>>(
		name: N & Exclude<N, keyof F>,
		builder: B,
	): CommandBuilder<F & Record<N, B>, A, C> {
		const nextFlags = { ...this.schema.flags, [name]: builder.schema };
		return new CommandBuilder(
			{ ...this.schema, flags: nextFlags, hasAction: false },
			// handler is intentionally dropped — adding a flag invalidates
			// the previous handler's type signature
			undefined,
		);
	}

	// -- Arg accumulation ----------------------------------------------------

	/**
	 * Register a named positional argument on this command.
	 *
	 * Args are ordered by registration. The arg name is added to the
	 * type-level `A` map. Duplicate arg names are prevented at the type
	 * level via the `Exclude` constraint.
	 */
	arg<N extends string, B extends ArgBuilder<ArgConfig>>(
		name: N & Exclude<N, keyof A>,
		builder: B,
	): CommandBuilder<F, A & Record<N, B>, C> {
		const entry: CommandArgEntry = { name, schema: builder.schema };
		const nextArgs = [...this.schema.args, entry];
		return new CommandBuilder(
			{ ...this.schema, args: nextArgs, hasAction: false },
			// handler is intentionally dropped — adding an arg invalidates
			// the previous handler's type signature
			undefined,
		);
	}

	// -- Action handler ------------------------------------------------------

	/**
	 * Register the action handler for this command.
	 *
	 * The handler receives fully typed `{ args, flags, ctx, out }` derived
	 * from the accumulated `.flag()`, `.arg()`, and `.middleware()` definitions.
	 */
	action(handler: ActionHandler<F, A, C>): CommandBuilder<F, A, C> {
		return new CommandBuilder({ ...this.schema, hasAction: true }, handler);
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a new command builder.
 *
 * @param name - The command name used for dispatch (e.g. `'deploy'`).
 *
 * @example
 * ```ts
 * const greet = command('greet')
 *   .arg('name', arg.string())
 *   .flag('loud', flag.boolean())
 *   .action(({ args, flags, out }) => {
 *     const msg = `Hello, ${args.name}!`;
 *     out.log(flags.loud ? msg.toUpperCase() : msg);
 *   });
 * ```
 */
function command(name: string): CommandBuilder {
	return new CommandBuilder({
		name,
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: false,
		interactive: undefined,
	});
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { command, CommandBuilder };
export type {
	ActionHandler,
	ActionParams,
	CommandArgEntry,
	CommandConfig,
	CommandExample,
	CommandSchema,
	ErasedInteractiveResolver,
	InteractiveParams,
	InteractiveResolver,
	InteractiveResult,
	Out,
};
