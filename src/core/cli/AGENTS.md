# cli — CLIBuilder, multi-command dispatch, plugins

`index.ts` (~2214 lines) — heavily split: 9 `@internal` extraction files.

## KEY TYPES

| Symbol                     | Role                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `CLIBuilder`               | Fluent builder: `.command()`, `.default()`, `.execute()`                |
| `cli(name)`                | Factory function -> `CLIBuilder`                                        |
| `isMainModule(meta)`       | Entrypoint guard for ambient `ImportMeta` compatibility                 |
| `CLISchema`                | Runtime descriptor for the full CLI, execution graph excluded           |
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

| File                   | Lines | Purpose                                                              |
| ---------------------- | ----: | -------------------------------------------------------------------- |
| `index.ts`             |  2214 | CLIBuilder class + cli() factory + JSON error handling               |
| `runtime-preflight.ts` |   488 | `@internal` — runtime adapter setup, env/config preflight            |
| `planner.ts`           |   674 | `@internal` — execution planner, command resolution strategy         |
| `dispatch.ts`          |   365 | `@internal` — command dispatch (value-flag-arity aware), levenshtein |
| `root-help.ts`         |   364 | `@internal` — root-level help text + text helpers, structural schema |
| `compiled.ts`          |   138 | `@internal` — compiled execution graph + `compileCommand()`          |
| `plugin.ts`            |   117 | `@internal` — plugin system + lifecycle hooks                        |
| `propagate.ts`         |    97 | `@internal` — flag propagation through command tree                  |
| `root-surface.ts`      |    96 | `@internal` — root-level CLI surface (version, help flags)           |
| `help-links.ts`        |    82 | `@internal` — help link derivation from manifest metadata            |

## DISPATCH FLOW

```
argv -> strip --json flag (before --) -> match subcommand (nested) -> resolve -> middleware -> action -> output
        | (no match)
        -> error (unknown command / no action) -> render as JSON if --json
```

Nested dispatch: `group('db').command(migrate).command(seed)` -> `mycli db migrate --force`

## `executeCLI()`

Module-level function taking the builder as its first parameter; `.execute()` and `.run()` both
delegate to it. It detects root `--json` / `--quiet`, builds or adopts the output channel, resolves
help options, then calls `planInvocation()` and renders the plan. `planner.ts` owns command map
building and the no-commands error; `executeCLI()` renders the six plan kinds: `root-version`,
`root-completions`, `root-help`, `dispatch-error`, `needs-subcommand`, and `match`.

## `--json` MODE

- Stripped from argv before command dispatch, but only before the `--` separator (a `--json` after
  `--` stays a literal positional)
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

## TEST FILES (25)

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
| `cli-package-json.test.ts`        | Package.json metadata integration       |
| `cli-links.test.ts`               | Help link derivation and overrides      |
| `cli-examples.test.ts`            | Example rendering in help               |
| `cli-flag-order.test.ts`          | Flag ordering in help output            |
| `cli-flag-settings.test.ts`       | Case-parity and flag parse settings     |
| `compiled.test.ts`                | Compiled graph identity + retention     |
| `planner.test.ts`                 | Execution planner tests                 |
| `runtime-preflight.test.ts`       | Runtime preflight adapter setup         |
| `root-help-theme.test.ts`         | Root help theming                       |
| `render-context.test.ts`          | Render context construction             |
