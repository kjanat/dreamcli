# Discoveries

> Non-obvious gotchas, surprising behaviors, and hard-won lessons from this
> codebase. Read this before debugging runtime-specific behavior or assuming a
> local example is running the same source tree across Node, Bun, and Deno.

## Build & Tooling

- Bare `import 'dreamcli'` resolves to different targets depending on the runtime when run inside this repo. `node` follows `package.json` exports to `dist/index.mjs`; `bun` follows the repo `tsconfig.json` paths to `src/index.ts`; `deno` follows `deno.jsonc` imports to `src/index.ts`. If a fix appears in Bun or Deno examples but not Node examples, rebuild `dist` with `bun bd` before assuming the source patch failed.

## Runtime

- `src/runtime/node-builtins.d.ts` is ambient typing only. It can keep stale declarations such as `node:readline` after runtime code stopped importing that module. Do not treat it as evidence of live runtime behavior; check `src/runtime/node.ts` for the real Node/Bun execution path.
- `WriteFn` in `src/core/output/writer.ts` is a synchronous contract. If a runtime adapter implements `stdout`/`stderr` with async writes, final spinner/progress cleanup can race with later output and process exit. Deno must use `writeSync`, not `write`, or TTY progress output can end as `...CompilingBuilt 5 modules` instead of a clean final line.
