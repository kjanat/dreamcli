# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-07 **Commit:** 1479d26 **Branch:** master

## OVERVIEW

Schema-first, fully typed TypeScript CLI framework. Zero runtime deps. In-repo exports point at
`src/*.ts`; published Node defaults point at `dist/*.mjs`, while Bun and Deno keep source exports.

Read `@DISCOVERIES.md` before planning, editing, or running task workflows.

## STRUCTURE

```text
src/
├── index.ts                # public package surface
├── runtime.ts              # `./runtime` subpath barrel
├── testkit.ts              # `./testkit` subpath barrel
├── core/
│   ├── cli/                # top-level CLI orchestration, plugins, root surface
│   ├── schema/             # builder DSL, type inference, middleware surface
│   ├── resolve/            # argv/env/config/prompt/default precedence
│   ├── output/             # stdout/stderr/json/table/activity dispatch
│   ├── completion/         # shell completion generators
│   ├── json-schema/        # definition schema + input schema generation
│   ├── parse/              # tokenizer + schema-aware raw parse
│   ├── prompt/             # terminal/test prompt engines
│   ├── config/             # config discovery + package.json walk-up
│   ├── help/               # schema-driven help formatter
│   └── testkit/            # in-process test harness
└── runtime/                # Node/Bun/Deno adapters + detection

docs/
├── .vitepress/             # config, data loaders, theme, custom Vite plugins
├── concepts/               # hand-written docs
├── guide/                  # hand-written docs
├── examples/               # generated routes backed by `../examples/*.ts`
└── reference/              # overview pages + dynamic symbol routes

scripts/                    # build, release, and project automation
examples/                   # runnable examples + `examples/gh` workspace canary
specs/                      # planning/design docs
```

## WHERE TO LOOK

| Task                                          | Location                        | Notes                                      |
| --------------------------------------------- | ------------------------------- | ------------------------------------------ |
| Add command, flag, arg, or middleware API     | `src/core/schema/`              | most public API work starts here           |
| Fix argv parsing                              | `src/core/parse/`               | tokenizer + parser live in one file        |
| Fix resolution precedence                     | `src/core/resolve/`             | argv -> env -> config -> prompt -> default |
| Change help text formatting                   | `src/core/help/`                | width-aware text formatter                 |
| Change config discovery or `packageJson()`    | `src/core/config/`              | config loaders + package metadata walk-up  |
| Change prompt UX or test prompts              | `src/core/prompt/`              | prompt engines and sentinels               |
| Change JSON Schema output                     | `src/core/json-schema/`         | definition schema + input schema           |
| Change output, spinner, or progress           | `src/core/output/`              | stdout/stderr and activity handles         |
| Change shell completions                      | `src/core/completion/`          | per-shell generators                       |
| Change CLI dispatch or plugins                | `src/core/cli/`                 | root help, dispatch, runtime preflight     |
| Change runtime adapters                       | `src/runtime/`                  | Node, Bun, Deno, detect, support           |
| Change docs data, routes, or site build       | `docs/.vitepress/`              | docs app internals                         |
| Edit guide/concept prose                      | `docs/guide/`, `docs/concepts/` | hand-authored Markdown                     |
| Change build, release, or project automation  | `scripts/`                      | operational scripts                        |
| Change example-backed docs or consumer canary | `examples/`                     | docs source + `examples/gh` workspace      |

## CONVENTIONS

- Tabs, single quotes, semicolons, LF
- `import type` for type-only imports
- `.ts` extensions in all relative imports
- Strict TS everywhere; `exactOptionalPropertyTypes` means conditional spreads
- Explicit named re-exports only; no `export *`
- `@module` JSDoc at top of source files; `@internal` marks non-public API
- Public API stays factory-first: `cli()`, `command()`, `flag.*()`, `createOutput()`, `createAdapter()`
- Tests are co-located `*.test.ts`; use `describe()` + `it()`, em dash in suite titles,
  `// ===` and `// ---` section markers
- No lifecycle hooks, no snapshots, no module mocks
- Output assertions include trailing `\n`
- Core stays runtime-agnostic; host I/O goes through `RuntimeAdapter`, `WriteFn`, or `ReadFn`

## ANTI-PATTERNS (THIS PROJECT)

- Do not add runtime deps
- Do not use `process.*` or runtime-specific APIs in `src/core/`
- Do not import through barrels when it would create cycles; direct-file imports are intentional in
  `cli/`, `completion/`, `output/`, `prompt/`, `resolve/`, and `runtime/`
- Do not hand-edit `dreamcli.schema.json` or `src/core/json-schema/meta-descriptions.generated.ts`
- Do not edit `docs/.vitepress/dist/` or `docs/.vitepress/cache/`
- Do not treat `docs/.vitepress/data/` as docs-only; scripts import it for generated source and docs
  artifacts
- Do not replace `bun run gh-project:*` with ad hoc GitHub project mutations

## COMMANDS

```bash
bun run typecheck             # tsgo --noEmit
bun run typecheck:tsc         # tsc fallback
bun run lint                  # biome lint
bun run format:check          # dprint check
bun run test                  # vitest run
bun run meta-descriptions     # regenerate JSON Schema meta descriptions
bun run meta-descriptions:check
bun run docs:build            # VitePress build
bun run bd                    # tsdown + publint + attw + schema emit
bun run ci                    # typecheck + lint + format + meta + test + docs + build
bun run gh-project:list       # workflow/project helper
```

## NOTES

- Public subpath exports: `"."`, `"./runtime"`, `"./testkit"`, `"./schema"`
- Node inside this repo resolves bare package imports to `dist`; Bun and Deno resolve to `src`
- `tsdown.config.ts` emits `dreamcli.schema.json` before build and formats `package.json` on success
- Docs build copies root artifacts into site output via
  `docs/.vitepress/vite-plugins/source-artifacts.ts`
- `examples/gh` is a real workspace package, typechecked and tested separately in CI
- CI base branch is `master`, not `main`
- Docs deploy: Cloudflare Workers (static assets via wrangler) + GitHub Pages fallback
- Cloudflare build env has tight memory limits; VitePress+twoslash OOMs are flaky — retry before investigating
