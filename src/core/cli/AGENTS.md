# cli — CLIBuilder, multi-command dispatch, plugins

`index.ts` (~2259 lines) — heavily split: 12 `@internal` extraction files.

## KEY TYPES

| Symbol                     | Role                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `CLIBuilder`               | Fluent builder: `.command()`, `.default()`, `.execute()`                |
| `cli(name)`                | Factory function -> `CLIBuilder`                                        |
| `isMainModule(meta)`       | Entrypoint guard for ambient `ImportMeta` compatibility                 |
| `CLISchema`                | Runtime descriptor for the full CLI, execution graph excluded           |
| `Builtins`                 | Sealed `help`/`json`/`quiet` state on `CLISchema`, set by `.builtins()` |
| `CLIExecuteOptions`        | Extends `RunOptions`; the process-free `.execute()` surface             |
| `CLIRunOptions`            | Extends `CLIExecuteOptions` with the runtime `adapter`                  |
| `ConfigSettings`           | Config file discovery settings for CLI                                  |
| `executeCLI()`             | `@internal` — shared execution body behind `.execute()` and `.run()`    |
| `CompiledCommand`          | `@internal` — handler, steps, and subcommand map for one command        |
| `CompiledCLI`              | `@internal` — compiled commands, default command, and plugins           |
| `formatRootHelp()`         | `@internal` — root-level help rendering (in `root-help.ts`)             |
| `ValueFlagLookup`          | `@internal` — value-flag arity lookup threaded into `dispatch()`        |
| `consumesFollowingToken()` | `@internal` — whether a flag token consumes the next argv token (arity) |

## FILES

| File                   | Lines | Purpose                                                               |
| ---------------------- | ----: | --------------------------------------------------------------------- |
| `index.ts`             |  2259 | CLIBuilder class + cli() factory + JSON error handling                |
| `planner.ts`           |   695 | `@internal` — execution planner, command resolution strategy          |
| `runtime-preflight.ts` |   526 | `@internal` — runtime adapter setup, env/config preflight             |
| `root-help.ts`         |   383 | `@internal` — root-level help text + text helpers, structural schema  |
| `dispatch.ts`          |   365 | `@internal` — command dispatch (value-flag-arity aware), levenshtein  |
| `reserved-flags.ts`    |   238 | `@internal` — build-time `RESERVED_FLAG` guard for root-owned flags   |
| `root-output-flags.ts` |   214 | `@internal` — `--json`/`--quiet` reader + strip, shared by all layers |
| `builtins.ts`          |   208 | Built-in spelling table + `.builtins()` normalization, shared by all  |
| `compiled.ts`          |   138 | `@internal` — compiled execution graph + `compileCommand()`           |
| `plugin.ts`            |   117 | `@internal` — plugin system + lifecycle hooks                         |
| `propagate.ts`         |    97 | `@internal` — flag propagation through command tree                   |
| `root-surface.ts`      |    96 | `@internal` — root-level CLI surface (version, help flags)            |
| `help-links.ts`        |    82 | `@internal` — help link derivation from manifest metadata             |

## DISPATCH FLOW

```
argv -> strip --json flag (before --) -> match subcommand (nested) -> resolve -> middleware -> action -> output
        | (no match)
        -> error (unknown command / no action) -> render as JSON if --json
```

Nested dispatch: `group('db').command(migrate).command(seed)` -> `mycli db migrate --force`

## `executeCLI()`

Module-level function taking the builder as its first parameter; `.execute()` and `.run()` both
delegate to it. Handles 6 concerns sequentially: `--json` extraction, `--version`, `--help`,
no-commands error, command map building, 3-way dispatch result (`unknown` / `needs-subcommand` /
`match`).

## `--json` MODE

- Stripped from argv before command dispatch, but only before the `--` separator (a `--json` after
  `--` stays a literal positional)
- `readRootOutputFlags()` in `root-output-flags.ts` is the single reader for `--json` and
  `--quiet`/`-q`; `planner.ts`, `executeCLI()`, `resolveRenderContext()`, `runtime-preflight.ts`, and
  testkit `runCommand()` all go through it. It accepts `--json=true|1|false|0` via the parser's own
  `coerceFlagValue()` with `flag.boolean()`'s schema, so values, last-wins duplicates, and the
  `INVALID_VALUE` error match a command-level boolean (#85). Short `-q` stays presence-only, matching
  short-flag tokenization
- An invalid value reaches the user as a `dispatch-error`, but only after root `--version` and
  `--help` have had their turn, so `requestsHelp()` gates it in both `planner.ts` and testkit
  `runCommand()` the same way `executeCommand()` short-circuits a command's own `--help`
- CLI-level errors rendered as JSON when active
- Propagated to `OutputChannel` via `jsonMode` option
- `out.log`/`out.info` redirect to stderr in JSON mode (stdout reserved for data)

## GOTCHAS

- `CLISchema` holds `CommandSchema` values; handlers, execution steps, subcommand maps, and plugins
  live in the `CompiledCLI` stored in a module-private `WeakMap` in `index.ts`. Every builder method
  that returns a new `CLIBuilder` must go through `rebuild()` or `CLIBuilder._from()` — a `new`
  without a compiled entry drops every handler and `compiledStateOf()` throws
  `INVALID_BUILDER_STATE`. The constructor is `private` to enforce this.
- `compileCommand()` stores the builder's own `schema` object, so `CompiledCommand.schema` is
  identical (`===`) to the entry in the public schema tree. `mergeCommandSchema()` in `planner.ts`
  returns that same object when no ancestor flag propagates, and a fresh spread when one does; the
  spread reaches only `plan.mergedSchema` and must stay out of both trees.
- `CLISchema` and `ConfigSettings` carry `readonly [schemaBrand]` from `schema/brand.ts` as their
  first member. `sealCLISchema()` in `index.ts` holds the one `as` cast in the file and attaches both
  brands; `buildCLISchema()`, `.config()`, `.configLoader()`, and the `run()` preflight rebuild all
  route through it. Every other rebuild spreads an existing schema, which carries the brand in the
  spread type.
- `createCLISchema()` normalizes commands through `createCommandSchema()`, which clones them. It
  builds descriptions only; `cli()` uses it just for the empty root schema, so the identity
  invariant above is never crossed.
- `builtins.ts` holds `BUILTIN_SPECS`, the ONE spelling table for `help`/`json`/`quiet`. Every
  built-in-aware layer reads it: `root-output-flags.ts` builds its long/short spelling maps from it,
  `reserved-flags.ts` builds the reserved token set from it, `root-help.ts` renders
  `Global options:` from it, and `completion/shells/shared.ts` gates the synthetic root `--help` on
  it. Add a spelling to an existing entry and all four follow. Adding a whole built-in needs
  `BUILTIN_NAMES` updated by hand as well: the `BuiltinName` union forces a `BUILTIN_SPECS` entry
  through `Record` completeness, but nothing forces the `BUILTIN_NAMES` array, and the guard and the
  `Global options:` block both walk that array. `version`/`V` is NOT a built-in — it is opt-in via
  `.version()`, so it stays a local constant in `reserved-flags.ts` and an interception in
  `planner.ts`.
- `.builtins({ <name>: 'off' })` releases a built-in to the commands (#86). Normalized state lives on
  `CLISchema.builtins` (sealed, all three keys present); readers take the partial `BuiltinsConfig`
  and go through `builtinEnabled()`, which defaults an absent key to `'on'`, so an unthreaded reader
  keeps today's behavior. Threading points: `readRootOutputFlags(argv, builtins)`,
  `PlannerSchemaLike.builtins` (root `--help`/`-h`, bare `help`, the `requestsHelp` rescue),
  `InternalRunOptions.builtins` (`executeCommand()`'s help short-circuit),
  `RuntimePreflightSchemaLike.builtins`, `RenderContextOptions.builtins`, and testkit
  `RunCommandOptions.builtins`. `.builtins()` must be called BEFORE the commands that declare a
  released flag — `.command()` rejects the flag while the root still owns the token, and the
  `RESERVED_FLAG` suggest says so.
- `reserved-flags.ts` rejects a command flag spelled like a token the root already owns:
  `quiet`/`q`, `json`, `help`/`h` while their built-in is on, plus `version`/`V` once
  `schema.version` is set (#84). It checks canonical names, aliases (hidden included), and custom
  negated spellings from `.negatable({ alias })`, since all three land in `buildFlagLookup` and any
  of them can spell a reserved token. The guard is deliberately STRICTER than the root strip: it
  rejects the bare `q`/`h`/`V` alias unconditionally, while the strip and interception match only
  the exact `-q`/`-h`/`-V` tokens, so a short cluster like `-vq` still reaches the command. The
  plain spelling is the one users type; `reserved-flags.test.ts` pins both halves.
- `runtime-preflight.ts` re-runs the guard when `.manifest()` filesystem discovery injects a version
  (`assertDiscoveredVersionIsFree`), the one path that lands a version past every build-time check.
- The version half of the guard is bidirectional like the `--completions` guard:
  `.command()`/`.default()` check against the current `schema.version`, and
  `.version()`/`.manifest(data)` re-check every registered command because either can set the
  version after registration. `createCLISchema()` runs the same check, plus
  `assertNoCompletionsFlagCollision()` when the definition carries `completionsFlag`, so both
  construction paths agree; `createCommandSchema()` stays permissive, since a bare command is not
  bound to a root.
- `root-help.ts` uses structural `CLISchemaLike` instead of importing `CLISchema` — avoids circular
  dep through barrel
- `levenshtein()` in `dispatch.ts` uses `Uint16Array` rolling buffer — different impl from `parse/`
- `dispatch.ts` is value-flag-arity aware: the command-name scan skips a space-separated value-flag's
  value (`consumesFollowingToken` + `ValueFlagLookup`, built from the default/matched command's flags)
  so the value isn't mistaken for a command name — reuses `buildFlagLookup`/`flagExpectsValue` from
  `parse/` as the single source of truth (#25)
- `planner.ts` delegates unknown root tokens to `.default()` only when the token is absent/flags-only
  or the default declares positional args. No-arg defaults surface `UNKNOWN_COMMAND` for unknown root
  tokens, while unknown flags before positionals still surface `UNKNOWN_FLAG` (#26).
- `extractConfigFlag()` handles both `--config path` and `--config=path` forms
- `.manifest({ from: import.meta.url })` is the conventional anchored-discovery form. Passing
  `import.meta` whole and using `isMainModule(import.meta)` are compatibility forms for consumers
  whose ambient `ImportMeta` omits `url`/`main` and that cannot use global augmentation on JSR.
- Direct imports: `schema/command.ts`, `schema/flag.ts`, `schema/arg.ts` (not through barrel)
- Cross-layer imports: `runtime/adapter.ts`, `runtime/auto.ts` (not through runtime barrel)
- `planner.ts` orchestrates the execution pipeline — shared with testkit via `execution/`
- `runtime-preflight.ts` handles adapter creation, env loading, config discovery before dispatch

## TEST FILES (26)

| File                              | Tests                                   |
| --------------------------------- | --------------------------------------- |
| `cli.test.ts`                     | Core dispatch, help, errors, version    |
| `cli-json.test.ts`                | JSON mode output + error rendering      |
| `cli-tty.test.ts`                 | TTY detection propagation               |
| `cli-quiet.test.ts`               | Quiet verbosity through the CLI root    |
| `cli-middleware.test.ts`          | Middleware wiring through CLI           |
| `cli-dispatch.test.ts`            | Subcommand dispatch, default commands   |
| `cli-default.test.ts`             | Default command behavior                |
| `cli-nesting.test.ts`             | Nested command groups, deep dispatch    |
| `cli-completions.test.ts`         | Completion integration in CLI context   |
| `cli-completions-flag.test.ts`    | `.completions({ as: 'flag' })` form     |
| `cli-completion-e2e.test.ts`      | End-to-end completion script generation |
| `cli-completion-contract.test.ts` | Completion contract verification        |
| `cli-config.test.ts`              | Config discovery integration            |
| `cli-propagate.test.ts`           | Flag propagation through command tree   |
| `cli-plugin.test.ts`              | Plugin system tests                     |
| `cli-manifest.test.ts`            | Manifest metadata integration           |
| `cli-links.test.ts`               | Help link derivation and overrides      |
| `cli-examples.test.ts`            | Example rendering in help               |
| `cli-flag-order.test.ts`          | Flag ordering in help output            |
| `cli-flag-settings.test.ts`       | Case-parity and flag parse settings     |
| `compiled.test.ts`                | Compiled graph identity + retention     |
| `planner.test.ts`                 | Execution planner tests                 |
| `runtime-preflight.test.ts`       | Runtime preflight adapter setup         |
| `root-help-theme.test.ts`         | Root help theming                       |
| `render-context.test.ts`          | Render context construction             |
| `reserved-flags.test.ts`          | `RESERVED_FLAG` guard for root flags    |
| `builtins.test.ts`                | `.builtins()` release of root built-ins |
