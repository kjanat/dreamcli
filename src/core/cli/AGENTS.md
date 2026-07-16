# cli — CLIBuilder, multi-command dispatch, plugins

`index.ts` (~1021 lines) — heavily split: 7 `@internal` extraction files.

## KEY TYPES

| Symbol                     | Role                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `CLIBuilder`               | Fluent builder: `.command()`, `.default()`, `.execute()`                |
| `cli(name)`                | Factory function -> `CLIBuilder`                                        |
| `isMainModule(meta)`       | Entrypoint guard for ambient `ImportMeta` compatibility                 |
| `CLISchema`                | Runtime descriptor for the full CLI                                     |
| `CLIRunOptions`            | Extends `RunOptions` with CLI-level settings                            |
| `ConfigSettings`           | Config file discovery settings for CLI                                  |
| `ErasedCommand`            | `@internal` — type-erased command for dispatch map                      |
| `formatRootHelp()`         | `@internal` — root-level help rendering (in `root-help.ts`)             |
| `ValueFlagLookup`          | `@internal` — value-flag arity lookup threaded into `dispatch()`        |
| `consumesFollowingToken()` | `@internal` — whether a flag token consumes the next argv token (arity) |

## FILES

| File                   | Lines | Purpose                                                              |
| ---------------------- | ----: | -------------------------------------------------------------------- |
| `index.ts`             |  1021 | CLIBuilder class + cli() factory + JSON error handling               |
| `dispatch.ts`          |   349 | `@internal` — command dispatch (value-flag-arity aware), levenshtein |
| `planner.ts`           |   431 | `@internal` — execution planner, command resolution strategy         |
| `runtime-preflight.ts` |   304 | `@internal` — runtime adapter setup, env/config preflight            |
| `plugin.ts`            |   111 | `@internal` — plugin system + lifecycle hooks                        |
| `propagate.ts`         |    87 | `@internal` — flag propagation through command tree                  |
| `root-surface.ts`      |    74 | `@internal` — root-level CLI surface (version, help flags)           |
| `root-help.ts`         |   133 | `@internal` — root-level help text + text helpers, structural schema |

## DISPATCH FLOW

```
argv -> strip --json flag (before --) -> match subcommand (nested) -> resolve -> middleware -> action -> output
        | (no match)
        -> error (unknown command / no action) -> render as JSON if --json
```

Nested dispatch: `group('db').command(migrate).command(seed)` -> `mycli db migrate --force`

## `execute()` METHOD

Handles 6 concerns sequentially: `--json` extraction, `--version`, `--help`, no-commands error,
command map building, 3-way dispatch result (`unknown` / `needs-subcommand` / `match`).

## `--json` MODE

- Stripped from argv before command dispatch, but only before the `--` separator (a `--json` after
  `--` stays a literal positional)
- CLI-level errors rendered as JSON when active
- Propagated to `OutputChannel` via `jsonMode` option
- `out.log`/`out.info` redirect to stderr in JSON mode (stdout reserved for data)

## GOTCHAS

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

## TEST FILES (16)

| File                              | Tests                                   |
| --------------------------------- | --------------------------------------- |
| `cli.test.ts`                     | Core dispatch, help, errors, version    |
| `cli-json.test.ts`                | JSON mode output + error rendering      |
| `cli-tty.test.ts`                 | TTY detection propagation               |
| `cli-middleware.test.ts`          | Middleware wiring through CLI           |
| `cli-dispatch.test.ts`            | Subcommand dispatch, default commands   |
| `cli-default.test.ts`             | Default command behavior                |
| `cli-nesting.test.ts`             | Nested command groups, deep dispatch    |
| `cli-completions.test.ts`         | Completion integration in CLI context   |
| `cli-completion-e2e.test.ts`      | End-to-end completion script generation |
| `cli-completion-contract.test.ts` | Completion contract verification        |
| `cli-config.test.ts`              | Config discovery integration            |
| `cli-propagate.test.ts`           | Flag propagation through command tree   |
| `cli-plugin.test.ts`              | Plugin system tests                     |
| `cli-package-json.test.ts`        | Package.json metadata integration       |
| `planner.test.ts`                 | Execution planner tests                 |
| `runtime-preflight.test.ts`       | Runtime preflight adapter setup         |
