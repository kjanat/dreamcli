# gh-project — GitHub Project workflow helper

DreamCLI-powered CLI for managing the re-foundation GitHub project. Bun-native workspace package.

## FILES

| File                     | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `src/main.ts`            | Entrypoint — `ghProject.run()`                        |
| `src/index.ts`           | CLI definition — `cli('gh-project')` + 5 commands     |
| `src/commands/list.ts`   | List project tasks with status/workflow               |
| `src/commands/start.ts`  | Mark task `In Progress` in project + PRD              |
| `src/commands/finish.ts` | Mark task `Done`, write `passes: true` to PRD         |
| `src/commands/set.ts`    | Set workflow field on a project item                  |
| `src/commands/sync.ts`   | Batch-sync PRD state -> GitHub Project state          |
| `src/lib/project.ts`     | GitHub GraphQL queries + project mutations            |
| `src/lib/prd.ts`         | `.opencode/state/dreamcli-re-foundation/prd.json` I/O |
| `src/lib/shared.ts`      | Shared constants (project number, field names)        |
| `src/lib/types.ts`       | Shared types                                          |

## CONVENTIONS

- Extends DreamCLI via workspace dep; commands use `command()` + `flag.*()` builder API
- Uses `#commands/*` and `#lib/*` subpath imports (package.json `imports` field)
- All GitHub API calls go through `src/lib/project.ts`; no raw `gh project` in commands
- PRD state file is the local source of truth; GitHub Project is the remote mirror

## ANTI-PATTERNS

- Do not call `gh project` directly — use this CLI surface
- Do not edit PRD state outside `src/lib/prd.ts`
- Do not forget to update both `Status` (board-visible) and `Workflow` (detail) fields

## NOTES

- `finish` writes `passes: true` to PRD by default; use `--skip-pass` to suppress
- `sync` is idempotent; safe to re-run after manual project edits
- GitHub Project number is `4`, hardcoded in `src/lib/shared.ts`
