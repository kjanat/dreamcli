# examples: docs source and consumer canaries

Root `*.ts` files are the source for docs example pages. `gh/` and `pwsh-demo/` are Bun workspace packages.

## FILES

Single-file examples: `argv-transforms.ts`, `basic.ts`, `command-inspection.ts`, `flag-types.ts`, `help-config.ts`, `interactive.ts`, `json-mode.ts`, `middleware.ts`, `multi-command.ts`, `output-extras.ts`, `parser-control.ts`, `spinner-progress.ts`, `standard-schema.ts`, `testing.ts`, `transport-launcher.ts`.

| Path         | Role                                                               |
| ------------ | ------------------------------------------------------------------ |
| `gh/`        | miniature GitHub CLI. `bun run typecheck:gh` and `bun run test:gh` |
| `pwsh-demo/` | PowerShell completion install and native smoke                     |

## CONVENTIONS

- The top docblock is a contract: title line, optional prose, `Demonstrates:`, `Usage:`
- Imports use the public package entry, not `#internals/*`
- Docs metadata is parsed by `docs/.vitepress/data/examples.ts`
- Related API links come from the named imports in the example

## ANTI-PATTERNS

- Do not edit `docs/examples/` when the change belongs in one of these files
- Do not put walkthrough-only commands in a single-file example. That belongs in `gh/`
- Do not change PowerShell install behavior without `pwsh-demo` smoke coverage and the docs page
