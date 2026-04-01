# SICK Docs Roadmap

This document captures the current recommendation for making dreamcli's docs feel unusually alive without making them noisy, clever for its own sake, or hard to maintain.

The short version:

- Keep `concepts/` and `guide/` human-written.
- Generate structured docs from real source-of-truth inputs.
- Make examples first-class.
- Add IDE-like hover where it genuinely helps.
- Build a real API reference eventually, but do it on a boring foundation.

## Why This Exists

The docs already have strong bones:

- VitePress setup is clean and simple.
- The package has three explicit public entrypoints: `dreamcli`, `dreamcli/testkit`, and `dreamcli/runtime`.
- `examples/*.ts` already exist and already carry useful module-level JSDoc.
- `CHANGELOG.md` already exists and is being maintained.
- Source JSDoc coverage is strong enough that generated reference pages would be a real upgrade, not a gimmick.

The goal is not to turn the docs into a toy IDE. The goal is to make the docs feel like they are wired directly into the actual library, so they stay current and reward curiosity.

## Core Product Idea

dreamcli is a schema-first, typed framework. The docs should reflect that philosophy.

That means:

- prose stays authored by humans;
- structured reference derives from code;
- examples derive from actual runnable example files;
- changelog derives from the canonical changelog file;
- docs health derives from the docs themselves;
- hover metadata derives from the type system, not hand-maintained tooltip text.

This is both the best DX story and the cleanest ideological fit for the project.

## Non-Negotiable UX Principles

These are the principles that should govern every implementation choice.

### 1. Useful before impressive

If a feature is flashy but not clearly helpful, cut it.

### 2. Calm docs win

The docs should feel rich, not busy. Interactivity should appear where the user wants to inspect something, not everywhere by default.

### 3. Source of truth must be singular

No parallel metadata systems if the code, examples, or changelog already encode the information.

### 4. Generated docs must still read well as docs

Generated pages cannot feel machine-dumped. They should be structured, searchable, and pleasant to skim.

### 5. Build-time intelligence, tiny runtime

The more we can precompute, the simpler and more reliable the site stays.

### 6. Human docs remain human

Concepts and guides should not be swallowed by generators. They are narrative documents, not extracted data.

## What We Evaluated

Several ideas came up:

1. live API reference from source;
2. example showcase generated from `examples/*.ts`;
3. animation catalog from SVG assets;
4. docs health dashboard;
5. changelog generated from git tags;
6. expose the actual `CHANGELOG.md` in docs;
7. IDE-like hover information similar to svelte.dev.

The current recommendation is a selective hybrid:

- yes: generated examples;
- yes: public docs health page;
- yes: canonical changelog page sourced from `CHANGELOG.md`;
- yes: live API index and eventual full signature pages;
- yes: IDE-like hover, but only where it helps;
- not yet: animation catalog;
- no: replace the handwritten changelog with git-tag archaeology.

## Final Strategic Calls

These decisions are now the default plan unless later evidence says otherwise.

### Content and IA

- Docs health can be public.
- Examples should have per-example detail pages, not only a gallery.
- Full API signature pages are desired eventually.
- The UX should stay simple and unobtrusive.

### Technical foundation

- Use `TypeDoc` JSON as the eventual source for full signature pages.
- Add a thin normalization layer between raw TypeDoc output and VitePress rendering.
- Use default `Twoslash` hover UI first.
- Scope hover to examples only at first.
- Keep `CHANGELOG.md` as the canonical release history.
- Do not try to generate the real changelog from git tags.

### Why these are the right boring choices

- TypeDoc already solves many ugly API-doc problems: overloads, generics, symbol modeling, doc comments, source links, and re-export handling.
- Twoslash already gives IDE-like type hover with very little custom runtime.
- Examples are the highest-value place for hover because the user is actively reading real code.
- Global hover in prose-heavy guides would add visual tax before proving value.

## What Research Found

### Repo fit is strong

Research into the current repo found:

- the docs site is a clean VitePress setup with little dynamic complexity;
- the API docs are currently accurate but intentionally thin;
- example files already form a coherent content source;
- source JSDoc is strong enough to support generated reference;
- the changelog is already unusually thorough and should be treated as a product asset.

This is exactly the sort of codebase where generated docs can feel magical without becoming a maintenance disaster.

### Conventional vs novel

What is conventional and expected:

- a changelog page;
- an examples section;
- real API reference pages.

What is more distinctive:

- a public docs health page;
- IDE-like hover in docs examples;
- tight cross-linking between examples, guides, and API pages.

The recommendation is to combine the conventional backbone with a few carefully scoped distinctive touches.

### Why the git-tag changelog idea lost

Generating a changelog from tags and `git log` sounds neat, but it is worse for this repo than the existing file.

Reasons:

- `CHANGELOG.md` is already curated and human-readable.
- The current changelog contains narrative structure and grouping that raw history does not.
- The docs should expose that file, not compete with it.
- A lightweight "recent releases" data view can still be derived from `CHANGELOG.md` later if useful.

## svelte.dev Hover Research

The requested comparison point was the kind of symbol hover used on svelte.dev.

### What they are actually doing

The effect is not a live in-browser IDE.

It is mostly:

- build-time code analysis via `Shiki` + `Twoslash` + `TypeScript`;
- generated HTML spans containing hover metadata;
- a very small runtime tooltip layer that reads the embedded hover payload and renders it.

There is also a separate mapping from symbols to canonical docs pages so the hover UI can link into the reference site.

### Important implication

This is good news.

dreamcli does not need to ship a browser language service or invent a mini editor stack to get the same class of user benefit. The right path is the same broad pattern:

- compute rich type info at build time;
- render hoverable code blocks;
- later enrich those hover cards with links into dreamcli's own generated reference pages.

### What is portable to dreamcli

Very portable:

- Twoslash-based hover for TypeScript code blocks;
- a symbol-to-docs URL map;
- lightweight tooltip presentation;
- build-time ambient type setup where needed.

Not worth copying early:

- any tutorial editor machinery;
- any REPL-specific infrastructure;
- any custom tooltip chrome before the default UX proves insufficient.

### What this means for dreamcli specifically

dreamcli already has path aliases in `tsconfig.json` for:

- `dreamcli` -> `./src/index.ts`
- `dreamcli/runtime` -> `./src/runtime.ts`
- `dreamcli/testkit` -> `./src/testkit.ts`

That makes Twoslash on example pages unusually viable because example imports already point at the local source of truth.

## Target Information Architecture

The docs should remain simple to navigate.

### Top nav

Recommended top-level nav:

- `Concepts`
- `Guide`
- `Examples`
- `Reference`
- `Links`

Why add `Examples` as a top-level item:

- examples are becoming a primary learning surface, not just a side note;
- per-example detail pages deserve direct discoverability;
- this is the most obvious home for hover-enabled code walkthroughs.

### Sidebar structure

#### Concepts

Keep as-is. Pure narrative material.

#### Guide

Keep as-is, with selective cross-links to examples where relevant.

#### Examples

Recommended structure:

- Overview
- Basic CLI
- Multi-command CLI
- JSON mode
- Middleware
- Interactive prompts
- Runtime support
- Testing
- Spinner and progress
- GH clone

If more examples are added later, this section should grow automatically.

#### Reference

Recommended structure:

- Overview
- `dreamcli`
- `dreamcli/testkit`
- `dreamcli/runtime`
- API Index
- Symbols
- Changelog
- Docs Health

The existing `main`, `testkit`, and `runtime` pages should evolve into curated landing pages for each subpath, not disappear.

## Recommended Architecture

The simplest durable architecture is a split between:

- an extraction layer under `scripts/docs/`; and
- a presentation layer under `docs/`.

### Extraction layer responsibilities

This layer knows how to read source files and generate stable structured artifacts.

Recommended location:

```txt
scripts/docs/
  build-docs-data.ts
  extract-examples.ts
  extract-changelog.ts
  extract-health.ts
  extract-api.ts
  normalize-typedoc.ts
  shared/
```

### Presentation layer responsibilities

This layer knows how to render pages from those artifacts.

Recommended locations:

```txt
docs/
  .generated/
  examples/
  reference/
  .vitepress/
```

### Why this split matters

It prevents tight coupling between:

- TypeScript/compiler concerns;
- TypeDoc concerns;
- VitePress rendering concerns;
- future search/index/hover concerns.

That separation is what keeps the system future-proof instead of slowly turning into one giant undocumented script.

## Build Pipeline Recommendation

Add a docs preparation step that runs before dev and build.

### Recommended scripts

Add something conceptually like:

```json
{
	"docs:prepare": "bun run scripts/docs/build-docs-data.ts",
	"docs:dev": "bun run docs:prepare && vitepress dev docs",
	"docs:build": "bun run docs:prepare && vitepress build docs"
}
```

### What `docs:prepare` should do

1. clean and recreate `docs/.generated/`;
2. extract example metadata;
3. generate per-example markdown pages or data files;
4. expose `CHANGELOG.md` to the docs site;
5. compute docs-health metrics;
6. generate or refresh API manifests;
7. optionally generate TypeDoc JSON once that layer exists.

### Git hygiene

Generated docs artifacts should be treated as build outputs, not hand-edited content.

Recommended:

- keep generated files under `docs/.generated/`;
- gitignore generated artifacts if they are reproducible;
- keep handwritten docs outside `.generated/`.

## Examples: The Highest-ROI Feature

This is the best first big investment.

### Why examples should come first

- They already exist.
- They already describe themselves.
- They are inherently useful to both new and advanced users.
- They are the ideal place to introduce IDE-like hover.
- They create a bridge between guide prose and raw API reference.

### Source of truth

Use `examples/*.ts` as the only content source.

At minimum, extract:

- filename;
- slug;
- title;
- module-level JSDoc summary;
- "Demonstrates" section if present;
- usage lines;
- imported dreamcli symbols;
- raw source text.

### Rendering strategy

For simplicity, favor generated markdown pages over trying to make VitePress route generation too clever.

Recommended output conceptually:

```txt
docs/.generated/examples/index.md
docs/.generated/examples/basic.md
docs/.generated/examples/multi-command.md
docs/.generated/examples/testing.md
...
```

These pages can be generated during `docs:prepare` and can include real fenced TypeScript blocks with Twoslash enabled.

That gives us:

- standard VitePress pages;
- standard search behavior;
- easy linking;
- easy sidebar integration;
- built-in Twoslash support on the rendered code.

### Example page template

Each example detail page should include:

1. title and summary;
2. short explanation of what it demonstrates;
3. run commands / usage hints;
4. the full source with hover-enabled code fence;
5. related guide pages;
6. related API symbols;
7. source file path.

### UX requirements for examples

- Pages should be readable even if the user never hovers anything.
- Hover should feel like a bonus, not a prerequisite.
- Related links should be obvious but not dominant.
- The page should answer both "what does this example do?" and "how does this symbol work?"

## Hover: IDE-Like, But Calm

This is the most important UX constraint.

The user explicitly wants the docs to feel useful and simple, not obtrusive.

### Initial recommendation

Start with:

- default Twoslash hover UI;
- hover on example pages only;
- minimal styling changes;
- no custom hover runtime yet unless necessary.

### Why examples-only first

Examples are where hover earns its keep.

In contrast, guides often include:

- partial snippets;
- illustrative fragments;
- shell examples;
- pseudo-code;
- snippets where hover would not add enough value.

If hover appears everywhere, the experience risks feeling over-instrumented.

### Later enrichment path

Once API pages exist, enrich hover cards with:

- canonical symbol label;
- short signature;
- summary line;
- direct link to the generated symbol page.

Only after living with the default experience should the project consider:

- custom tooltip styling;
- richer symbol pills;
- hover in selected guide snippets;
- custom docs-link injection inside popovers.

### Hover guardrails

- Never enable hover on shell transcripts.
- Never enable hover on invalid or partial code fragments unless deliberately stubbed.
- Never rely on hover for essential comprehension.
- Do not add aggressive visual affordances around every token.

The right outcome is: users discover hover naturally while reading examples, not because the page is yelling that it is interactive.

## API Reference: Index First, Signatures Later

The current API docs are useful but thin. That is fine today, but the long-term goal is a real API reference.

### End-state goal

Eventually the site should have:

- a package overview page;
- subpath landing pages;
- an API index;
- per-symbol pages with full signatures;
- deep links from examples into symbol pages.

### Why not a custom extractor first

It is tempting to build a bespoke TypeScript extractor from day one. That would be intellectually fun and strategically premature.

Problems it would force us to own too early:

- overload rendering;
- generic parameter formatting;
- JSDoc parsing edge cases;
- re-export modeling;
- source link generation;
- declaration grouping;
- symbol identity stability.

The smarter path is to let TypeDoc handle the hard compiler-shape problems first.

### Recommended API strategy

#### Phase A: symbol inventory

Before full signature pages, extract a lightweight API index from the three public entrypoints:

- `src/index.ts`
- `src/testkit.ts`
- `src/runtime.ts`

Each symbol entry should eventually have:

- stable id;
- package/subpath;
- symbol name;
- kind;
- summary;
- source file;
- deprecation state;
- example references if available.

#### Phase B: TypeDoc JSON foundation

Generate TypeDoc JSON during docs preparation.

Do not bind the UI directly to raw TypeDoc output. Normalize it into a dreamcli-specific docs model first.

Why normalize:

- it decouples rendering from vendor data shape;
- it makes later migration possible;
- it lets the site own its information architecture;
- it keeps page templates simple.

#### Phase C: full symbol pages

Render per-symbol pages from the normalized model.

Each page should include:

- symbol name;
- package/subpath;
- one-line summary;
- full signature or signatures;
- type parameters;
- parameter docs;
- return type;
- deprecation notes;
- examples;
- source link;
- see-also links.

### UX principle for API pages

Reference pages should feel like reference, not prose pretending to be reference. Concise, dense, searchable, and deeply linkable.

## Changelog: Canonical File, Better Surfacing

The right move is not to replace `CHANGELOG.md`, but to expose it better.

### Recommendation

- keep `CHANGELOG.md` as the canonical release history;
- surface it in docs under `Reference`;
- optionally derive a lightweight "recent releases" view later from that file.

### Why this is right

- the changelog already exists;
- it is better written than what git tags alone would yield;
- it is a product artifact worth preserving;
- users expect a docs-visible changelog.

### Implementation options

Simple first option:

- copy or transform `CHANGELOG.md` into a generated docs page during `docs:prepare`.

Later option:

- parse the file into structured release data for home-page release highlights or filtered release views.

## Docs Health: Public, Honest, Useful

This is the most unusual feature in the plan and one of the coolest, as long as it stays grounded.

### Why make it public

- it demonstrates confidence in the docs;
- it gives contributors a concrete target;
- it turns documentation quality into something inspectable;
- it aligns with dreamcli's overall "explicit, typed, visible" identity.

### Recommended first metrics

Keep the first version objective and cheap:

- total docs pages;
- total generated example pages;
- public API symbol count;
- symbols with summary docs;
- symbols with full signature pages;
- pages missing descriptions;
- local broken internal links;
- word count distribution;
- extraction warnings;
- last generated timestamp.

### What to avoid in v1

- external link checking;
- flashy scoring systems;
- vague quality grades;
- metrics that incentivize quantity over clarity.

The page should feel like a factual dashboard, not a gamified productivity board.

## Cross-Linking Strategy

The magic of this system will come less from any one feature and more from how the pieces connect.

Recommended links:

- guide pages -> relevant examples;
- example pages -> related guide pages;
- example pages -> referenced API symbols;
- hover cards -> symbol pages;
- symbol pages -> examples using that symbol;
- reference pages -> changelog where relevant;
- docs health -> any missing-coverage entry points.

This is the part that will make the docs feel coherent rather than merely generated.

## Suggested File and Artifact Layout

One reasonable target layout:

```txt
docs/
  SICK-ROADMAP.md
  .generated/
    examples/
      index.md
      basic.md
      multi-command.md
      ...
    reference/
      changelog.md
      health.md
    api/
      index.json
      typedoc.json
      normalized.json
  examples/
    index.md            # optional handwritten landing wrapper
  reference/
    api.md
    main.md
    runtime.md
    testkit.md
  .vitepress/
    config.ts
    theme/
      ...               # only if later needed

scripts/docs/
  build-docs-data.ts
  extract-api.ts
  extract-changelog.ts
  extract-examples.ts
  extract-health.ts
  normalize-typedoc.ts
  shared/
```

This exact layout can evolve, but the split between authored docs, generated docs, and extraction scripts should remain crisp.

## Roadmap Phases

The order matters.

### Phase 0 - Foundation

Goal: create the minimal build architecture for generated docs.

Deliverables:

- `docs:prepare` pipeline;
- generated docs output directory;
- script scaffolding under `scripts/docs/`;
- docs config updated to include new sections;
- generation flow wired into `docs:dev` and `docs:build`.

Why first:

- every later feature depends on this pipeline;
- it is easier to validate one generated page type at a time after the foundation exists.

### Phase 1 - Examples and examples navigation

Goal: make examples a first-class docs surface.

Deliverables:

- generated examples index page;
- one generated page per example;
- top-nav `Examples` section;
- example metadata extraction from module JSDoc;
- guide-to-example cross-links where obvious.

Success criteria:

- adding a new file in `examples/` creates a new docs page automatically;
- example pages are readable without any hover features;
- example pages are discoverable from nav and search.

### Phase 2 - Hover on examples

Goal: add IDE-like inspection where it helps most.

Deliverables:

- Twoslash-enabled example code blocks;
- default hover behavior working on example pages;
- local types resolving against dreamcli source;
- basic styling polish if needed.

Success criteria:

- hovering public dreamcli symbols in examples gives useful type info;
- the experience is stable on desktop;
- the page still feels calm and readable.

### Phase 3 - Changelog and docs health

Goal: expose the canonical release history and make docs quality visible.

Deliverables:

- generated docs page for `CHANGELOG.md`;
- public docs health page under `Reference`;
- initial docs-health metrics and local link checks.

Success criteria:

- changelog is browsable in the docs site;
- docs health feels factual, not gimmicky;
- contributors can use the page to spot obvious gaps.

### Phase 4 - API index

Goal: move from static overview to live API inventory.

Deliverables:

- generated symbol inventory;
- package/subpath grouping;
- API index page;
- links from subpath pages into the index.

Success criteria:

- every public export appears in the generated index;
- users can navigate by subpath and symbol kind;
- the index is clearly better than the current manual overview.

### Phase 5 - Full signature pages

Goal: deliver a real API reference.

Deliverables:

- TypeDoc JSON generation;
- normalized API model;
- per-symbol pages;
- deep links from examples and index to symbol pages.

Success criteria:

- function overloads, generics, and docs render correctly enough to trust;
- symbol pages are stable and linkable;
- API reference becomes the canonical technical reference.

### Phase 6 - Cross-linking and polish

Goal: make the ecosystem of pages feel tightly integrated.

Deliverables:

- hover cards linking to symbol pages;
- examples listed on symbol pages;
- selective guide links into examples and symbols;
- visual polish only where needed.

Success criteria:

- users can move fluidly between narrative docs, examples, and reference;
- interactivity feels earned, not gratuitous.

## Risks and Mitigations

### Risk: generated docs become a second product to maintain

Mitigation:

- keep generated artifacts small and well-scoped;
- separate extraction and rendering;
- avoid custom runtime code until necessary.

### Risk: hover becomes annoying

Mitigation:

- examples only first;
- default UI first;
- no hover-dependent comprehension.

### Risk: TypeDoc does not model some API shapes exactly as desired

Mitigation:

- normalize the data model;
- start with index pages before betting everything on per-symbol rendering;
- only build a custom extractor if real gaps remain after experience, not speculation.

### Risk: build complexity grows too quickly

Mitigation:

- ship phases in order;
- validate each generated content type independently;
- prefer build-time artifacts over dynamic runtime logic.

### Risk: docs health incentivizes vanity metrics

Mitigation:

- keep the page descriptive, not gamified;
- focus on missing coverage, broken links, and extraction warnings;
- avoid fake scorecards.

## Things Worth Doing Later, Not Now

These are good ideas, just not first-wave work.

- animation catalog from `docs/public/animations/*.svg`;
- hover on selected guide snippets;
- custom hover skin;
- symbol auto-linking for backticked names in markdown prose;
- examples-by-symbol reverse index;
- runtime compatibility matrix from CI artifacts;
- release highlights on the home page derived from `CHANGELOG.md`;
- bundle-size tracking page;
- generated type diagrams or mermaid relationship views;
- versioned docs manifests.

## What "Done Right" Looks Like

If this roadmap succeeds, the final user experience should feel like this:

- a new user can learn from examples fast;
- an experienced user can jump straight to exact API pages;
- hovering code in examples answers obvious symbol questions instantly;
- the changelog is easy to browse;
- the docs health page shows confidence rather than insecurity;
- everything feels directly connected to the real source tree;
- almost none of the cleverness is visible as implementation complexity.

That is the bar.

## Current Recommendation in One Screen

If this whole document had to collapse into one opinionated checklist, it would be:

- build `docs:prepare`;
- generate example pages from `examples/*.ts`;
- add top-level `Examples` nav;
- enable Twoslash hover on example pages only;
- surface `CHANGELOG.md` in docs;
- add a public docs health page;
- generate a live API index from public exports;
- use TypeDoc JSON plus a normalization layer for eventual symbol pages;
- add symbol-page links into hover later;
- keep the UX calm, readable, and boring in the best way.

No unresolved questions right now. The main thing left is implementation order and discipline.
