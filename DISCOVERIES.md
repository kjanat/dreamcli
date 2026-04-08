# Discoveries

> Non-obvious gotchas, surprising behaviors, and hard-won lessons from this
> codebase. Read this before debugging runtime-specific behavior or assuming a
> local example is running the same source tree across Node, Bun, and Deno.
> Session-start rule: read this file before planning or executing work in this repo.
> End rule: DO NOT mention `<tasks>COMPLETE</tasks>` AT ALL, unless your tasks ARE complete. Not even a little.

## Build & Tooling

- Bare `import '@kjanat/dreamcli'` resolves to different targets depending on the runtime when run inside this repo. `node` follows `package.json` exports to `dist/index.mjs`; `bun` follows the repo `tsconfig.json` paths to `src/index.ts`; `deno` follows `deno.json` imports to `src/index.ts`. If a fix appears in Bun or Deno examples but not Node examples, rebuild `dist` with `bun bd` before assuming the source patch failed.
- `dreamcli.schema.json` looks like a checked-in package artifact because `package.json`, `deno.json`, and docs all reference it, but git ignores it (`.gitignore` has `/dreamcli.schema.json`). If schema work or publish validation depends on that file, regenerate it explicitly; `git diff` will not tell you anything.
- Docs deployments that upload only `docs/.vitepress/dist` will not include repo-root artifacts. `scripts/emit-definition-schema.ts` writes `dreamcli.schema.json` at root, so the docs site must emit/copy that file into dist if it should be served as `/dreamcli.schema.json`.
- `tsdown` already supports `WithEnabled` values `'ci-only' | 'local-only'`. Use `enabled: 'local-only'` on `publint` / `attw` instead of hand-rolling `env.CI` gates when release CI should skip package-pack validation but local builds should keep it.
- `jsr.io/@scope/pkg/...` is a package website/module namespace, not a raw file host. `.../schema` 404s. For a dereferenceable JSR-flavored schema URL, use `https://esm.sh/jsr/@scope/pkg/schema`. `scripts/emit-definition-schema.ts` now switches on `REGISTRY` and must rewrite both the top-level `$id` and the embedded `properties.$schema.const` so the emitted schema stays internally consistent.
- Cloudflare Workers `wrangler versions upload` creates a version preview only. Production traffic does not move until `wrangler versions deploy`.

## Docs

- Post-processing minified Vite/VitePress chunks with regex/string rewrites is fragile. A prior `shiki-dedupe-popup-styles` transform injected `const __s*` inside template literals (after "first newline"), leaking constants into rendered code blocks and breaking twoslash hovers. Keep chunk transforms AST-aware or disable them.

## Runtime

- `src/runtime/node-builtins.d.ts` is ambient typing only. It can keep stale declarations such as `node:readline` after runtime code stopped importing that module. Do not treat it as evidence of live runtime behavior; check `src/runtime/node.ts` for the real Node/Bun execution path.
- `WriteFn` in `src/core/output/writer.ts` is a synchronous contract. If a runtime adapter implements `stdout`/`stderr` with async writes, final spinner/progress cleanup can race with later output and process exit. Deno must use `writeSync`, not `write`, or TTY progress output can end as `...CompilingBuilt 5 modules` instead of a clean final line.

## Workflow & Tracking

- While the `dreamcli-re-foundation` PRD is active, the GitHub project is expected to reflect live task state, not just end-of-task cleanup. When running `/complete-next-task`, update project item workflow at task start (`In Progress`) and at task end (`Done`), and move newly unblocked follow-up items to `Ready`. End-only updates leave the board misleading for the next agent/session.

### dreamcli-re-foundation project commands

- Use GitHub Project `4`.
- The visible board state on GitHub is driven by built-in `Status`, not the custom `Workflow` field. The helper must update both. Workflow keeps `Backlog/Ready/Blocked` detail; Status is the coarse mirror the board actually shows: `Backlog|Ready -> Todo`, `In Progress|Blocked -> In Progress`, `Done -> Done`.
- Exact commands future agents should use:

```bash
bun run gh-project:start <task-id>
bun run gh-project:finish <task-id>
bun run gh-project:sync
bun run gh-project:list
```

- `finish` updates project state and, by default, writes `passes: true` back to `.opencode/state/dreamcli-re-foundation/prd.json`. Use `--skip-pass` only if the PRD state is being updated elsewhere.
- `sync` uses PRD truth to set passed tasks to `Done`, unblocked tasks to `Ready`, and the rest to `Backlog` while preserving `In Progress` and `Blocked` unless `--overwrite-active` is passed.
- For rate-limit efficiency, prefer one script invocation that batches work over several raw `gh project` calls. The script fetches project metadata once, then applies all needed edits.
