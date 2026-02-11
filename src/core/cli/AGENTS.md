# cli — CLIBuilder, multi-command dispatch

`index.ts` (~900 lines) — partially split: `dispatch.ts` + `propagate.ts` extracted as `@internal`.

## KEY TYPES

| Symbol             | Role                                                     |
| ------------------ | -------------------------------------------------------- |
| `CLIBuilder`       | Fluent builder: `.command()`, `.default()`, `.execute()` |
| `cli(name)`        | Factory function → `CLIBuilder`                          |
| `CLISchema`        | Runtime descriptor for the full CLI                      |
| `CLIRunOptions`    | Extends `RunOptions` with CLI-level settings             |
| `ConfigSettings`   | Config file discovery settings for CLI                   |
| `ErasedCommand`    | `@internal` — type-erased command for dispatch map       |
| `formatRootHelp()` | `@internal` — root-level help rendering                  |

## FILES

| File           | Lines | Purpose                                                            |
| -------------- | ----: | ------------------------------------------------------------------ |
| `index.ts`     |   900 | CLIBuilder class + cli() factory + root help + JSON error handling |
| `dispatch.ts`  |   285 | `@internal` — command dispatch, nested resolution, levenshtein     |
| `propagate.ts` |    87 | `@internal` — flag propagation through command tree                |

## DISPATCH FLOW

```
argv → strip --json flag → match subcommand (nested) → resolve → middleware → action → output
       ↓ (no match)
       → error (unknown command / no action) → render as JSON if --json
```

Nested dispatch: `group('db').command(migrate).command(seed)` → `mycli db migrate --force`

## `execute()` METHOD (~145 lines)

Handles 6 concerns sequentially: `--json` extraction, `--version`, `--help`, no-commands error,
command map building, 3-way dispatch result (`unknown` / `needs-subcommand` / `match`).

## `--json` MODE

- Stripped from argv before command dispatch
- CLI-level errors rendered as JSON when active
- Propagated to `OutputChannel` via `jsonMode` option
- `out.log`/`out.info` redirect to stderr in JSON mode (stdout reserved for data)

## GOTCHAS

- `padEnd()` and `wrapText()` duplicated from `help/` module — intentional, avoids coupling
- `levenshtein()` in `dispatch.ts` uses `Uint16Array` rolling buffer — different impl from `parse/`
- `uniqueCommands()` deduplicates via `Set` on command name — `@internal`
- `extractConfigFlag()` handles both `--config path` and `--config=path` forms
- Direct imports: `schema/command.js`, `schema/flag.js`, `schema/arg.js` (not through barrel)
- Cross-layer imports: `runtime/adapter.js`, `runtime/auto.js` (not through runtime barrel)

## TEST FILES (10)

| File                         | Tests                                   |
| ---------------------------- | --------------------------------------- |
| `cli.test.ts`                | Core dispatch, help, errors, version    |
| `cli-json.test.ts`           | JSON mode output + error rendering      |
| `cli-tty.test.ts`            | TTY detection propagation               |
| `cli-middleware.test.ts`     | Middleware wiring through CLI           |
| `cli-dispatch.test.ts`       | Subcommand dispatch, default commands   |
| `cli-nesting.test.ts`        | Nested command groups, deep dispatch    |
| `cli-completions.test.ts`    | Completion integration in CLI context   |
| `cli-completion-e2e.test.ts` | End-to-end completion script generation |
| `cli-config.test.ts`         | Config discovery integration            |
| `cli-propagate.test.ts`      | Flag propagation through command tree   |
