# docs — VitePress site + source-backed content

## OVERVIEW

Docs are half authored Markdown, half generated site/data pipeline. `docs/.vitepress/` owns config,
data loaders, theme code, custom Vite plugins, and docs tests.

## STRUCTURE

```text
concepts/      # hand-written fundamentals
guide/         # hand-written guides
examples/      # route loaders backed by `../examples/*.ts`
reference/     # overview pages + dynamic symbol routes
public/        # static assets
.vitepress/    # config, theme, data model, plugins, dist/cache
```

## WHERE TO LOOK

| Task                                | Location                                                        | Notes                                                  |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Edit prose                          | `concepts/`, `guide/`, `index.md`                               | source Markdown                                        |
| Edit example docs pages             | `../examples/*.ts`, `.vitepress/data/examples.ts`               | edit example source and docblock, not generated routes |
| Edit API/reference generation       | `.vitepress/data/api-index.ts`, `typedoc.ts`, `symbol-pages.ts` | drives `/reference/*`                                  |
| Edit docs build config              | `.vitepress/config.ts`                                          | nav, sidebar, twoslash, Vite wiring                    |
| Edit theme/client behavior          | `.vitepress/theme/`                                             | toggles, popovers, Mermaid                             |
| Copy root artifacts into docs build | `.vitepress/vite-plugins/source-artifacts.ts`                   | schema emit for docs dist                              |

## CONVENTIONS

- `docs/examples/[slug].paths.ts` and `docs/reference/symbols/*/[slug].paths.ts` are route shells,
  not hand-authored content stores
- Example docblocks are a contract: title line, optional prose, `Demonstrates:`, `Usage:`
- Docs tests live in `.vitepress/data/*.test.ts` and verify API inventory, docs claims, example
  parsing, and symbol page generation
- `.vitepress/data/paths.ts` centralizes repo paths and source-link git refs

## ANTI-PATTERNS

- Do not edit `.vitepress/dist/` or `.vitepress/cache/`
- Do not patch generated example/reference pages when the real source lives in repo-root
  `examples/` or `.vitepress/data/`
- Do not assume docs code is isolated from source generation; `scripts/build-meta-descriptions.ts`
  imports it

## NOTES

- Root `dreamcli.schema.json` is required for docs and gets copied into site output during build
- See `.vitepress/AGENTS.md` for plugin, theme, and data-pipeline gotchas
