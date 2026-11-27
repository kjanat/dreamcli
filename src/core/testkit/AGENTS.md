# testkit: in-process harness

Public entry `@kjanat/dreamcli/testkit` (`src/testkit.ts`). `runCommand()` builds capture output and calls `execution/`.

## SURFACE

`RunResult` comes from `schema/run.ts`: `exitCode`, `stdout`, `stderr`, `activity`, optional `error`, `skippedPathChecks`.

`RunOptions` injects `env`, `config`, `answers`, `prompter`, `verbosity`, `jsonMode`, `isTTY`, `help`, `stat`, `mkdir`, and `pathChecks`. `cli().run()` always supplies the adapter filesystem, so its skipped-path list stays empty.

## ANTI-PATTERNS

- Do not spawn a process to test a command built in this repo. `runCommand()` is the harness
- Do not assert stdout without the trailing newline. Captured lines look like `['Hello\n']`
- Do not import command, flag, or arg builders through the schema barrel

## NOTES

- JSON assertions parse `result.stdout[0]`
- Structured failures use `result.error?.code`
- `CaptureOutputChannel` records `activity`
- `mergedSchema` on `RunOptions` is `@internal`, for callers that already dispatched
