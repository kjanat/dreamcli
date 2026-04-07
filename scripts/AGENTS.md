# scripts — Build, release, and workflow automation

## OVERVIEW

Operational scripts live here. They are Bun-first, side-effectful, and tightly coupled to CI,
publishing, generated artifacts, and the re-foundation project workflow.

## STRUCTURE

```text
build-meta-descriptions.ts # rebuild generated source from docs data
check-version-sync.ts      # package.json <-> deno.json guard
deno-smoke-test.ts         # runtime smoke verification
emit-definition-schema.ts  # writes root `dreamcli.schema.json`
gh-project.ts              # thin wrapper for project helper CLI
gh-project/                # typed command surface for project automation
release-meta.sh            # release tag metadata for workflows
```

## WHERE TO LOOK

| Task                            | Location                       | Notes                                                                           |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| Regenerate source descriptions  | `build-meta-descriptions.ts`   | imports docs data; writes `src/core/json-schema/meta-descriptions.generated.ts` |
| Emit definition schema artifact | `emit-definition-schema.ts`    | writes root `dreamcli.schema.json`                                              |
| Enforce version consistency     | `check-version-sync.ts`        | package and deno versions must match                                            |
| Verify Deno runtime             | `deno-smoke-test.ts`           | CI/runtime guard                                                                |
| Update GitHub project workflow  | `gh-project/`, `gh-project.ts` | DreamCLI-powered helper, not ad hoc shell                                       |
| Compute release metadata        | `release-meta.sh`              | workflow env and tag parsing                                                    |

## CONVENTIONS

- Inspect the shebang and imports before editing; this directory mixes Bun TypeScript and shell
- Scripts may use `process.*`, `node:*`, or external CLIs because they are host-side tooling, not
  core library code
- `gh-project` is a real DreamCLI app; extend the command surface there instead of bolting shell
  logic onto workflows
- Favor deterministic exit codes and messages; CI and workflow callers depend on them

## ANTI-PATTERNS

- Do not bypass `check-version-sync.ts` or `release-meta.sh` checks in publish flows
- Do not hand-edit generated artifacts when a script is already the source of truth
- Do not replace `bun run gh-project:*` with ad hoc `gh project` calls for routine task-state
  updates
- Do not assume scripts are isolated from docs; `build-meta-descriptions.ts` and docs data are
  coupled

## NOTES

- `gh-project` mutates both GitHub Project `4` and `.opencode/state/dreamcli-re-foundation/prd.json`
- `emit-definition-schema.ts` matters to both package builds and docs deploys
