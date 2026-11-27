# docs/.vitepress: site internals

`data/` builds the example and reference models. `theme/` is the client. `vite-plugins/` copies repo artifacts and shapes Shiki and twoslash output.

## WHERE TO LOOK

| Task                                              | Location                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Nav, sidebar, example sidebar                     | `config.ts`, `data/examples.ts`                                                            |
| API and symbol pages                              | `data/api-index.ts`, `data/deno-doc.ts`, `data/symbol-pages.ts`, `data/reference-model.ts` |
| Source links                                      | `data/paths.ts`. `DOCS_GIT_REF`, otherwise `git rev-parse HEAD`                            |
| Schema descriptions                               | `data/meta-schema-descriptions.ts`, consumed by `scripts/build-meta-descriptions.ts`       |
| Copy `dreamcli.schema.json` into the site         | `vite-plugins/source-artifacts.ts`                                                         |
| Search, highlight cache, Shiki, twoslash payloads | `vite-plugins/`                                                                            |
| Client toggles, Mermaid, mobile twoslash          | `theme/`                                                                                   |

## ANTI-PATTERNS

- Do not edit `dist/` or `cache/`
- Do not rewrite minified chunks with a string replace. `shiki-dedupe-popup-styles.ts` stays AST-aware, and `dreamcliDocsPlugin()` leaves the old dedupe transform off
- Do not hardcode a git ref for source links
- Do not move `data/` helpers into `src/`. Scripts already import them

## NOTES

- Deploy uploads `docs/.vitepress/dist`. `source-artifacts.ts` copies the root schema to `schemas/definition/v1.schema.json` and `dreamcli.schema.json`
- Root `wrangler.toml` is the Worker config. Assets directory is `docs/.vitepress/dist`. `html_handling` is `auto-trailing-slash`. `drop-trailing-slash` sent `/raw/` through a 307
- `bun run docs:deploy` is `wrangler deploy`. `bun run docs:upload` is `wrangler versions upload`, which publishes a preview version and leaves production traffic where it is
- `.github/workflows/docs.yml` uploads the same dist as a GitHub Pages artifact
- Mermaid loads in the browser from a CDN
