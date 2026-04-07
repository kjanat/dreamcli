# examples — Runnable docs source + consumer canary

## OVERVIEW

Repo-root examples are the source of truth for docs example pages. `examples/gh/` is a real Bun
workspace package used as a walkthrough and CI canary.

## STRUCTURE

```text
*.ts     # single-file teaching examples parsed by docs
gh/      # workspace package: miniature GitHub CLI clone
.cache/  # generated build cache
```

## WHERE TO LOOK

| Task                            | Location                                                                                                               | Notes                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Edit a single-feature example   | `basic.ts`, `interactive.ts`, `json-mode.ts`, `middleware.ts`, `multi-command.ts`, `spinner-progress.ts`, `testing.ts` | keep focused, runnable, public-API only      |
| Edit docs example metadata      | `../docs/.vitepress/data/examples.ts`                                                                                  | parses example docblocks and related symbols |
| Edit the walkthrough package    | `gh/`                                                                                                                  | real package with commands, tests, and build |
| Trace example-backed docs pages | `../docs/examples/`, `../docs/reference/`                                                                              | generated from example source                |

## CONVENTIONS

- Top-level example docblocks are a contract: title line, optional prose, `Demonstrates:`, `Usage:`
- Examples should import public package exports only, never `#internals/*`
- Keep examples pedagogical and runnable; they double as docs content
- `examples/gh` is typechecked and tested separately in CI, so edits there carry real consumer
  signal

## ANTI-PATTERNS

- Do not edit generated docs pages when the source of truth is an example file
- Do not let examples drift into pseudo-internal usage that real consumers cannot copy
- Do not treat `.cache/` as source
- Do not bloat single-file examples with walkthrough-only complexity; move that to `examples/gh`

## NOTES

- `examples/gh/package.json` links `@kjanat/dreamcli` from the workspace and exposes a real `gh`
  bin
- Docs build derives related API symbol links from named imports in example source
