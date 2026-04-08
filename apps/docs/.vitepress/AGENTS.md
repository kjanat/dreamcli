# docs/.vitepress — Docs app internals

## OVERVIEW

This is a small app/toolchain, not just config. `data/` builds example/reference models, `theme/`
owns client behavior, and `vite-plugins/` wires repo artifacts into the site build.

## STRUCTURE

```text
config.ts      # site config + sidebar/nav generation
data/          # API inventory, TypeDoc normalization, example parsing, docs contract tests
theme/         # custom client theme, toggles, popovers, Mermaid boot
twoslash/      # twoslash fixtures/helpers
vite-plugins/  # source artifact copy + Shiki CSS transforms
dist/          # generated output
cache/         # generated cache
```

## WHERE TO LOOK

| Task                               | Location                                                                          | Notes                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| Sidebar, nav, examples sidebar     | `config.ts`, `data/examples.ts`                                                   | `config.ts` calls `collectExampleMeta()`           |
| API/reference pages                | `data/api-index.ts`, `typedoc.ts`, `symbol-pages.ts`                              | package exports -> TypeDoc -> symbol routes        |
| Shared repo paths and source links | `data/paths.ts`                                                                   | `DOCS_GIT_REF` override, else `git rev-parse HEAD` |
| Schema/meta description pipeline   | `data/meta-schema-descriptions.ts`, `../../../scripts/build-meta-descriptions.ts` | docs data feeds source generation                  |
| Artifact copying                   | `vite-plugins/source-artifacts.ts`                                                | moves root schema into docs dist                   |
| Theme interactivity                | `theme/`                                                                          | client-only toggles, mobile twoslash UX, Mermaid   |

## CONVENTIONS

- `data/` code is test-heavy and imported by scripts; keep it deterministic and Node-friendly
- `config.ts` reads package and tsconfig, then builds the examples sidebar from repo-root example
  docblocks
- Theme code has SSR/client split handling; browser-only logic belongs behind client guards
- `dreamcliDocsPlugin()` intentionally keeps the old twoslash style-dedupe plugin disabled

## ANTI-PATTERNS

- Do not re-enable raw chunk rewrites for Shiki or twoslash without an AST-safe approach
- Do not hardcode source-link refs when `DOCS_GIT_REF` or git state should supply them
- Do not treat `dist/` or `cache/` as source
- Do not move docs data helpers into source modules casually; scripts already depend on them

## NOTES

- `source-artifacts.ts` exists because docs deploy uploads `docs/.vitepress/dist`, not repo-root
  artifacts
- Mermaid loads client-side from CDN; keep that assumption in mind when editing theme code
- Docs deployed via `wrangler deploy` (static assets Worker) with `html_handling: drop-trailing-slash`
  to match VitePress `cleanUrls: true`; also deployed to GitHub Pages as fallback
- `wrangler.jsonc` `vars` are Worker runtime vars, not build env vars — don't put build flags there
