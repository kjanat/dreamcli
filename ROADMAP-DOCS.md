# Documentation Roadmap

Living document of planned improvements for the dreamcli docs site.
Organized by feature area, with implementation options and trade-offs.

## Current State

| Area        | Pages                                                   | Status                      |
| ----------- | ------------------------------------------------------- | --------------------------- |
| Concepts    | 6 (anatomy, input, output, exit codes, errors, testing) | Complete                    |
| Guide       | 15 (getting-started through testing, schema-export)     | Complete                    |
| Reference   | 4 (overview, main, testkit, runtime)                    | Hand-written, minimal depth |
| Examples    | 8 files in `examples/`, no docs page                    | Undiscoverable              |
| Changelog   | `CHANGELOG.md` at repo root, not in docs                | Inaccessible from site      |
| Docs health | None                                                    | —                           |

### Known Gaps

- **API doc coverage**: ~68% of value exports from `dreamcli` are documented
  in reference pages. 11 undocumented: `ArgBuilder`, `CLIBuilder`,
  `CommandBuilder`, `FlagBuilder`, `SHELLS`, `createArgSchema`,
  `createSchema`, `createTerminalPrompter`, `generateBashCompletion`,
  `generateZshCompletion`, `resolvePromptConfig`.
- **No frontmatter**: Only `index.md` has frontmatter. Every other page
  lacks `title`/`description` for SEO and search.
- **No cross-links**: Guide pages don't link to matching `examples/*.ts`
  files. Only `walkthrough.md` references `gh-clone.ts`.
- **No "Edit this page"** links — VitePress supports `editLink` natively.
- **No `lastUpdated`** timestamps — one config line enables this.

---

## 1. Changelog

Surface `CHANGELOG.md` (Keep a Changelog format, ~560 lines, 10 versions)
inside the docs site and make version history searchable and linkable.

### Option A: Markdown Include (simplest)

Create `docs/changelog.md` containing:

```md
---
title: Changelog
---

<!--@include: ../CHANGELOG.md-->
```

VitePress renders the included markdown natively. Anchor links per version
heading (`#unreleased`, `#0-9-0`, etc.) work automatically. Full-text search
via VitePress local search covers all changelog content.

- **Effort**: 5 minutes
- **Pros**: Zero code, always in sync, searchable, shareable per-version URLs
- **Cons**: One long page, no filtering by category or version range

### Option B: Parsed + Structured Vue Component

Use `keep-a-changelog` (npm) in a VitePress data loader to parse
`CHANGELOG.md` into structured JSON. A custom `<ChangelogPage>` Vue
component renders version cards with category badges
(Added/Changed/Fixed/Breaking), collapsible sections, and filter toggles.

```
docs/changelog.data.ts     → parses CHANGELOG.md at build time
docs/changelog.md           → imports data, renders <ChangelogPage>
.vitepress/theme/components/ChangelogPage.vue
```

- **Effort**: 1-2 days
- **Pros**: Filterable by category, collapsible versions, "show breaking
  only" toggle, polished UX unique among OSS docs
- **Cons**: Custom Vue component to maintain, `keep-a-changelog` dependency,
  rendered HTML ships in client bundle

### Option C: Per-Version Dynamic Routes

Use `[version].paths.ts` to generate a separate page per release. Parse
`CHANGELOG.md` into sections, emit each as a route parameter.

```
docs/changelog/[version].paths.ts   → emits { params: { version } } per release
docs/changelog/[version].md         → renders single version content
docs/changelog/index.md             → version index with links
```

- **Effort**: 1 day
- **Pros**: SEO-friendly per-version URLs, lightweight pages, no client
  bundle bloat
- **Cons**: Requires a changelog parser, more files to maintain, separate
  index page needed

### Companion: "What's New" on Landing Page

Regardless of which option above, parse the latest release from
`CHANGELOG.md` and render 3-5 highlights on `docs/index.md`. Keeps the
landing page fresh without a second source of truth.

### Companion: RSS Feed

Generate `changelog.xml` at build time from parsed versions. Use
`vitepress-plugin-rss` or a custom `buildEnd` hook. Low effort with an
existing plugin.

### Add to Navigation

Add "Changelog" to the top nav — either as a standalone item or inside the
"Links" dropdown:

```ts
{ text: 'Changelog', link: '/changelog' }
```

---

## 2. Examples Showcase

Surface the 8 example files as a browsable, categorized page in the docs.

### Current Examples

| File                  | Complexity   | Features                                          |
| --------------------- | ------------ | ------------------------------------------------- |
| `basic.ts`            | Beginner     | args, flags, defaults, aliases                    |
| `multi-command.ts`    | Beginner     | commands, groups, version, env binding            |
| `json-mode.ts`        | Intermediate | `--json`, `out.json()`, `out.table()`, `CLIError` |
| `interactive.ts`      | Intermediate | prompts, env, config, resolution chain            |
| `spinner-progress.ts` | Intermediate | spinners, progress bars, TTY detection            |
| `middleware.ts`       | Intermediate | middleware, typed context, onion model            |
| `testing.ts`          | Intermediate | testkit, `runCommand`, prompt mocking             |
| `gh-clone.ts`         | Advanced     | all features combined (has walkthrough)           |

### Option A: Hand-Written Categorized List (simplest)

Create `docs/examples.md` with a grouped list. Extract descriptions from
existing JSDoc module blocks.

```md
## Getting Started

- **[basic.ts]** — Positional args, typed flags, default values, aliases
- **[multi-command.ts]** — Nested command groups, version, env binding

## Features

- **[json-mode.ts]** — --json flag, structured output, table rendering
  ...
```

- **Effort**: 30 minutes
- **Pros**: Clear, curated, zero build complexity
- **Cons**: Must update manually when examples change (negligible at 8 files)

### Option B: Data Loader from `examples/*.ts`

A `.data.ts` file reads each example, extracts the JSDoc module comment via
the TypeScript compiler API, and returns structured metadata. A Vue component
renders the gallery.

```
docs/examples.data.ts   → glob examples/*.ts, extract JSDoc
docs/examples.md        → imports data, renders example cards
```

Extraction targets from existing JSDoc:

- First line → title
- `Demonstrates:` list → feature tags
- `Usage:` block → runnable commands

- **Effort**: Half day
- **Pros**: Auto-updates when examples are added/modified, feature tags
  enable filtering, consistent with "schema-first" philosophy
- **Cons**: TS compiler API adds build-time weight, fragile if JSDoc format
  drifts, overkill for 8 files

### Option C: Markdown Sidecar Files

Create a `.md` file per example with frontmatter metadata:

```
docs/examples/basic.md          → frontmatter: title, tags, complexity
docs/examples/index.md          → uses createContentLoader to render gallery
docs/examples/basic.data.ts     → reads ../../examples/basic.ts for source
```

Use `createContentLoader('examples/*.md')` for the index.

- **Effort**: 1 day (8 markdown files + index + data loader)
- **Pros**: Full control per example, can add narrative alongside code,
  VitePress-native pattern
- **Cons**: 8 sidecar files to maintain in sync with actual example files

### High-Impact Companion: Cross-Links in Guide Pages

Regardless of which option above, add a callout at the bottom of each guide
page linking to matching examples:

```md
::: tip Full example
See [`examples/middleware.ts`](https://github.com/kjanat/dreamcli/blob/master/examples/middleware.ts)
for a complete runnable example.
:::
```

Mapping:

- `guide/commands.md` → `basic.ts`, `multi-command.ts`
- `guide/flags.md` → `basic.ts`
- `guide/arguments.md` → `basic.ts`
- `guide/output.md` → `json-mode.ts`, `spinner-progress.ts`
- `guide/errors.md` → `json-mode.ts`
- `guide/middleware.md` → `middleware.ts`
- `guide/prompts.md` → `interactive.ts`
- `guide/testing.md` → `testing.ts`
- `guide/walkthrough.md` → `gh-clone.ts` (already linked)
- `guide/completions.md` → (no example yet)
- `guide/config.md` → `interactive.ts`
- `guide/runtime.md` → (no example yet)

This is the single highest-leverage change for example discoverability.

### Companion: Code + Output Pairs

For key examples, show terminal output alongside source using VitePress code
groups:

````md
::: code-group

```ts [basic.ts]
// source
```

```bash [Output]
$ greet Alice --loud --times 3
HELLO, ALICE!
```

:::
````

### Add to Navigation

Add "Examples" to top nav, alongside or inside Guide:

```ts
{ text: 'Examples', link: '/examples' }
```

---

## 3. API Reference

Upgrade the hand-written reference pages (currently tables of signatures
with minimal depth) to comprehensive, auto-generated API docs.

### Codebase Readiness

The source is well-suited for auto-generation:

- **75-80% JSDoc coverage** across exported symbols
- **42 `@example` blocks** in builder classes alone
- All builders have per-method `@param` documentation
- `@internal` tags correctly mark implementation details
- `@module` tags on all major files
- Gap: `@returns` tags are sparse (return types are inferred from generics)

### Option A: typedoc Pre-Build Pipeline (recommended)

Run TypeDoc before VitePress via an npm script. TypeDoc generates `.md`
files into `docs/reference/api/` and a sidebar JSON for navigation.

```json
{
	"predocs": "typedoc",
	"docs:dev": "npm run predocs && vitepress dev docs",
	"docs:build": "npm run predocs && vitepress build docs"
}
```

Uses `typedoc-plugin-markdown` + `typedoc-vitepress-theme` for VitePress-
compatible output. TypeDoc handles:

- Generic constraints and phantom types (`CommandBuilder<F, A, C, O>`)
- Overloaded signatures
- Re-exports and barrel file resolution
- `@internal` filtering
- Cross-references between symbols
- `@example` block rendering

```
typedoc.json                          → typedoc config
docs/reference/api/                   → generated .md files (gitignored)
docs/reference/api/typedoc-sidebar.json → auto-generated nav
```

- **Effort**: Half day setup, then automatic
- **Pros**: Mature tooling, handles complex TS generics, per-symbol pages
  with cross-references, build-time only (no client bundle impact)
- **Cons**: Separate build step (not VitePress HMR), generated markdown can
  be verbose, typedoc config surface area is large, adds `typedoc` +
  2 plugins as dev dependencies

### Option B: Custom Data Loader with ts-morph

A `.data.ts` file uses ts-morph to parse source files, extract exports,
JSDoc, parameters, return types, and generic constraints. Returns structured
JSON consumed by Vue components.

```
docs/reference/api.data.ts   → ts-morph extraction
docs/reference/main.md       → renders API tables from loaded data
.vitepress/theme/components/ApiEntry.vue
```

- **Effort**: 2-3 days (edge cases with generics, overloads, re-exports)
- **Pros**: Full control over output shape, VitePress HMR via `watch`,
  no external tooling beyond ts-morph
- **Cons**: ts-morph is ~15MB, must handle edge cases manually (phantom
  generics, conditional types, overloads), significant custom code to
  maintain

### Option C: Custom Data Loader with Raw TypeScript Compiler API

Same as Option B but uses `typescript` directly (already a dev dependency)
instead of ts-morph. Lighter but lower-level.

- **Effort**: 3-5 days
- **Pros**: No new dependency (typescript already installed), full control
- **Cons**: TS compiler API is verbose and poorly documented, even more
  edge-case work than ts-morph

### Option D: Keep Hand-Written, Improve Incrementally

Keep the current reference pages but enrich them with:

- Embedded `@example` blocks copied from JSDoc
- Parameter tables with types and defaults
- Cross-references to guide pages and examples
- Cover the 16 undocumented exports

- **Effort**: 1-2 days for full coverage
- **Pros**: Full editorial control, no build complexity, human-curated
  explanations alongside signatures
- **Cons**: Drifts from source over time, manual maintenance burden grows
  with API surface

### Companion: Auto-Linking Plugin

A markdown-it plugin that transforms backticked symbol references (e.g.,
`` `cli()` ``, `` `CLIError` ``) into links to the corresponding reference
page anchor. Build a symbol-to-anchor map at build time from barrel exports.

```ts
// .vitepress/plugins/autolink.ts
// Scans src/index.ts exports → builds map → markdown-it plugin
// `cli()` in any .md → <a href="/reference/main#cli">cli()</a>
```

- **Effort**: Half day
- **Pros**: Every guide page becomes deeply hyperlinked to the API reference
  without manual `[cli()](/reference/main#cli)` markup. Transforms reading
  experience.
- **Cons**: Must maintain symbol → anchor mapping (can be auto-generated)

### Companion: Error Code Reference

Auto-generate a reference page from the `ErrorCode`, `ParseErrorCode`, and
`ValidationErrorCode` union types. These are string literal unions in source
— extractable via regex or TS compiler.

```
docs/reference/errors.md     → error code table with categories
docs/reference/errors.data.ts → extracts union members from source
```

- **Effort**: Half day
- **Pros**: Error code references are rare in library docs and very useful,
  always in sync with source
- **Cons**: Needs prose per error code (can start sparse and fill in)

---

## 4. Docs Health Dashboard

A build-time meta-page showing documentation coverage, freshness, and
completeness. Novel — no OSS project ships this publicly.

### What to Track

| Metric                    | Source                                           | Value               |
| ------------------------- | ------------------------------------------------ | ------------------- |
| Total pages               | `createContentLoader`                            | Currently 25        |
| Word count + reading time | Raw markdown, 200 wpm                            | ~10,500 words total |
| API coverage              | Barrel exports vs reference page mentions        | Currently ~54%      |
| Frontmatter completeness  | Check for `title` + `description`                | Currently 1/25      |
| Example coverage          | Guide pages vs matching `examples/*.ts`          | Partial             |
| Page freshness            | `git log -1` per file or VitePress `lastUpdated` | —                   |

### Option A: Single Data Loader Page

One `.data.ts` file computes all metrics at build time. A Vue component
renders tables and progress bars.

```
docs/meta.data.ts   → createContentLoader + export scanning
docs/meta.md        → renders health dashboard
```

The data loader:

1. Uses `createContentLoader('**/*.md', { includeSrc: true })` for page
   metadata + word counts
2. Reads `src/index.ts`, `src/testkit.ts`, `src/runtime.ts` and extracts
   export names via regex or TS compiler
3. Cross-references exports against reference page content
4. Returns structured stats as JSON

- **Effort**: Half day
- **Pros**: Transparent quality signal, motivates closing coverage gaps,
  unique among OSS docs, lightweight
- **Cons**: Stats ship to client bundle (small), must keep export scanning
  in sync with barrel structure

### Option B: Build-Only CI Report

Run the same analysis in a `buildEnd` hook or CI script. Output a badge SVG
and/or console report. No docs page.

```
.vitepress/build-hooks/docs-health.ts   → runs at build end
docs/public/badges/docs-coverage.svg    → generated badge
```

- **Effort**: Half day
- **Pros**: Zero client bundle impact, badge in README
- **Cons**: Not discoverable from docs site, less motivating

### Option C: Full Dashboard with Historical Tracking

Track metrics over time by emitting a JSON artifact per build. Render
sparkline charts showing docs growth, coverage trends, etc.

- **Effort**: 2-3 days
- **Pros**: Shows trajectory, compelling for contributors
- **Cons**: Needs artifact storage (git? CI?), over-engineering for current
  scale

### Recommended Metrics (by value)

1. **API coverage %** — most actionable, directly shows gaps
2. **Frontmatter completeness** — easy to fix, improves SEO
3. **Word count / reading time per page** — useful for readers and authors
4. **Example cross-link coverage** — which guides lack example links
5. **Page freshness** — flag stale pages (less useful at current scale)

---

## 5. Quick Wins (Independent of Above)

Low-effort improvements that can ship immediately regardless of which
options are chosen for the features above.

### Enable `lastUpdated`

```ts
// .vitepress/config.ts
export default defineConfig({
	lastUpdated: true,
	// ...
});
```

Shows "Last updated: <date>" on every page footer. One line.

### Enable `editLink`

```ts
themeConfig: {
  editLink: {
    pattern: 'https://github.com/kjanat/dreamcli/edit/master/docs/:path',
    text: 'Edit this page on GitHub',
  },
}
```

Adds "Edit this page" link to every page. Two lines.

### Enable `deadLinks: 'fail'`

```ts
export default defineConfig({
	deadLinks: 'fail', // or 'warn'
	// ...
});
```

Fails the build on broken internal links. One line. Embodies the
"type-safe docs" philosophy.

### Add Frontmatter to All Pages

Every `.md` page should have at minimum:

```yaml
---
title: Output and TTY
description: How CLIs handle stdout, stderr, colors, spinners, and TTY detection
---
```

This improves VitePress local search ranking, browser tab titles, and
social preview cards. Mechanical work across 24 pages.

---

## 6. Future Ideas

Higher-effort features for post-v1.0. Ranked by wow factor and feasibility.

### Runtime Compatibility Matrix

Emit a JSON artifact from CI with per-feature pass/fail per runtime
(Node/Bun/Deno). A data loader reads the JSON and renders a feature matrix
page with colored badges. Always current because it comes from CI.

- **Feasibility**: 8/10 — CI emits JSON, data loader reads it, Vue renders
- **Wow**: 8/10 — shows instantly which features work where

### StackBlitz Playground Integration

Each example gets a "Try it" button opening a pre-configured StackBlitz
project. Since dreamcli is zero-dep, boot time is fast. The killer version:
split-pane with editor + simulated terminal showing `--help` output.

- **Feasibility**: 6/10 — StackBlitz integration is documented, simulated
  terminal is custom
- **Wow**: 10/10 — "try without installing" is highest-conversion pattern

### Type Flow Diagrams

Use Mermaid (already integrated) to visualize how types flow from schema
definition through to the action handler. Proves the "types flow from
schema" pitch visually.

Start hand-curated, automate later with TS compiler API extracting generic
parameter chains.

- **Feasibility**: 5/10 for automation, 9/10 for hand-curated
- **Wow**: 9/10 — visual proof of the core value proposition

### Bundle Size Tracking

Record output sizes per entry point (`index.mjs`, `testkit.mjs`,
`runtime.mjs`) in CI. Render sparkline charts in docs. Since dreamcli's
selling point is "zero deps, lean core," proving it with data is powerful.

- **Feasibility**: 7/10
- **Wow**: 7/10 — "we track our own weight" is strong credibility

### Getting-Started Wizard

Interactive page: "Single or multi-command?" → "Need config files?" →
"Which runtimes?" → generates a starter project as downloadable zip or
StackBlitz link.

- **Feasibility**: 5/10 — significant frontend, but template combinations
  are finite
- **Wow**: 9/10 — the "create-next-app" experience for CLIs

### Semantic Search

Replace VitePress local search with vector-based search. Options: Algolia
DocSearch (free for OSS) or client-side Orama (hybrid keyword + vector).

- **Feasibility**: 5/10 for self-hosted, 8/10 for Algolia
- **Wow**: 8/10 — "search that understands intent"

### "Used In" Reverse Index

For each API symbol, scan all guide/concept pages for usage. Display badges
on API reference entries: "Used in: Getting Started, Middleware guide."
Creates bidirectional navigation.

- **Feasibility**: 7/10
- **Wow**: 7/10 — subtle but dramatically improves discoverability

### Comparison Page

Feature matrix: dreamcli vs Commander vs yargs vs oclif vs CAC. dreamcli
column auto-generated from test results and package metadata. Competitor
columns manually curated.

- **Feasibility**: 4/10 — auto-gen is easy, keeping competitor data
  accurate is ongoing labor
- **Wow**: 8/10 — developers choosing frameworks love these, but they must
  be honest to be credible

---

## Design Principles

Whatever gets built should follow these:

1. **Docs can't lie.** If the API changes, the docs either auto-update or
   break the build. No silent drift.
2. **Build-time, not runtime.** Data loaders execute in Node.js at build.
   Only serialized JSON ships to client. Keep payloads lean.
3. **Progressive enhancement.** Start simple (markdown include, hand-written
   list), add structure later (data loaders, Vue components) when scale
   demands it.
4. **Schema-first docs for a schema-first framework.** The docs should be
   validated against source — backticked symbols checked against exports,
   internal links checked at build, coverage tracked and visible.

---

## References

- [VitePress Data Loading](https://vitepress.dev/guide/data-loading)
- [VitePress Markdown File Inclusion](https://vitepress.dev/guide/markdown#markdown-file-inclusion)
- [typedoc-plugin-markdown + VitePress theme](https://typedoc-plugin-markdown.org/)
- [keep-a-changelog (npm)](https://github.com/oscarotero/keep-a-changelog)
- [ts-morph](https://github.com/dsherret/ts-morph)
- [Fern: Developer Docs Metrics](https://buildwithfern.com/post/developer-documentation-metrics)
