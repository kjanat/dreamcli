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
 * - `ctx`   — middleware-provided context (empty object for MVP)
 * - `out`   — output channel
 */
interface ActionParams<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
> {
	readonly args: Readonly<InferArgs<A>>;
	readonly flags: Readonly<InferFlags<F>>;
	readonly ctx: Readonly<Record<string, unknown>>;
	readonly out: Out;
}

/**
 * Action handler function signature.
 *
 * May be sync or async — the framework will `await` the return value
 * regardless.
 */
type ActionHandler<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
> = (params: ActionParams<F, A>) => void | Promise<void>;

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
 * The type parameters `F` (flags) and `A` (args) are phantom types that
 * accumulate builder types as `.flag()` and `.arg()` are chained. The
 * `.action()` handler receives a fully typed `ActionParams<F, A>`.
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
> {
	/** @internal Runtime schema descriptor. */
	readonly schema: CommandSchema;

	/** @internal The action handler, if registered. */
	readonly handler: ActionHandler<F, A> | undefined;

	/**
	 * @internal Type brands — exist only in the type system (`declare`
	 * produces no runtime property). Used for type inference.
	 */
	declare readonly _flags: F;
	declare readonly _args: A;

	constructor(schema: CommandSchema, handler?: ActionHandler<F, A>) {
		this.schema = schema;
		this.handler = handler;
	}

	// -- Metadata modifiers --------------------------------------------------

	/** Set the command's description for help text. */
	description(text: string): CommandBuilder<F, A> {
		return new CommandBuilder({ ...this.schema, description: text }, this.handler);
	}

	/** Add an alternative name for this command. */
	alias(name: string): CommandBuilder<F, A> {
		return new CommandBuilder(
			{ ...this.schema, aliases: [...this.schema.aliases, name] },
			this.handler,
		);
	}

	/** Hide this command from help listings. */
	hidden(): CommandBuilder<F, A> {
		return new CommandBuilder({ ...this.schema, hidden: true }, this.handler);
	}

	/** Add a usage example to help text. */
	example(cmd: string, description?: string): CommandBuilder<F, A> {
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
	): CommandBuilder<F & Record<N, B>, A> {
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
	): CommandBuilder<F, A & Record<N, B>> {
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
	 * from the accumulated `.flag()` and `.arg()` definitions.
	 */
	action(handler: ActionHandler<F, A>): CommandBuilder<F, A> {
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
	Out,
};
