# PROJECT KNOWLEDGE BASE

**Generated:** 2026-11-27 **Commit:** 7ea80c61 **Branch:** docs/reduce-page-payloads

## OVERVIEW

Schema-first TypeScript CLI framework. One runtime dependency, `ansispeck`. Published
`package.json` exports point at `dist/*.mjs` on every runtime. Inside this repo, `tsconfig.json`
paths and `deno.json` exports point at `src/*.ts`, so Bun and Deno load source and Node loads `dist`.

Read @DISCOVERIES.md before planning, editing, or running task workflows.

## STRUCTURE

```text
src/
├── index.ts completion.ts config.ts json-schema.ts prompt.ts
├── runtime.ts schema.ts testkit.ts version.ts strings.ts
├── core/
│   ├── cli/           # CLIBuilder, dispatch, plugins, inspection
│   ├── schema/        # command, flag, arg, middleware, value layer
│   ├── parse/         # tokenizer, occurrence model, argv boundaries
│   ├── resolve/       # argv -> stdin -> env -> config -> prompt -> default
│   ├── execution/     # shared parse/resolve/handler path for cli and testkit
│   ├── read-flags/    # readFlags() over a flag record, no command dispatch
│   ├── output/        # OutputChannel, tables, spinner, progress
│   ├── help/          # schema-driven help text
│   ├── prompt/        # prompt engines, sessions, test prompter
│   ├── completion/    # shell completion generators, dynamic completions
│   ├── config/        # config discovery and manifest() walk-up
│   ├── json-schema/   # definition schema and input schema
│   ├── errors/        # CLIError, ParseError, ValidationError
│   ├── testkit/       # runCommand()
│   └── feature-loaders.ts
└── runtime/           # Node/Bun/Deno adapters

docs/                  # VitePress site. Prose in guide/ and concepts/
examples/              # runnable examples, gh/ and pwsh-demo/ workspaces
scripts/               # build, release, package checks, gh-project
skills/cli-creation/   # published consumer skill
```

## WHERE TO LOOK

| Task                                  | Location                        | Notes                                         |
| ------------------------------------- | ------------------------------- | --------------------------------------------- |
| Command, flag, arg, or middleware API | `src/core/schema/`              | public API work starts here                   |
| Argv parsing                          | `src/core/parse/`               | tokenizer, occurrences, argv boundaries       |
| Resolution precedence                 | `src/core/resolve/`             | order lives in `schema/source.ts`             |
| Command execution shared with tests   | `src/core/execution/`           | cli and testkit both call it                  |
| `readFlags()`                         | `src/core/read-flags/`          | flag record, no subcommands                   |
| Help text                             | `src/core/help/`                | width-aware formatter                         |
| Config discovery or `manifest()`      | `src/core/config/`              | loaded on demand                              |
| Prompts                               | `src/core/prompt/`              | terminal engine stays off the static path     |
| JSON Schema                           | `src/core/json-schema/`         | definition schema and input schema            |
| Output, spinner, progress, color      | `src/core/output/`              | `ansispeck` colors                            |
| Shell completions                     | `src/core/completion/`          | generators load through `feature-loaders.ts`  |
| Dispatch, plugins, inspect            | `src/core/cli/`                 | root help, builtins, preflight                |
| Structured errors                     | `src/core/errors/`              | codes, exit codes, redaction                  |
| Runtime adapters                      | `src/runtime/`                  | Node, Bun, Deno                               |
| Docs site internals                   | `docs/.vitepress/`              | data loaders, theme, Vite plugins             |
| Guide or concept prose                | `docs/guide/`, `docs/concepts/` | hand-authored Markdown                        |
| Build, release, package budgets       | `scripts/`                      | host-side scripts                             |
| Examples or the consumer canaries     | `examples/`                     | `gh/` and `pwsh-demo/` are workspace packages |

## CONVENTIONS

- Tabs, single quotes, semicolons, LF
- `import type` for type-only imports
- `.ts` extensions on relative imports
- `exactOptionalPropertyTypes`: an omitted optional field is a conditional spread
- Named re-exports. No `export *`
- `@module` JSDoc on source files. `@internal` marks non-public API
- Public API is factory-first: `cli()`, `command()`, `flag.*()`, `createOutput()`, `createAdapter()`
- Tests are co-located `*.test.ts`
- Tests use no lifecycle hooks, no snapshots, no module mocks
- Output assertions include the trailing `\n`
- Core stays runtime-agnostic. Host I/O goes through `RuntimeAdapter`, `WriteFn`, or `ReadFn`
- Optional features load through `src/core/feature-loaders.ts`. Callers on the hot path use `await import(...)`

## ANTI-PATTERNS (THIS PROJECT)

- Do not add a runtime dependency. `ansispeck` is the existing one
- Do not use `process.*` or a runtime-specific API in `src/core/`
- Do not import through a barrel when the direct file exists. `cli/`, `completion/`, `output/`, `prompt/`, `resolve/`, and `runtime/` do this on purpose
- Do not hand-edit `dreamcli.schema.json` or `src/core/json-schema/meta-descriptions.generated.ts`
- Do not edit `docs/.vitepress/dist/` or `docs/.vitepress/cache/`
- Do not treat `docs/.vitepress/data/` as docs-only. `scripts/build-meta-descriptions.ts` imports it
- Do not replace `bun run gh-project:*` with ad hoc `gh project` calls

## COMMANDS

```bash
bun install --frozen-lockfile
bun run typecheck                  # tsrs --noEmit
bun run lint                       # biome
bun run format:check               # kprint
bun run fmt                        # biome --fix, then kprint
bun run test                       # vitest
bun run test:bun                   # vitest under Bun
bun run test:node                  # vitest under Node
bun run test:gh                    # examples/gh
bun run typecheck:gh
bun run meta-descriptions          # writes meta-descriptions.generated.ts
bun run meta-descriptions:check
bun run schema:emit                # writes dreamcli.schema.json
bun run docs:dev                   # VitePress, port 5173 unless PORT is set
bun run docs:build
bun run bd                         # tsdown build, dist typecheck, package budget, lazy and bundle checks
bun run ci                         # typecheck, lint, format, meta, test, docs, bd
bun run gh-project:list
```

Engines: Bun `packageManager` pin 1.4.5 (`engines.bun` `>=1.3`), Node `>=22.22.2` (`.node-version` is 26.13.1), Deno `>=2.6.0`.

## NOTES

- Public subpaths: `.`, `./completion`, `./config`, `./json-schema`, `./prompt`, `./runtime`, `./testkit`, `./version`, `./schema`
- `./schema` on npm is `dreamcli.schema.json`. The in-repo `@kjanat/dreamcli/schema` path is `src/schema.ts`, which re-exports that JSON
- `tsdown.config.ts` calls `emitDefinitionSchema()` on `build:prepare` and formats `package.json` on success. CI also runs `schema:emit` and fails a docs build that leaves the worktree dirty
- `examples/gh` and `examples/pwsh-demo` are workspace packages. CI typechecks and tests `examples/gh` on its own
- CI base branch is `master`
- Docs deploy from root `wrangler.toml` (`docs:deploy`, assets in `docs/.vitepress/dist`, `html_handling = "auto-trailing-slash"`). `.github/workflows/docs.yml` also publishes GitHub Pages
- Cloudflare docs builds run VitePress and twoslash under a tight memory limit. A flaky OOM gets a retry before a code investigation
- `bun run gh-project:*` walks upward for `.opencode/state/dreamcli-re-foundation/prd.json` and defaults to GitHub Project `4`. This checkout has no `prd.json`
