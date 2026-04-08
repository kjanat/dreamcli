# Consumer Workflow

## Goal

Build a consumer-facing CLI app with DreamCLI, starting from a working template and ending with validated behavior.

## Inputs to confirm

- CLI name (`--name`).
- Surface shape (`single` or `multi`).
- Whether tests should be skipped (`--no-test`).
- Runtime instructions needed by the user (Bun, npm/tsx, Deno).

## Implementation flow

1. Scaffold starter files.

   ```bash
   python scripts/scaffold_cli.py --name mycli --mode single --out .
   ```

   The scaffolder detects package manager and Vitest usage to choose either a `bun:test` or Vitest starter test template.

2. Implement command behavior.

   - Add `.description(...)` on all commands.
   - Add typed `.arg(...)` and `.flag(...)` declarations.
   - Keep action handlers focused on business logic only.

3. Add typed value resolution.

   - Use `.env('...')` for environment values.
   - Use `.config('...')` for config values.
   - Use `.prompt(...)` for interactive fallback.
   - Use `.default(...)` for stable action-time values.

4. Add output behavior.

   - Use `out.log()` for human messages.
   - Use `out.table()` for list-shaped data.
   - For object responses, branch on `out.jsonMode` and use `out.json(data)`.

5. Validate behavior.

   ```bash
   bun ./mycli.ts --help
   bun test ./mycli.test.ts
   ```

## Done criteria

- `--help` renders expected command and flag descriptions.
- Happy-path command execution exits with `0`.
- Generated or custom tests pass.
- No mixed human and machine output in `--json` mode.
