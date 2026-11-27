# scripts: build, release, and checks

Bun-first host tooling. `process.*`, `node:*`, and external CLIs are allowed here.

## WHERE TO LOOK

| Task                                | Location                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Generated schema descriptions       | `build-meta-descriptions.ts` writes `src/core/json-schema/meta-descriptions.generated.ts`                  |
| Root definition schema              | `emit-definition-schema.ts`. `tsdown` calls it on `build:prepare`. `bun run schema:emit` calls it directly |
| package.json and deno.json versions | `check-version-sync.ts`                                                                                    |
| npm tarball and hot-path budget     | `check-package-budget.ts`, part of `bd`                                                                    |
| Lazy feature imports                | `check-lazy-loading.ts`, fixtures in `lazy-loading/`                                                       |
| Published bundle entry shape        | `check-consumer-bundles.ts`, fixtures in `consumer-bundles/`                                               |
| Feature-loader bundle graph         | `packaging/bundle-features.ts`                                                                             |
| Deno adapter smoke                  | `deno-smoke-test.ts`                                                                                       |
| GitHub Project 4                    | `gh-project.ts` and `gh-project/`                                                                          |
| Release tag metadata                | `release-meta.sh`                                                                                          |
| PR autofix                          | `autofix-pr.ts`                                                                                            |

## ANTI-PATTERNS

- Do not hand-edit a generated artifact when one of these scripts writes it
- Do not call `gh project` for task state. Use `bun run gh-project:*`
- Do not treat this directory as core. It imports docs data and mutates the repo

## NOTES

- `gh-project` defaults to project `4` and walks upward for `.opencode/state/dreamcli-re-foundation/prd.json`. This checkout has no `prd.json`
- The helper writes GitHub `Status` and the custom `Workflow` field. `Backlog` and `Ready` map to Status `Todo`. `In Progress` and `Blocked` map to `In Progress`. `Done` maps to `Done`
- `emit-definition-schema.ts` switches on `REGISTRY` and rewrites both `$id` and `properties.$schema.const`
