# cli — CLIBuilder, multi-command dispatch, plugins

`index.ts` (~1015 lines) — heavily split: 7 `@internal` extraction files.

## KEY TYPES

| Symbol             | Role                                                        |
| ------------------ | ----------------------------------------------------------- |
| `CLIBuilder`       | Fluent builder: `.command()`, `.default()`, `.execute()`    |
| `cli(name)`        | Factory function -> `CLIBuilder`                            |
| `CLISchema`        | Runtime descriptor for the full CLI                         |
| `CLIRunOptions`    | Extends `RunOptions` with CLI-level settings                |
| `ConfigSettings`   | Config file discovery settings for CLI                      |
| `ErasedCommand`    | `@internal` — type-erased command for dispatch map          |
| `formatRootHelp()` | `@internal` — root-level help rendering (in `root-help.ts`) |

## FILES

| File                   | Lines | Purpose                                                              |
| ---------------------- | ----: | -------------------------------------------------------------------- |
| `index.ts`             |  1015 | CLIBuilder class + cli() factory + JSON error handling               |
| `dispatch.ts`          |   285 | `@internal` — command dispatch, nested resolution, levenshtein       |
| `planner.ts`           |   345 | `@internal` — execution planner, command resolution strategy         |
| `runtime-preflight.ts` |   304 | `@internal` — runtime adapter setup, env/config preflight            |
| `plugin.ts`            |   111 | `@internal` — plugin system + lifecycle hooks                        |
| `propagate.ts`         |    87 | `@internal` — flag propagation through command tree                  |
| `root-surface.ts`      |    74 | `@internal` — root-level CLI surface (version, help flags)           |
| `root-help.ts`         |   133 | `@internal` — root-level help text + text helpers, structural schema |

## DISPATCH FLOW

```
argv -> strip --json flag -> match subcommand (nested) -> resolve -> middleware -> action -> output
        | (no match)
        -> error (unknown command / no action) -> render as JSON if --json
```

Nested dispatch: `group('db').command(migrate).command(seed)` -> `mycli db migrate --force`

## `execute()` METHOD

Handles 6 concerns sequentially: `--json` extraction, `--version`, `--help`, no-commands error,
command map building, 3-way dispatch result (`unknown` / `needs-subcommand` / `match`).

## `--json` MODE

- Stripped from argv before command dispatch
- CLI-level errors rendered as JSON when active
- Propagated to `OutputChannel` via `jsonMode` option
- `out.log`/`out.info` redirect to stderr in JSON mode (stdout reserved for data)

## GOTCHAS

- `root-help.ts` uses structural `CLISchemaLike` instead of importing `CLISchema` — avoids circular
  dep through barrel
- `levenshtein()` in `dispatch.ts` uses `Uint16Array` rolling buffer — different impl from `parse/`
- `extractConfigFlag()` handles both `--config path` and `--config=path` forms
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
