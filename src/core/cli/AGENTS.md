# cli — CLIBuilder, multi-command dispatch

`index.ts` — approaching split threshold (~700 lines).

## KEY TYPES

| Symbol             | Role                                                     |
| ------------------ | -------------------------------------------------------- |
| `CLIBuilder`       | Fluent builder: `.command()`, `.default()`, `.execute()` |
| `cli(name)`        | Factory function → `CLIBuilder`                          |
| `CLISchema`        | Runtime descriptor for the full CLI                      |
| `CLIRunOptions`    | Extends `RunOptions` with CLI-level settings             |
| `ErasedCommand`    | `@internal` — type-erased command for dispatch map       |
| `formatRootHelp()` | `@internal` — root-level help rendering                  |

## DISPATCH FLOW

```
argv → strip --json flag → match subcommand → resolve → middleware → action → output
       ↓ (no match)
       → error (unknown command / no action) → render as JSON if --json
```

## `--json` MODE

- Stripped from argv before command dispatch
- CLI-level errors rendered as JSON when active
- Propagated to `OutputChannel` via `jsonMode` option
- `out.log`/`out.info` redirect to stderr in JSON mode (stdout reserved for data)

## TEST FILES

| File                     | Tests                              |
| ------------------------ | ---------------------------------- |
| `cli.test.ts`            | Core dispatch, help, errors        |
| `cli-json.test.ts`       | JSON mode output + error rendering |
| `cli-tty.test.ts`        | TTY detection propagation          |
| `cli-middleware.test.ts` | Middleware wiring through CLI      |
