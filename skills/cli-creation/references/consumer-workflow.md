# Consumer Workflow

## Goal

Build a consumer-facing CLI app with DreamCLI 3.x, starting from a working
template and ending with validated behavior.

## Inputs to confirm

- CLI name (`--name`).
- Surface shape (`single` or `multi`).
- Whether tests should be skipped (`--no-test`).
- Runtime the user runs on (Bun, npm/tsx, Deno).
- Whether the CLI needs machine-readable output, config files, or prompts —
  each adds declarations to the schema rather than code to the action.

## Implementation flow

1. Scaffold starter files.

   ```bash
   python scripts/scaffold_cli.py --name mycli --mode single --out .
   ```

   The scaffolder detects the package manager and Vitest usage to choose either
   a `bun:test` or Vitest starter test template.

2. Shape the command surface.

   - `.description(...)` on every command; it is what `--help` shows.
   - Function-form `.example()` so examples print the real program name.
   - Typed `.arg(...)` and `.flag(...)` declarations before any logic.
   - A single root command belongs in `.default(cmd)`; add `{ route: true }`
     only if `mycli <name>` should also work.

3. Declare where values come from.

   - `.env('...')`, `.config('...')`, `.prompt(...)`, `.default(...)`.
   - Constraints (`{ int: true, min: 1 }`, `{ nonEmpty: true }`) or a Standard
     Schema in `flag.custom(...)` instead of validation code in the action.
   - Cross-flag rules go in `.derive()`, not the action.

4. Choose output behavior deliberately.

   - `out.log()` for the result a user pipes.
   - `out.status()` for progress notes — stderr, silenced by `--quiet`.
   - `out.table()` for list-shaped data.
   - `out.json(data)` behind `if (out.jsonMode)`, never mixed with prose.
   - `out.setExitCode(code)` for check/status commands that must still print.

5. Validate behavior.

   ```bash
   bun ./mycli.ts --help
   bun ./mycli.ts --json | jq .      # stdout must parse
   bun test ./mycli.test.ts
   ```

## Done criteria

- `--help` renders expected command, flag, and example text.
- Happy-path execution exits `0`; failure paths exit non-zero with a `suggest`.
- `--json` stdout parses on its own — no human text, no progress lines.
- `--quiet` silences status output without hiding warnings or errors.
- Generated or custom tests pass, including trailing-newline assertions.
