# Discoveries

> Non-obvious gotchas, surprising behaviors, and hard-won lessons from this
> codebase. Read this before debugging runtime-specific behavior or assuming a
> local example is running the same source tree across Node, Bun, and Deno.
> Session-start rule: read this file before planning or executing work in this repo.
> End rule: DO NOT mention `<tasks>COMPLETE</tasks>` AT ALL, unless your tasks ARE complete. Not even a little.

## Build & Tooling

- Bare `import '@kjanat/dreamcli'` resolves to different targets depending on the runtime when run inside this repo. `node` follows `package.json` exports to `dist/index.mjs`; `bun` follows the repo `tsconfig.json` paths to `src/index.ts`; `deno` follows `deno.json` imports to `src/index.ts`. If a fix appears in Bun or Deno examples but not Node examples, rebuild `dist` with `bun bd` before assuming the source patch failed.
- `dreamcli.schema.json` is tracked. Changes to source JSDoc can update `src/core/json-schema/meta-descriptions.generated.ts` and then the root schema. Run `bun run meta-descriptions` and `bun run schema:emit`, and commit both generated changes when needed. The emitter applies the configured kprint schema ordering; docs CI rejects any tracked or untracked changes left by the build.
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

- `scripts/gh-project.ts` defaults to GitHub Project `4` and PRD name `dreamcli-re-foundation`. `list`, `sync`, and `finish` search upward from cwd for `.opencode/state/<name>/prd.json`, which is absent in this checkout. `start` and `set` update existing project items directly.
- The visible board is built-in `Status`. The helper also writes the custom `Workflow` field. `statusForWorkflow()` maps `Backlog` and `Ready` to `Todo`, `In Progress` and `Blocked` to `In Progress`, and `Done` to `Done`.
- `finish` writes `passes: true` into `prd.json` unless `--skip-pass` is set. `sync` always moves passed tasks to `Done`. For unpassed tasks it preserves `In Progress` and `Blocked` unless `--overwrite-active` is set. It assigns the remaining tasks to `Ready` or `Backlog` according to their dependencies.
