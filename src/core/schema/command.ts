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

import { CLIError } from '../errors/index.ts';
import type {
	ProgressHandle,
	ProgressOptions,
	SpinnerHandle,
	SpinnerOptions,
	TableColumn,
} from './activity.ts';
import type { ArgBuilder, ArgConfig, ArgSchema, InferArgs } from './arg.ts';
import type { FlagBuilder, FlagConfig, FlagSchema, InferFlags } from './flag.ts';
import type { ErasedMiddlewareHandler, Middleware } from './middleware.ts';
import type { PromptConfig } from './prompt.ts';
import type { RunResult } from './run.ts';

// ---------------------------------------------------------------------------
// Context type utilities
// ---------------------------------------------------------------------------

/**
 * Widen the context type when adding middleware.
 *
 * The default `C = Record<string, never>` uses an index signature where
 * every key maps to `never` — making property access a type error until
 * middleware extends it. Naive intersection (`Record<string, never> & { user: string }`)
 * collapses all properties to `never` because `never & T = never`.
 *
 * This utility replaces `Record<string, never>` entirely on the first
 * `.middleware()` call. Subsequent calls use plain intersection.
 */
type WidenContext<C extends Record<string, unknown>, Output extends Record<string, unknown>> =
	C extends Record<string, never> ? Output : C & Output;

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
 * Advanced bridge type: most consumers should use {@link InteractiveResolver}
 * via `command().interactive(...)` and never reference this alias directly.
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
	/**
	 * Emit a structured JSON value to stdout.
	 *
	 * - In `--json` mode: serialises `value` as JSON to stdout.
	 * - In normal mode: serialises `value` as JSON to stdout.
	 *
	 * Handlers should prefer `json()` over `log(JSON.stringify(...))` so
	 * the output channel can enforce consistent formatting and future
	 * features (pretty-print in TTY, streaming JSON, etc.).
	 */
	json(value: unknown): void;
	/**
	 * Whether the output channel is in JSON mode (`--json` flag active).
	 *
	 * Handlers can check this to skip decorative output (spinners,
	 * progress bars, ANSI formatting) when machine-readable output is
	 * expected.
	 */
	readonly jsonMode: boolean;

	/**
	 * Whether stdout is connected to a TTY (terminal).
	 *
	 * Handlers can check this to decide whether to emit decorative output
	 * (spinners, progress bars, ANSI color codes). When `false`, the output
	 * is being piped or redirected — skip interactive decorations.
	 *
	 * Note: `jsonMode` takes precedence — when `jsonMode` is `true`,
	 * decorative output should be suppressed regardless of `isTTY`.
	 */
	readonly isTTY: boolean;

	/**
	 * Render tabular data.
	 *
	 * - **TTY mode** (non-JSON): Pretty-print aligned columns with headers.
	 * - **JSON mode** (`--json`): Emit the rows as a JSON array to stdout.
	 * - **Piped** (non-TTY, non-JSON): Same aligned text output as TTY
	 *   (useful for `grep`, `awk`, etc.).
	 *
	 * When `columns` is omitted, columns are auto-inferred from the keys
	 * of the first row. Column headers default to the key name.
	 *
	 * @param rows    - Array of row objects.
	 * @param columns - Optional column descriptors for ordering and headers.
	 */
	table<T extends Record<string, unknown>>(
		rows: readonly T[],
		columns?: readonly TableColumn<T>[],
	): void;

	/**
	 * Create a spinner for indeterminate progress feedback.
	 *
	 * Returns a handle for lifecycle control. In non-TTY/jsonMode,
	 * returns a no-op handle (or static fallback if configured).
	 *
	 * @param text    - Initial spinner text.
	 * @param options - Fallback strategy for non-TTY environments.
	 */
	spinner(text: string, options?: SpinnerOptions): SpinnerHandle;

	/**
	 * Create a progress bar for measured work.
	 *
	 * Returns a handle for updating progress. Pass `total` for
	 * determinate mode (percentage bar); omit for indeterminate (pulsing).
	 *
	 * @param options - Progress configuration (total, label, fallback).
	 */
	progress(options: ProgressOptions): ProgressHandle;

	/**
	 * Stop the currently active spinner or progress handle, if any.
	 *
	 * TTY spinner and progress handles start `setInterval` timers that
	 * prevent the process from exiting until a terminal method (`stop`,
	 * `succeed`, `fail`, `done`) is called. If a handler throws before
	 * reaching that call, the timer leaks and the process hangs.
	 *
	 * Call `stopActive()` in a `finally` block after handler execution
	 * to guarantee cleanup. It is idempotent — safe to call when no
	 * handle is active, or when the handle was already stopped.
	 *
	 * The framework calls this automatically in `runCommand()` and
	 * `cli.run()`. Direct users of `createOutput()` should call it
	 * themselves after the handler returns or throws.
	 *
	 * @example
	 * ```ts
	 * const out = createOutput({ isTTY: true });
	 * try {
	 *   await handler({ out });
	 * } finally {
	 *   out.stopActive();
	 * }
	 * ```
	 */
	stopActive(): void;
}

/**
 * Metadata about the running CLI program, available to action handlers
 * and middleware.
 *
 * Populated by the CLI dispatch layer from {@link CLISchema} and
 * {@link CommandSchema}. For standalone `runCommand()` calls without
 * a CLI wrapper, a minimal meta is constructed from the command's own schema.
 */
interface CommandMeta {
	/** CLI program name (from `cli('name')` or package.json inference). */
	readonly name: string;
	/** Binary display name used in help/usage (may differ from `name`). */
	readonly bin: string;
	/** Program version, if set via `.version()` or discovered from package.json. */
	readonly version: string | undefined;
	/** The leaf command name currently being executed. */
	readonly command: string;
}

/**
 * The bag of values received by an action handler.
 *
 * - `args`  — fully resolved positional arguments
 * - `flags` — fully resolved flags
 * - `ctx`   — middleware-provided context (typed via middleware chain)
 * - `out`   — output channel
 * - `meta`  — CLI program metadata (name, bin, version, command)
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
	readonly meta: CommandMeta;
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
	/**
	 * Middleware handlers to run before the action handler.
	 *
	 * Executed in registration order — first middleware registered runs
	 * first and calls `next()` to proceed to subsequent middleware,
	 * ending with the action handler. Context accumulates via intersection
	 * at the type level and via object spread at runtime.
	 */
	readonly middleware: readonly ErasedMiddlewareHandler[];
	/**
	 * Nested subcommand schemas (for help rendering and completion).
	 *
	 * Pure data — no execution closures. Populated by `.command()` on
	 * `CommandBuilder`. Empty for leaf commands.
	 */
	readonly commands: readonly CommandSchema[];
}

/** A named positional arg entry in the command schema. */
interface CommandArgEntry {
	readonly name: string;
	readonly schema: ArgSchema;
}

function validateArgEntry(name: string, schema: ArgSchema, args: readonly CommandArgEntry[]): void {
	if (schema.stdinMode && schema.variadic) {
		throw new CLIError(`Argument <${name}> cannot be both variadic and stdin-backed`, {
			code: 'INVALID_BUILDER_STATE',
			details: { arg: name, stdinMode: true, variadic: true },
			suggest: 'Remove .stdin() or .variadic() from this argument',
		});
	}

	if (!schema.stdinMode) {
		return;
	}

	const existing = args.find((entry) => entry.schema.stdinMode);
	if (existing === undefined) {
		return;
	}

	throw new CLIError(
		`Only one stdin argument is allowed; <${existing.name}> is already stdin-backed`,
		{
			code: 'DUPLICATE_STDIN_ARG',
			details: { arg: name, existingArg: existing.name },
			suggest: 'Keep .stdin() on a single argument per command',
		},
	);
}

// ---------------------------------------------------------------------------
// Type-erased command interface (shared between schema and CLI layers)
// ---------------------------------------------------------------------------

/**
 * A type-erased command entry for heterogeneous command storage.
 *
 * Advanced/internal bridge type: most consumers should work with
 * {@link CommandBuilder} and never reference `ErasedCommand` directly.
 *
 * Commands registered via `CLIBuilder.command()` have heterogeneous `F`, `A`,
 * and `C` type parameters. At the dispatch level we only need the runtime
 * schema (for name/alias matching and help) and the ability to delegate to
 * `runCommand()`. This interface captures exactly that contract.
 *
 * The `_execute` function closes over the original typed `CommandBuilder`,
 * preserving full type safety inside the closure while presenting a
 * uniform interface to the dispatcher.
 *
 * Defined here (rather than in the CLI layer) so both `CommandBuilder` and
 * `CLIBuilder` can reference it without circular imports.
 *
 * @internal
 */
interface ErasedCommand {
	/** Runtime schema for name matching and help rendering. */
	readonly schema: CommandSchema;
	/**
	 * Nested subcommands (name/alias → erased child).
	 *
	 * Built recursively by `eraseCommand()` in the CLI layer.
	 * Empty map for leaf commands. The dispatch layer uses this for
	 * recursive command tree traversal.
	 *
	 * @internal
	 */
	readonly subcommands: ReadonlyMap<string, ErasedCommand>;
	/** Execute this command against argv. Closes over the typed CommandBuilder. */
	readonly _execute: (
		argv: readonly string[],
		options?: Readonly<Record<string, unknown>>,
	) => Promise<RunResult>;
}

// ---------------------------------------------------------------------------
// Type-erased builder alias (for heterogeneous subcommand storage)
// ---------------------------------------------------------------------------

/**
 * Type-erased command builder for heterogeneous storage in `_subcommands`.
 *
 * Advanced helper alias: useful only when working on DreamCLI internals or
 * custom tooling that mirrors the framework's type-erasure boundary.
 *
 * Uses widest possible generic bounds so any `CommandBuilder<F, A, C>` is
 * assignable. The CLI layer's `eraseCommand()` traverses these to build
 * the execution tree.
 *
 * @internal
 */
type AnyCommandBuilder = CommandBuilder<
	Record<string, FlagBuilder<FlagConfig>>,
	Record<string, ArgBuilder<ArgConfig>>,
	Record<string, unknown>
>;

/**
 * Erase a typed `CommandBuilder<F, A, C>` to `AnyCommandBuilder` for
 * heterogeneous storage. Centralises the `as unknown as` double-cast
 * required at the type-erasure boundary.
 *
 * @internal
 */
function eraseBuilder<
	F extends Record<string, FlagBuilder<FlagConfig>>,
	A extends Record<string, ArgBuilder<ArgConfig>>,
	C extends Record<string, unknown>,
>(builder: CommandBuilder<F, A, C>): AnyCommandBuilder {
	return builder as unknown as AnyCommandBuilder;
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
	 * @internal Nested sub-command builders (type-erased for heterogeneous storage).
	 *
	 * Stored separately from `schema.commands` because builders carry action
	 * handlers and phantom types needed by `eraseCommand()` in the CLI layer.
	 * `schema.commands` holds pure `CommandSchema[]` for help/completion.
	 */
	readonly _subcommands: readonly AnyCommandBuilder[];

	/**
	 * @internal Type brands — exist only in the type system (`declare`
	 * produces no runtime property). Used for type inference.
	 */
	declare readonly _flags: F;
	declare readonly _args: A;
	declare readonly _ctx: C;

	constructor(
		schema: CommandSchema,
		handler?: ActionHandler<F, A, C>,
		subcommands?: readonly AnyCommandBuilder[],
	) {
		this.schema = schema;
		this.handler = handler;
		this._subcommands = subcommands ?? [];
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
		return new CommandBuilder(
			{ ...this.schema, interactive: erased },
			this.handler,
			this._subcommands,
		);
	}

	// -- Middleware ----------------------------------------------------------

	/**
	 * Register middleware to run before the action handler.
	 *
	 * Middleware executes in registration order. Each middleware receives
	 * `{ args, flags, ctx, out, next }` and must call `next(additions)`
	 * to continue the chain. Context additions are merged and become
	 * typed downstream.
	 *
	 * Adding middleware widens `C` via intersection and drops the current
	 * handler (like `.flag()` / `.arg()` — the handler's type signature
	 * changes when context changes).
	 *
	 * @example
	 * ```ts
	 * command('deploy')
	 *   .middleware(auth)      // C becomes { user: User }
	 *   .middleware(telemetry) // C becomes { user: User } & { traceId: string }
	 *   .action(({ ctx }) => {
	 *     ctx.user;    // User — typed
	 *     ctx.traceId; // string — typed
	 *   });
	 * ```
	 */
	middleware<Output extends Record<string, unknown>>(
		m: Middleware<Output>,
	): CommandBuilder<F, A, WidenContext<C, Output>> {
		return new CommandBuilder(
			{
				...this.schema,
				middleware: [...this.schema.middleware, m._handler],
				hasAction: false,
			},
			// Handler intentionally dropped — C changed, invalidating handler signature.
			undefined,
			this._subcommands,
		);
	}

	// -- Metadata modifiers --------------------------------------------------

	/**
	 * Set the command's description for help text.
	 *
	 * Displayed below the usage line in `--help` output and next to the
	 * command name in parent command/group help listings.
	 *
	 * @param text - One-line description of what the command does.
	 *
	 * @example
	 * ```ts
	 * command('deploy')
	 *   .description('Deploy the application to a target environment')
	 *   .action(({ out }) => { out.log('deploying...'); });
	 *
	 * // $ mycli deploy --help
	 * // Usage: deploy [flags]
	 * //
	 * // Deploy the application to a target environment
	 * ```
	 */
	description(text: string): CommandBuilder<F, A, C> {
		return new CommandBuilder(
			{ ...this.schema, description: text },
			this.handler,
			this._subcommands,
		);
	}

	/**
	 * Add an alternative name for this command.
	 *
	 * Aliases are accepted during dispatch alongside the primary name.
	 * Multiple aliases can be chained. Aliases are shown in help output.
	 *
	 * @param name - Alternative command name (e.g. `'d'` for `deploy`).
	 *
	 * @example
	 * ```ts
	 * command('deploy')
	 *   .alias('d')
	 *   .alias('push')
	 *   .action(({ out }) => { out.log('deploying...'); });
	 *
	 * // All equivalent:
	 * // $ mycli deploy
	 * // $ mycli d
	 * // $ mycli push
	 * ```
	 */
	alias(name: string): CommandBuilder<F, A, C> {
		return new CommandBuilder(
			{ ...this.schema, aliases: [...this.schema.aliases, name] },
			this.handler,
			this._subcommands,
		);
	}

	/**
	 * Hide this command from help listings.
	 *
	 * The command remains fully functional and dispatchable — it just
	 * won't appear in `--help` output or shell completions. Useful for
	 * internal/debug commands.
	 *
	 * @example
	 * ```ts
	 * command('debug-dump')
	 *   .hidden()
	 *   .action(({ out }) => { out.log(JSON.stringify(internalState)); });
	 *
	 * // $ mycli --help     → 'debug-dump' is not listed
	 * // $ mycli debug-dump → still works
	 * ```
	 */
	hidden(): CommandBuilder<F, A, C> {
		return new CommandBuilder({ ...this.schema, hidden: true }, this.handler, this._subcommands);
	}

	/**
	 * Add a usage example to help text.
	 *
	 * Examples are rendered in the "Examples:" section of `--help` output.
	 * Call multiple times to add several examples. Each example shows a
	 * shell invocation, optionally with a description.
	 *
	 * @param cmd - The example command line (without the program name prefix).
	 * @param description - Optional one-line explanation of what the example does.
	 *
	 * @example
	 * ```ts
	 * command('deploy')
	 *   .arg('target', arg.string())
	 *   .flag('force', flag.boolean().alias('f'))
	 *   .example('deploy production', 'Deploy to production')
	 *   .example('deploy staging -f', 'Force deploy to staging')
	 *   .action(({ args, flags }) => { ... });
	 *
	 * // $ mycli deploy --help
	 * // ...
	 * // Examples:
	 * //   deploy production      Deploy to production
	 * //   deploy staging -f      Force deploy to staging
	 * ```
	 */
	example(cmd: string, description?: string): CommandBuilder<F, A, C> {
		const entry: CommandExample =
			description !== undefined ? { command: cmd, description } : { command: cmd };
		return new CommandBuilder(
			{ ...this.schema, examples: [...this.schema.examples, entry] },
			this.handler,
			this._subcommands,
		);
	}

	// -- Flag accumulation ---------------------------------------------------

	/**
	 * Register a named flag on this command.
	 *
	 * The flag name is added to the type-level `F` map. Duplicate flag names
	 * are prevented at the type level via the `Exclude` constraint.
	 *
	 * The builder controls the flag's type, presence, aliases, env/config
	 * bindings, and description. See {@link FlagBuilder} for available modifiers.
	 *
	 * @param name - Flag name (used as `--name` on CLI and `flags.*` in handler).
	 * @param builder - Configured `FlagBuilder` from `flag.string()`, `flag.boolean()`,
	 *   `flag.number()`, `flag.enum()`, `flag.array()`, or `flag.custom()`.
	 *
	 * @example
	 * ```ts
	 * command('serve')
	 *   .flag('port', flag.number()
	 *     .alias('p')
	 *     .env('PORT')
	 *     .default(3000)
	 *     .describe('Port to listen on'))
	 *   .flag('host', flag.string()
	 *     .env('HOST')
	 *     .default('localhost')
	 *     .describe('Bind address'))
	 *   .flag('verbose', flag.boolean()
	 *     .alias('v')
	 *     .describe('Enable verbose logging'))
	 *   .action(({ flags, out }) => {
	 *     flags.port;    // number
	 *     flags.host;    // string
	 *     flags.verbose; // boolean
	 *     out.log(`Listening on ${flags.host}:${flags.port}`);
	 *   });
	 *
	 * // $ mycli serve --port 8080 -v
	 * // $ PORT=9090 mycli serve
	 * ```
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
			this._subcommands,
		);
	}

	// -- Arg accumulation ----------------------------------------------------

	/**
	 * Register a named positional argument on this command.
	 *
	 * Args are ordered by registration — position on the CLI matches the
	 * order of `.arg()` calls. The arg name is added to the type-level `A`
	 * map. Duplicate arg names are prevented at the type level via the
	 * `Exclude` constraint.
	 *
	 * The builder controls the arg's type, presence, env binding, and
	 * description. See {@link ArgBuilder} for available modifiers.
	 *
	 * @param name - Positional arg name (used in help text and `args.*`).
	 * @param builder - Configured `ArgBuilder` from `arg.string()`, `arg.number()`,
	 *   or `arg.custom()`.
	 *
	 * @example
	 * ```ts
	 * command('deploy')
	 *   // Required string arg — first positional
	 *   .arg('target', arg.string()
	 *     .env('DEPLOY_TARGET')
	 *     .describe('Deploy target'))
	 *   // Optional number arg — second positional
	 *   .arg('port', arg.number()
	 *     .env('PORT')
	 *     .default(3000)
	 *     .describe('Port number'))
	 *   .action(({ args }) => {
	 *     args.target; // string
	 *     args.port;   // number
	 *   });
	 *
	 * // Usage: deploy [flags] <target> [port]
	 * // $ mycli deploy production 8080
	 * // $ DEPLOY_TARGET=staging mycli deploy
	 * ```
	 */
	arg<N extends string, B extends ArgBuilder<ArgConfig>>(
		name: N & Exclude<N, keyof A>,
		builder: B,
	): CommandBuilder<F, A & Record<N, B>, C> {
		validateArgEntry(name, builder.schema, this.schema.args);
		const entry: CommandArgEntry = { name, schema: builder.schema };
		const nextArgs = [...this.schema.args, entry];
		return new CommandBuilder(
			{ ...this.schema, args: nextArgs, hasAction: false },
			// handler is intentionally dropped — adding an arg invalidates
			// the previous handler's type signature
			undefined,
			this._subcommands,
		);
	}

	// -- Subcommand nesting --------------------------------------------------

	/**
	 * Register a nested subcommand on this command.
	 *
	 * The subcommand's builder is stored in `_subcommands` for the CLI layer's
	 * `eraseCommand()` to traverse when building the execution tree. The
	 * subcommand's `CommandSchema` is also appended to `schema.commands` for
	 * help rendering and completion generation.
	 *
	 * Does not change `F`, `A`, or `C` — subcommands are type-erased at the
	 * parent level (same semantics as `CLIBuilder.command()`). The handler is
	 * preserved.
	 *
	 * @example
	 * ```ts
	 * const db = group('db')
	 *   .description('Database operations')
	 *   .command(migrateCmd)
	 *   .command(seedCmd);
	 * ```
	 */
	command<
		F2 extends Record<string, FlagBuilder<FlagConfig>>,
		A2 extends Record<string, ArgBuilder<ArgConfig>>,
		C2 extends Record<string, unknown>,
	>(sub: CommandBuilder<F2, A2, C2>): CommandBuilder<F, A, C> {
		return new CommandBuilder(
			{
				...this.schema,
				commands: [...this.schema.commands, sub.schema],
			},
			this.handler,
			[...this._subcommands, eraseBuilder(sub)],
		);
	}

	// -- Action handler ------------------------------------------------------

	/**
	 * Register the action handler for this command.
	 *
	 * The handler receives fully typed `{ args, flags, ctx, out }` derived
	 * from the accumulated `.flag()`, `.arg()`, and `.middleware()` definitions.
	 *
	 * May be synchronous or async. Return values are ignored; command handlers
	 * communicate through `out`, thrown errors, and side effects.
	 *
	 * @param handler - Function receiving `ActionParams<F, A, C>`.
	 *
	 * @example
	 * // Minimal
	 * command('greet')
	 *   .arg('name', arg.string())
	 *   .action(({ args, out }) => {
	 *     out.log(`Hello, ${args.name}!`);
	 *   });
	 *
	 * @example
	 * // Full params — flags, args, context, output
	 * command('deploy')
	 *   .arg('target', arg.string().env('DEPLOY_TARGET'))
	 *   .flag('force', flag.boolean().alias('f'))
	 *   .flag('region', flag.enum(['us', 'eu', 'ap']).env('REGION'))
	 *   .middleware(auth)
	 *   .action(async ({ args, flags, ctx, out }) => {
	 *     args.target;  // string
	 *     flags.force;  // boolean
	 *     flags.region; // 'us' | 'eu' | 'ap' | undefined
	 *     ctx.user;     // User (from auth middleware)
	 *
	 *     const spinner = out.spinner('Deploying...');
	 *     await deploy(args.target, { force: flags.force });
	 *     spinner.stop();
	 *     out.log('Done');
	 *   });
	 */
	action(handler: ActionHandler<F, A, C>): CommandBuilder<F, A, C> {
		return new CommandBuilder({ ...this.schema, hasAction: true }, handler, this._subcommands);
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
		middleware: [],
		commands: [],
	});
}

/**
 * Create a command builder intended for use as a command group.
 *
 * Semantically identical to `command()` — a group is simply a command that
 * has subcommands registered via `.command()`. The separate factory
 * communicates intent: groups organise subcommands, leaf commands have actions.
 *
 * A group may also have its own `.action()` (e.g. `git remote` lists remotes
 * when invoked without a subcommand, but dispatches to `git remote add`, etc.).
 *
 * @param name - The group name used for dispatch (e.g. `'db'`).
 *
 * @example
 * ```ts
 * const db = group('db')
 *   .description('Database operations')
 *   .command(migrateCmd)
 *   .command(seedCmd);
 * ```
 */
function group(name: string): CommandBuilder {
	return command(name);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type {
	ActionHandler,
	ActionParams,
	AnyCommandBuilder,
	CommandArgEntry,
	CommandConfig,
	CommandExample,
	CommandMeta,
	CommandSchema,
	ErasedCommand,
	ErasedInteractiveResolver,
	InteractiveParams,
	InteractiveResolver,
	InteractiveResult,
	Out,
};
export { CommandBuilder, command, group };
