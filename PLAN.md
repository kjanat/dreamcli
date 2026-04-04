# PR #8 Review Comment Index

> **PR:** kjanat/dreamcli#8 — "wip: re-foundation"
> **State:** OPEN | **Branch:** `dreamcli-re-foundation` -> `master`
> **Author:** kjanat | **Changed files:** 376 | **Commits:** 57
> **Created:** 2026-04-02 | **Label:** enhancement
>
> **11 CodeRabbit review rounds** | **188 top-level inline comments** | **3 reply comments** | **139 unique files touched**

---

## Stats

| Severity     | Count |
| ------------ | ----- |
| Critical     | 12    |
| Major        | 72    |
| Minor        | 72    |
| Unclassified | 32    |

| Category   | Count |
| ---------- | ----- |
| Issue      | 148   |
| Nitpick    | 30    |
| Suggestion | 2     |
| Other      | 8     |

### Issue-level comments (non-review)

| Author                       | Type                |
| ---------------------------- | ------------------- |
| cloudflare-workers-and-pages | Deploy status       |
| coderabbitai                 | Walkthrough summary |
| pkg-pr-new                   | Preview package     |

### User responses (kjanat)

| Reply to                                 | Response                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| `finish.ts:19` runtime kraken (critical) | "ok, now in normal english, and in context of its usage pls" |
| `package.json:97` version bump (major)   | "stfu"                                                       |

---

## Review Rounds

| #  | Date       | Actionable |
| -- | ---------- | ---------- |
| 1  | 2026-04-02 | 24         |
| 2  | 2026-04-02 | 14         |
| 3  | 2026-04-02 | 4          |
| 4  | 2026-04-03 | 10         |
| 5  | 2026-04-03 | 75         |
| 6  | 2026-04-03 | 2          |
| 7  | 2026-04-03 | 9          |
| 8  | 2026-04-03 | 7          |
| 9  | 2026-04-03 | 24         |
| 10 | 2026-04-03 | 10         |
| 11 | 2026-04-04 | 10         |

**Total actionable comments across rounds: 189** (includes duplicates flagged across rounds)

---

## Critical Issues (12)

| File                                                    | Line | Title                                                               |
| ------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| `.github/workflows/publish-jsr.yml`                     | 46   | Removes the build the smoke test depends on                         |
| `docs/reference/symbols/main/CommandArgEntry.md`        | 19   | (doc generation issue)                                              |
| `docs/reference/symbols/main/InteractiveResult.md`      | 8    | (doc generation issue)                                              |
| `docs/reference/symbols/main/discoverPackageJson.md`    | 17   | (doc generation issue)                                              |
| `docs/reference/symbols/main/discoverPackageJson.md`    | 26   | Example inconsistent with type signature                            |
| `docs/reference/symbols/testkit/createCaptureOutput.md` | 23   | Broken table sinking docs                                           |
| `docs/reference/symbols/testkit/createTestPrompter.md`  | 25   | (doc generation issue)                                              |
| `examples/testing.ts`                                   | 14   | (broken example)                                                    |
| `package.json`                                          | 34   | `dreamcli.schema.json` doesn't exist                                |
| `scripts/docs/shared/meta-schema-descriptions.test.ts`  | 47   | Tests timing out in CI                                              |
| `scripts/docs/shared/symbol-pages.test.ts`              | 30   | Test timing out (Davy Jones' timeout locker)                        |
| `scripts/gh-project/commands/finish.ts`                 | 19   | Runtime crash: `--ready` flag has no default, iterating `undefined` |

---

## Major Issues by Area (72)

### Source code (`src/`)

| File                                    | Line | Title                                                                   |
| --------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `src/core/execution/index.ts`           | 77   | Raw `argv.includes('--help')` makes `--help` impossible as a positional |
| `src/core/json-schema/index.ts`         | 782  | `deprecated` meta-schema type mismatches emitted documents              |
| `src/core/resolve/index.ts`             | 102  | Cross-stage aggregate lies about what went wrong                        |
| `src/core/resolve/index.ts`             | 1273 | Only unwrap aggregates you minted yourself                              |
| `src/core/schema-dsl/parse.ts`          | 180  | (parse issue)                                                           |
| `src/core/schema-dsl/parse.ts`          | 241  | Keep helper types internal                                              |
| `src/core/schema-dsl/runtime.ts`        | 529  | Fail closed on unresolved `@ref`s                                       |
| `src/core/schema-dsl/runtime.ts`        | 541  | Plain object nodes should reject extra keys                             |
| `src/core/schema-dsl/to-json-schema.ts` | 57   | (JSON schema generation issue)                                          |
| `src/core/schema/command.ts`            | 625  | Key flag collisions by rendered CLI token, not raw name                 |
| `src/core/schema/command.ts`            | 704  | Split executable and schema-only erased commands                        |

### Scripts

| File                                        | Line | Title                                                       |
| ------------------------------------------- | ---- | ----------------------------------------------------------- |
| `scripts/docs/shared/api-index.ts`          | 75   | Fail fast on broken `package.json`                          |
| `scripts/docs/shared/api-index.ts`          | 198  | Stop hauling `@internal` cargo into public index            |
| `scripts/docs/shared/api-index.ts`          | 244  | (index generation issue)                                    |
| `scripts/docs/shared/api-index.test.ts`     | 91   | Add required test section separators                        |
| `scripts/docs/shared/api-index.test.ts`     | 10   | Use em-dash `describe` naming format                        |
| `scripts/docs/shared/examples.test.ts`      | 67   | Coverage gap: rendering regressions unguarded               |
| `scripts/docs/shared/examples.ts`           | 238  | Wrapped `Demonstrates:` text still chopped after first line |
| `scripts/docs/shared/reference-surfaces.ts` | 77   | Quit duplicating artifact paths by hand                     |
| `scripts/docs/shared/symbol-pages.ts`       | 476  | Use local type-parameter name                               |
| `scripts/docs/shared/typedoc.test.ts`       | 17   | Stop paying the TypeDoc tax twice                           |
| `scripts/docs/shared/typedoc.ts`            | 71   | Quit flattening every literal into a string                 |
| `scripts/gh-project/commands/start.ts`      | 33   | (start command issue)                                       |
| `scripts/gh-project/commands/sync.ts`       | 57   | Missing project items not "in sync"                         |
| `scripts/gh-project/lib/prd.ts`             | 87   | Fail fast on invalid PRD graphs                             |
| `scripts/gh-project/lib/project.ts`         | 284  | Refuse duplicate project items for same task ID             |
| `scripts/gh-project/lib/project.ts`         | 331  | Don't fire workflow edit when only `Status` drifted         |

### Package / build / CI

| File                     | Line | Title                                                |
| ------------------------ | ---- | ---------------------------------------------------- |
| `.attw.json`             | 3    | (config issue)                                       |
| `.markdownlint.json`     | 4    | (config issue)                                       |
| `.zed/settings.json`     | 17   | (editor config issue)                                |
| `deno.jsonc`             | 43   | (deno config issue)                                  |
| `package.json`           | 97   | Bump the package version                             |
| `note-to-self.ts`        | 4    | Missing `@module` JSDoc                              |
| `examples/middleware.ts` | 13   | Scoped import currently breaks example type-checking |
| `examples/tsconfig.json` | 14   | (tsconfig issue)                                     |

### Docs — generated reference pages

| File                                                             | Line     | Title                                                      |
| ---------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `docs/reference/support-matrix.md`                               | 92       | Support matrix contradictions                              |
| `docs/reference/support-matrix.md`                               | 106      | Status contradiction for API index/symbol pages            |
| `docs/examples/testing.md`                                       | 14       | (generated example issue)                                  |
| `docs/guide/completions.md`                                      | 53       | Validation lenient for unsupported shells                  |
| `docs/reference/symbols/main/ActionParams.md`                    | 29, 51   | (signature issues)                                         |
| `docs/reference/symbols/main/ArgSchema.md`                       | 44       | (type doc issue)                                           |
| `docs/reference/symbols/main/CLIBuilder.md`                      | 112      | Methods more mysterious than Davy Jones' locker            |
| `docs/reference/symbols/main/CLIRunOptions.md`                   | 160      | (doc issue)                                                |
| `docs/reference/symbols/main/CommandBuilder.md`                  | 63, 108  | Ghost ship references with no charts                       |
| `docs/reference/symbols/main/ConfigDiscoveryOptions.md`          | 15       | Empty signature but members say otherwise                  |
| `docs/reference/symbols/main/ConfigFound.md`                     | 42       | (doc issue)                                                |
| `docs/reference/symbols/main/FlagConfig.md`                      | 47       | Empty interface signature vs documented properties         |
| `docs/reference/symbols/main/FlagSchema.md`                      | 61       | Fix `deprecated` type signature                            |
| `docs/reference/symbols/main/HelpOptions.md`                     | 10       | Docs linking to stale references                           |
| `docs/reference/symbols/main/InputPromptConfig.md`               | 51       | Fix `validate` type signature in generated docs            |
| `docs/reference/symbols/main/ParseError.md`                      | 28, 59   | Constructor fabrication + contradictory exit-code defaults |
| `docs/reference/symbols/main/ParseResult.md`                     | 19       | Wrong signature contradicts documented members             |
| `docs/reference/symbols/main/ProgressOptions.md`                 | 16       | Contradictory API shape                                    |
| `docs/reference/symbols/main/PromptResult.md`                    | 23       | (doc issue)                                                |
| `docs/reference/symbols/main/ReadFn.md`                          | 23       | String literal `'null'` instead of actual NULL type        |
| `docs/reference/symbols/main/ResolveOptions.md`                  | 46       | (doc issue)                                                |
| `docs/reference/symbols/main/ResolvedMultiselectPromptConfig.md` | 28       | (doc issue)                                                |
| `docs/reference/symbols/main/ResolvedSelectPromptConfig.md`      | 28       | (doc issue)                                                |
| `docs/reference/symbols/main/TableColumn.md`                     | 36       | (doc issue)                                                |
| `docs/reference/symbols/main/ValidationError.md`                 | 28       | (doc issue)                                                |
| `docs/reference/symbols/main/WithPresence.md`                    | 16       | WithPresence type sig doesn't match implementation         |
| `docs/reference/symbols/main/WithVariadic.md`                    | 39       | Docgen shredding type literal                              |
| `docs/reference/symbols/runtime/ExitError.md`                    | 9        | Description too narrow                                     |
| `docs/reference/symbols/runtime/RuntimeAdapter.md`               | 112, 127 | String `"null"` bug + unknown issue                        |
| `docs/reference/symbols/runtime/createBunAdapter.md`             | 27       | Example import path conflicts with public entrypoint       |
| `docs/reference/symbols/runtime/createNodeAdapter.md`            | 27       | Non-public subpath in example                              |
| `docs/reference/symbols/testkit/RunOptions.md`                   | 179      | (doc issue)                                                |
| `docs/reference/symbols/testkit/RunResult.md`                    | 15       | Incomplete reference page                                  |

---

## Minor Issues (72)

### Source code

| File                              | Line | Summary                                                        |
| --------------------------------- | ---- | -------------------------------------------------------------- |
| `src/core/cli/planner.ts`         | 212  | Inconsistency in flag precedence                               |
| `src/core/output/contracts.ts`    | 115  | `stream` overrides lost when table format resolves from `auto` |
| `src/core/output/index.ts`        | 293  | Stop old activity handle before returning noop                 |
| `src/core/output/index.ts`        | 308  | Noop early-return issue unfixed                                |
| `src/core/parse/index.ts`         | 168  | Alias-aware error names leak back to canonical flag            |
| `src/core/parse/parse.test.ts`    | 691  | Negative tests can go green without `parse()` throwing         |
| `src/core/resolve/errors.ts`      | 94   | Use neutral aggregate hint                                     |
| `src/core/resolve/errors.ts`      | 189  | Empty nested error list swallows original failure              |
| `src/core/schema/command.test.ts` | 797  | "Canonical shadowing" smuggling alias collision                |
| `src/core/schema/command.ts`      | 667  | Update AGENTS.md with new schema rules                         |
| `src/core/schema/command.ts`      | 1212 | Use own-property check for canonical duplicates                |
| `src/core/schema/flag.ts`         | 200  | Missing defensive check in normalization                       |
| `tsdown.config.ts`                | 29   | (config issue)                                                 |

### Scripts

| File                                             | Line | Summary                                |
| ------------------------------------------------ | ---- | -------------------------------------- |
| `note-to-self.ts`                                | 36   | `link.exitCode` could be null          |
| `scripts/docs/build-docs-data.ts`                | 135  | Magic number "10" needs verification   |
| `scripts/docs/shared/examples.test.ts`           | 10   | Missing em-dash in `describe()`        |
| `scripts/docs/shared/examples.ts`                | 68   | Generated banner before the H1         |
| `scripts/docs/shared/examples.ts`                | 95   | Printing lead twice                    |
| `scripts/docs/shared/reference-surfaces.test.ts` | 70   | House-style the test file              |
| `scripts/docs/shared/reference-surfaces.ts`      | 102  | Make changelog heading strip CRLF-safe |
| `scripts/gh-project/lib/shared.ts`               | 32   | `parseJson` throwing raw errors        |
| `scripts/gh-project/lib/shared.ts`               | 257  | (shared lib issue)                     |

### Docs

| File                                   | Line    | Summary                                                                   |
| -------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `.dprint.jsonc`                        | 30      | (config issue)                                                            |
| `docs/.generated/examples/index.md`    | 15      | Truncated "Demonstrates" column                                           |
| `docs/.generated/site-data.ts`         | 21      | Example source links pinned to `master`                                   |
| `docs/.generated/site-data.ts`         | 68      | Truncated `demonstrates` strings                                          |
| `docs/.generated/site-data.ts`         | 1306    | `dreamcli/schema` export orphaned from symbol-page registry               |
| `docs/.vitepress/config.ts`            | 7       | Missing `@module` header                                                  |
| `docs/.vitepress/config.ts`            | 151     | (config issue)                                                            |
| `docs/examples/basic.md`               | 5, 17   | Redundant title + shebang/usage mismatch                                  |
| `docs/examples/index.md`               | 5       | MD041: first line should be top-level heading                             |
| `docs/examples/interactive.md`         | 8       | Hanging comma                                                             |
| `docs/examples/json-mode.md`           | 3       | Generated header triggers MD041                                           |
| `docs/examples/middleware.md`          | 9       | Duplicate intro + truncated "Demonstrates"                                |
| `docs/examples/multi-command.md`       | 8       | Truncated "Demonstrates" summary                                          |
| `docs/examples/spinner-progress.md`    | 9       | Truncated "Demonstrates" summary                                          |
| `docs/examples/testing.md`             | 9       | Truncated "Demonstrates" line                                             |
| `docs/guide/schema-export.md`          | 25      | Offline schema path stale after scoped rename                             |
| `docs/guide/troubleshooting.md`        | 175     | Readability polish in checklist wording                                   |
| `docs/public/manifest.json`            | 2       | Package name where display name belongs                                   |
| `docs/reference/generated-surfaces.md` | 1       | MD041 on first line                                                       |
| 30+ generated symbol pages             | various | Parameter table formatting, stale signatures, missing imports in examples |

---

## Nitpicks (30)

| File                                                   | Line         | Summary                                                     |
| ------------------------------------------------------ | ------------ | ----------------------------------------------------------- |
| `docs/.vitepress/config.ts`                            | 212          | (minor config nit)                                          |
| `docs/examples/interactive.md`                         | 5            | Parrot repeating itself (duplicate content)                 |
| `docs/public/schemas/cli/v1.json`                      | 70           | Required empty collections too strict                       |
| `docs/public/schemas/cli/v1.json`                      | 149          | Inconsistent enum order                                     |
| `docs/reference/output-contract.md`                    | 78           | Verify activity handles reference                           |
| `docs/reference/symbols/main/CLIError.md`              | 131          | Inherited static methods cluttering deck                    |
| `docs/reference/symbols/main/CLIRunOptions.md`         | 54           | Em dashes fancy for plain Markdown                          |
| `docs/reference/symbols/main/CommandBuilder.md`        | 185          | Example only shows calm seas                                |
| `docs/reference/symbols/main/FlagKind.md`              | 16           | Signature accurate but unhelpful                            |
| `docs/reference/symbols/main/JsonSchemaOptions.md`     | 19           | Empty interface signature                                   |
| `docs/reference/symbols/main/Token.md`                 | 23           | Property ordering inconsistent across variants              |
| `docs/reference/symbols/main/isValidationError.md`     | 5            | Lazy description                                            |
| `docs/reference/symbols/main/resolve.md`               | 27           | Parameter type column carrying parameter names              |
| `docs/reference/symbols/testkit/TestAnswer.md`         | 15           | Generator forgot backticks                                  |
| `note-to-self.ts`                                      | 35           | Frustration with Bun workspaces                             |
| `scripts/docs/build-docs-data.ts`                      | 76, 134, 193 | Magic numbers + duplicated exclusion logic                  |
| `scripts/docs/shared/meta-schema-descriptions.test.ts` | 15           | Missing em-dash in describe                                 |
| `scripts/docs/shared/paths.ts`                         | 13           | Confusing variable names                                    |
| `scripts/emit-definition-schema.ts`                    | 7            | Missing `@module` JSDoc tag                                 |
| `scripts/gh-project/lib/shared.ts`                     | 290          | `isRecord` missing from exports                             |
| `scripts/gh-project/lib/types.ts`                      | 124          | Inconsistency in cargo hold                                 |
| `src/core/cli/index.ts`                                | 791          | Fallback to `_execute` when `_command` undefined            |
| `src/core/cli/planner.ts`                              | 345          | Re-exporting `OutputPolicy` suspicious                      |
| `src/core/execution/index.ts`                          | 64           | Redundant NO_ACTION check                                   |
| `src/core/output/renderers.ts`                         | 44           | Stream resolver could use exhaustive checking               |
| `src/core/resolve/coerce.ts`                           | 314          | Semantic mapping of stdin -> prompt source deserves comment |
| `src/core/resolve/contracts.test.ts`                   | 65           | Pins claim, not deprecation behavior                        |
| `src/core/resolve/flags.ts`                            | 108          | Interactive config truthiness logic gnarly                  |

---

## Suggestions (2)

| File                        | Line | Summary                               |
| --------------------------- | ---- | ------------------------------------- |
| `src/core/resolve/args.ts`  | 139  | Join logic duplicated from `flags.ts` |
| `src/core/resolve/flags.ts` | 199  | Join logic could be cleaner           |

---

## Most-Commented Files (top 10)

| # Comments | File                                            | Critical | Major | Minor |
| ---------- | ----------------------------------------------- | -------- | ----- | ----- |
| 4          | `docs/reference/symbols/main/CommandBuilder.md` | 0        | 2     | 1     |
| 4          | `scripts/docs/build-docs-data.ts`               | 0        | 0     | 1     |
| 4          | `src/core/schema/command.ts`                    | 0        | 2     | 2     |
| 3          | `docs/.generated/site-data.ts`                  | 0        | 0     | 3     |
| 3          | `docs/.vitepress/config.ts`                     | 0        | 0     | 2     |
| 3          | `docs/reference/symbols/main/CLIBuilder.md`     | 0        | 1     | 2     |
| 3          | `note-to-self.ts`                               | 0        | 1     | 1     |
| 3          | `scripts/docs/shared/api-index.ts`              | 0        | 3     | 0     |
| 3          | `scripts/docs/shared/examples.ts`               | 0        | 1     | 2     |
| 3          | `scripts/gh-project/lib/shared.ts`              | 0        | 0     | 2     |

---

## Thematic Clusters

### 1. Doc Generation Pipeline (systemic — ~60% of all comments)

The bulk of major/minor issues trace to the TypeDoc -> Markdown doc generation pipeline in
`scripts/docs/`. Recurring patterns:

- **Empty/wrong type signatures** in generated symbol pages (interfaces show `{}` when members exist)
- **String `"null"` instead of actual null type** in parameter tables
- **Truncated `Demonstrates:` text** in example pages (first-line chopping)
- **Malformed Markdown tables** (parameter names leaking into Type column)
- **Missing imports** in code examples
- **`@internal` symbols leaking** into public API index
- **MD041 violations** from generated banners before H1

**Root cause:** The TypeDoc reflection -> Markdown renderer in `scripts/docs/shared/` has several
string-processing bugs. Fixing the generators once would resolve ~100 comments across all generated
pages.

### 2. Source Code Logic Issues (~15%)

Real bugs in the framework core:

- `--help` detection via raw `argv.includes()` (blocks positional usage)
- Flag collision keying by raw name instead of CLI token
- Cross-stage resolve aggregate error misreporting
- Schema DSL: unresolved `@ref`s silently pass, extra object keys accepted
- Activity handle lifecycle (noop early-return, old handle not stopped)
- Parse error names leaking through aliases

### 3. Script/Tooling Issues (~10%)

- `gh-project` helper: `--ready` flag crashes on `undefined`, sync logic gaps
- Test files: missing em-dash convention, section separators, CI timeouts
- Build: version not bumped, `dreamcli.schema.json` referenced but missing

### 4. Config/Build (~5%)

- `.attw.json`, `.markdownlint.json`, `deno.jsonc` config issues
- `tsdown.config.ts` issue
- JSR publish workflow removes build step smoke test depends on

### 5. Nitpicks/Style (~10%)

- Missing `@module` JSDoc tags
- Inconsistent enum ordering in JSON schema
- Re-exporting `OutputPolicy` from planner
- Magic numbers in build scripts

---

## Unresolved Questions

- How many of the 188 comments are duplicates across review rounds? (CodeRabbit itself flagged some as "duplicate comments" in later rounds — exact dedup count unknown)
- Which comments have already been addressed by commits after the review round they appeared in?
- Priority: fix doc generators (systemic) vs individual source bugs vs scripts?
