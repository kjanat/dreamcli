# DreamCLI Re-Foundation

**Status:** Ready for milestone breakdown\
**Type:** Master RFC / implementation spec\
**Effort:** XL\
**Horizon:** Open-ended, multi-milestone\
**Last updated:** 2026-04-02

## Problem Statement

DreamCLI is technically strong, but the highest-value parts of the product are split across too many
implicit contracts.

Today:

- command planning lives in `src/core/cli/index.ts`, `dispatch.ts`, and `propagate.ts`;
- execution lives mostly in `src/core/testkit/index.ts`;
- resolution semantics live in `src/core/resolve/index.ts`;
- output and activity policy live in `src/core/output/index.ts` and `activity.ts`;
- product truth in docs is incomplete or inconsistent with reality in a few places.

This causes two real problems:

1. maintainers pay high cognitive cost every time they touch dispatch, resolution, output, or docs;
2. adopters hit ambiguity exactly where DreamCLI should feel most trustworthy: execution semantics,
   trade-offs, examples, migration confidence, and feature support claims.

This spec treats those as one problem, not separate cleanup chores.

## Goals

1. Make the execution pipeline explicit, staged, and testable.
2. Replace hidden ownership with a single shared internal executor.
3. Allow selective semantic redesign where current behavior is weak, misleading, or fragmented.
4. Make support claims fully honest, including completions and docs positioning.
5. Build a docs platform that derives structured content from source-of-truth inputs.
6. Turn examples into a first-class learning and reference surface.
7. Ship real fish and PowerShell completions.

## Non-Goals

- Preserve existing internal file layout.
- Preserve non-public APIs or type names.
- Keep the current testkit-owned execution model.
- Build a fully custom docs IDE.
- Version the docs site or this spec.
- Add runtime dependencies to the library core.

## Constraints

- Selective redesign is allowed.
- Breaking changes are acceptable because there are no external consumers to preserve.
- Internal files and names may move freely.
- New internal seams are encouraged where they reduce coupling.
- Human-written `concepts/` and `guide/` pages remain authored prose.
- Generated docs must be build-time derived, not runtime-clever.

## Evidence

This spec is grounded in:

- the evaluation feedback from 2026-04-02;
- `ROADMAP-DOCS.md`;
- `ROADMAP-DOCS-SICK.md`;
- current hotspots in `src/core/cli/`, `src/core/testkit/`, `src/core/resolve/`,
  `src/core/output/`, and `src/core/completion/`;
- current CI and coverage config in `.github/workflows/ci.yml`, `package.json`, and
  `vitest.config.ts`.

## Current State Summary

### Architectural hotspots

- `src/core/cli/index.ts`
  - owns root preflight, runtime sourcing, command erasure, help/version interception, dispatch,
    meta assembly, and result rendering.
- `src/core/testkit/index.ts`
  - is the de facto canonical executor even though that ownership is not expressed in the
    architecture.
- `src/core/resolve/index.ts`
  - mixes precedence rules, prompt handling, coercion, config lookup, arg resolution, error
    aggregation, and source-specific suggestion building.
- `src/core/output/index.ts` and `src/core/output/activity.ts`
  - mix output policy choice with concrete rendering and fallback behavior.
- `src/core/schema/command.ts` and `src/core/schema/run.ts`
  - expose contracts that multiple layers depend on, but the ownership boundaries around those
    contracts are not fully explicit.

### Product-truth hotspots

- docs lack a stable, explicit “why this design” layer;
- limitations and troubleshooting are scattered instead of consolidated;
- migration/adoption guidance is effectively absent;
- examples exist but are underexposed;
- completion support is broader in type surface than in actual implementation;
- docs and code claims are not always synchronized enough to inspire trust.

## Recommendation

Use **staged extraction plus branch-by-abstraction** around a **new shared internal executor**.

This is not a big-bang rewrite.

It is a controlled re-foundation with this backbone:

1. define product truth and target semantics;
2. freeze current and intended behavior with characterization tests;
3. introduce explicit planner, resolver, executor, and renderer contracts;
4. move code behind those contracts in stages;
5. implement missing completion support;
6. build source-backed docs infrastructure;
7. publish the stronger product story after semantics stabilize.

## Core Decisions

### D1: New shared executor becomes the canonical execution owner

Create a new internal execution layer, likely under `src/core/execution/`, and make both CLI and
testkit call it.

Rationale:

- execution is currently real but hidden inside `runCommand()`;
- CLI and testkit should not each own policy fragments;
- a shared executor is the narrowest seam that makes the architecture legible.

### D2: Planner, resolver, executor, and renderer become distinct stages

The target execution pipeline is:

```txt
runtime preflight -> invocation planner -> parser -> resolver -> executor -> renderer
```

Each stage gets an explicit input/output contract and its own test layer.

### D3: Selective redesign is allowed, but must be explicit

This cleanup may intentionally change semantics where current behavior is weak or misleading.

Examples likely in scope:

- stronger resolver diagnostics with source traceability;
- consistent aggregation behavior between flags and args;
- clearer output policy boundaries;
- explicit command planning outcomes instead of ad hoc branching.

Every deliberate semantic change must be called out in changelog/docs and covered by contract tests.

### D4: Examples become the highest-ROI docs surface

Examples are the first generated docs product because they already exist, already carry useful JSDoc,
and are the best place to introduce IDE-like hover.

### D5: TypeDoc plus normalization is the reference strategy

Do not build a custom symbol extractor first.

Use TypeDoc JSON as the eventual source for full signature pages, but normalize it into a
DreamCLI-specific docs model before rendering.

### D6: Hover ships on example pages first

Use default Twoslash hover on generated example pages first. Do not enable hover across prose-heavy
guide pages until example-page hover proves calm and useful.

### D7: Completion breadth must match support claims

Implement fish and PowerShell completions for real. Do not leave those shells in an aspirational,
throwing state once the support matrix is formalized.

## Stable Contracts

These contracts must be defined before major code movement.

### Invocation planner

```ts
type DispatchOutcome =
	| { readonly kind: 'root-help'; readonly help: HelpOptions }
	| { readonly kind: 'root-version'; readonly version: string }
	| { readonly kind: 'dispatch-error'; readonly error: CLIError }
	| { readonly kind: 'match'; readonly plan: CommandExecutionPlan };

interface CommandExecutionPlan {
	readonly command: ErasedCommand;
	readonly mergedSchema: CommandSchema;
	readonly argv: readonly string[];
	readonly meta: CommandMeta;
	readonly plugins: readonly CLIPlugin[];
	readonly output: OutputPolicy;
	readonly help: HelpOptions | undefined;
}
```

Requirements:

- planner owns root help/version/default-command behavior;
- planner owns propagated-flag schema merging;
- planner does not parse values or run handlers;
- planner outcomes are black-box tested without invoking handlers.

### Resolver contract

```ts
interface ResolvedCommandInput {
	readonly flags: Readonly<Record<string, unknown>>;
	readonly args: Readonly<Record<string, unknown>>;
	readonly deprecations: readonly DeprecationWarning[];
}
```

Requirements:

- precedence rules are explicit and tested;
- hard coercion failures are not silently replaced by prompt/default fallbacks;
- aggregated errors have stable shape and stable ordering rules;
- source-aware diagnostics are possible without leaking implementation detail to handlers.

### Output policy contract

```ts
interface OutputPolicy {
	readonly jsonMode: boolean;
	readonly isTTY: boolean;
	readonly verbosity: Verbosity;
}
```

Requirements:

- output policy is chosen outside concrete rendering code;
- JSON, TTY, and quiet semantics are stable and testable;
- activity cleanup is guaranteed in one place.

### Support truth contract

```ts
interface SupportMatrixEntry {
	readonly claim: string;
	readonly status: 'supported' | 'deferred' | 'experimental';
	readonly evidence: readonly string[];
}
```

Requirements:

- every marketed feature has a status;
- every supported feature points to proof in tests, docs, or generated artifacts;
- docs are generated or updated from this truth, not written independently of it.

## Target Architecture

### Runtime preflight

Owns:

- adapter selection;
- package.json discovery;
- config discovery;
- root argv normalization;
- prompt and stdin availability facts.

Should live in CLI-facing code, not in the shared executor.

### Invocation planner

Owns:

- root `--help` and `--version` handling;
- dispatch across nested commands;
- default-command fallback;
- propagated-flag collection and shadowing;
- meta assembly for the matched command;
- handoff to executor.

### Parser

Owns:

- argv tokenization and schema-based parsing only.

No runtime sourcing, no prompting, no execution decisions.

### Resolver

Owns:

- flag precedence: CLI -> env -> config -> prompt -> default;
- arg precedence: CLI -> stdin -> env -> default;
- prompt gating;
- coercion and validation;
- deprecation collection;
- aggregated error construction.

### Shared executor

Owns:

- parse -> resolve -> hooks -> derive/middleware -> action;
- guaranteed `out.stopActive()` cleanup;
- conversion to `RunResult`;
- common error wrapping.

### Renderer

Owns:

- CLI-facing terminal writes and exit behavior;
- JSON/text rendering policy for CLI-level errors;
- support for in-process result capture via testkit.

## Docs Architecture

The docs system should follow the split recommended in `ROADMAP-DOCS-SICK.md`:

```txt
scripts/docs/
  build-docs-data.ts
  extract-examples.ts
  extract-changelog.ts
  extract-health.ts
  extract-api.ts
  normalize-typedoc.ts
  shared/

docs/
  .generated/
    examples/
    reference/
    api/
  examples/
  reference/
  .vitepress/
```

Rules:

- generated artifacts live under `docs/.generated/`;
- handwritten docs stay outside `.generated/`;
- `docs:prepare` runs before `docs:dev` and `docs:build`;
- generated docs are reproducible build outputs, not hand-maintained content.

## Deliverables

| ID | Deliverable                                                                                           | Effort | Depends On |
| -- | ----------------------------------------------------------------------------------------------------- | ------ | ---------- |
| D1 | Product truth matrix and semantic baseline                                                            | M      | -          |
| D2 | Characterization test net for planner, resolver, executor, output, and completions                    | L      | D1         |
| D3 | Shared execution contracts plus new `core/execution` seam                                             | L      | D2         |
| D4 | CLI planner extraction and runtime-preflight split                                                    | L      | D3         |
| D5 | Resolver decomposition and selective redesign                                                         | XL     | D2, D3     |
| D6 | Output cleanup and full shell completion support                                                      | L      | D3, D4     |
| D7 | Docs generation foundation (`docs:prepare`, generated artifacts, IA changes)                          | L      | D1, D3     |
| D8 | Generated examples, Twoslash hover, changelog, docs health, API index, TypeDoc pipeline, symbol pages | XL     | D6, D7     |
| D9 | Narrative docs, migration/troubleshooting/limitations/rationale, CI hardening                         | L      | D5, D6, D8 |

## Detailed Deliverables

### D1: Product truth matrix and semantic baseline

Purpose:

- make current claims explicit;
- decide what is supported, deferred, experimental, or being redesigned;
- define what behavior is intentionally preserved versus intentionally changed.

Outputs:

- support matrix for major features;
- semantic baseline for planner, resolver, executor, output, completions, and runtime behavior;
- list of current docs claims to keep, revise, or delete.

Likely files touched:

- new internal truth artifact under `scripts/` or `docs/.generated/`;
- docs pages that currently overstate or understate support;
- completion and runtime docs.

Acceptance criteria:

- every marketed feature has a declared status;
- shell completion support is explicitly scoped and no longer ambiguous;
- known intentional redesign items are listed before code movement begins.

### D2: Characterization test net

Purpose:

- make refactor safety depend on explicit behavior, not intuition or line coverage.

Must lock down:

- dispatch semantics;
- root help/version/default-command behavior;
- propagated-flag masking;
- parser plus planner extraction order for `--json`, `--config`, `--help`, `--version`;
- resolver precedence and prompt/stdin gating;
- lifecycle hook order;
- output and activity behavior;
- completion behavior across all supported shells.

Likely files touched:

- `src/core/cli/*.test.ts`;
- `src/core/resolve/*.test.ts`;
- `src/core/testkit/*.test.ts`;
- `src/core/output/*.test.ts`;
- `src/core/completion/*.test.ts`.

Acceptance criteria:

- planner, resolver, executor, and output each have black-box contract suites;
- there is at least one kitchen-sink test per cross-cutting concern cluster;
- tests distinguish preserved semantics from intended redesigns.

### D3: Shared execution contracts plus `core/execution`

Purpose:

- establish one canonical execution engine.

Required shape:

- new internal module owns parse -> resolve -> hooks -> derive/middleware -> action -> result;
- testkit calls that module;
- CLI calls that module through planned invocation state;
- result shaping is not duplicated across CLI and testkit.

Likely files touched:

- new `src/core/execution/*`;
- `src/core/testkit/index.ts`;
- `src/core/schema/run.ts`;
- `src/core/schema/command.ts`;
- `src/core/cli/index.ts`.

Acceptance criteria:

- testkit is no longer the hidden execution owner;
- CLI and testkit use the same execution path for command invocation;
- `RunResult` ownership is clearer and no longer reconstructed in multiple places.

### D4: CLI planner extraction and runtime-preflight split

Purpose:

- make CLI code explicitly about runtime preflight, planning, and rendering, not hidden execution.

Sub-deliveries:

- extract runtime sourcing from planner logic;
- extract planner outcomes into an explicit discriminated union;
- keep dispatch and propagation logic pure where possible;
- reduce `cli/index.ts` to orchestration, not mixed concern ownership.

Likely files touched:

- `src/core/cli/index.ts`;
- `src/core/cli/dispatch.ts`;
- `src/core/cli/propagate.ts`;
- `src/core/cli/root-help.ts`;
- possible new planner module(s).

Acceptance criteria:

- invocation planning can be tested without running handlers;
- runtime preflight and planner are separate concerns;
- `eraseCommand()` ownership is clearer and documented.

### D5: Resolver decomposition and selective redesign

Purpose:

- make resolution semantics composable, inspectable, and easier to evolve.

Required work:

- split `resolve/index.ts` by concern, not by arbitrary line count;
- separate flag resolution orchestration, arg resolution orchestration, coercion helpers,
  config/source lookup, and error aggregation;
- decide and implement deliberate semantic upgrades.

Expected redesign targets:

- source-aware multi-error diagnostics;
- consistent aggregation strategy for flags and args;
- shared property-schema machinery where it genuinely reduces drift;
- tighter contract between interactive resolution and prompt fallback.

Likely files touched:

- new `src/core/resolve/*` modules;
- `src/core/schema/flag.ts` and `arg.ts` only if needed for cleaner shared contracts;
- relevant tests.

Acceptance criteria:

- resolver no longer mixes every concern in one file;
- redesigned semantics are explicit in changelog/docs and tests;
- no intended behavior change is accidental or hidden.

### D6: Output cleanup and full shell completion support

Purpose:

- make output policy easier to reason about;
- make completion support breadth match product claims.

Required work:

- split output policy choice from rendering implementation;
- make activity semantics explicit and testable;
- implement real fish completion support;
- implement real PowerShell completion support;
- ensure docs and types match shipped support.

Likely files touched:

- `src/core/output/index.ts`;
- `src/core/output/activity.ts`;
- `src/core/completion/index.ts`;
- `src/core/completion/shells/*`;
- completion docs/tests.

Acceptance criteria:

- fish and PowerShell generators exist and are covered;
- no shell in the public support surface throws as a placeholder;
- output policy is no longer entangled with every concrete output path.

### D7: Docs generation foundation

Purpose:

- create the boring, durable build architecture for generated docs.

Required work:

- add `docs:prepare` pipeline;
- wire it into `docs:dev` and `docs:build`;
- generate under `docs/.generated/`;
- update docs IA and nav to include Examples and generated Reference surfaces.

Likely files touched:

- `scripts/docs/*`;
- `package.json`;
- `docs/.vitepress/config.ts`;
- `docs/.generated/*` scaffolding.

Acceptance criteria:

- generated artifacts are reproducible;
- handwritten and generated content boundaries are crisp;
- build flow supports later examples/reference/health work without further architectural churn.

### D8: Generated examples, hover, changelog, docs health, API index, symbol pages

Purpose:

- turn docs into a source-backed product surface.

Sub-phases:

1. generated examples index and one page per example;
2. Twoslash hover on example pages only;
3. changelog page generated from `CHANGELOG.md`;
4. docs health page with factual metrics;
5. generated API symbol inventory from public entrypoints;
6. TypeDoc JSON generation plus normalization;
7. full per-symbol pages.

Required example-page contents:

- title and summary;
- what the example demonstrates;
- usage lines;
- full source with hover-enabled TypeScript fence;
- related guide pages;
- related API symbols;
- source file path.

Required docs-health metrics in v1:

- total docs pages;
- total generated example pages;
- public API symbol count;
- symbols with summary docs;
- symbols with full signature pages;
- pages missing descriptions;
- broken internal links;
- extraction warnings;
- generation timestamp.

Likely files touched:

- `scripts/docs/*`;
- `docs/.generated/examples/*`;
- `docs/.generated/reference/*`;
- `docs/.generated/api/*`;
- `docs/examples/*` and `docs/reference/*` wrappers;
- VitePress theme only if default Twoslash behavior needs light polish.

Acceptance criteria:

- adding an example file automatically yields a docs page;
- hover works on example pages against local DreamCLI source;
- changelog is browsable from docs;
- docs health is factual, not gamified;
- every public export appears in the API index;
- per-symbol pages are stable and linkable.

### D9: Narrative docs and CI hardening

Purpose:

- publish the stronger product story only after semantics and generated surfaces stabilize.

Required narrative docs:

- rationale / decisions page;
- known limitations and workarounds;
- troubleshooting;
- migration/adoption guidance;
- side-by-side comparison on a realistic scenario;
- feature decision trees where needed, especially derive vs middleware vs interactive.

Required CI hardening:

- real coverage command;
- coverage thresholds;
- docs build verification;
- docs-prepare verification;
- clearer runtime/platform checks where practical.

Likely files touched:

- `docs/guide/*`;
- `docs/concepts/*`;
- `README.md`;
- `package.json`;
- `vitest.config.ts`;
- `.github/workflows/ci.yml`.

Acceptance criteria:

- docs tell a coherent story about what DreamCLI is, when to use it, and where its edges are;
- CI protects the new architecture and docs surfaces from silent regression;
- evaluator-facing gaps around rationale, limitations, and adoption path are concretely closed.

## Rollout Order

The order is intentional.

```txt
D1 truth matrix
  -> D2 characterization tests
  -> D3 shared executor
  -> D4 planner split
  -> D5 resolver redesign
  -> D6 output + completions
  -> D7 docs foundation
  -> D8 generated docs + hover + reference
  -> D9 narrative docs + CI hardening
```

Notes:

- D7 can begin once D1 and D3 are stable enough, but should stay on foundation work, not semantics-
  sensitive prose.
- D8 can start incrementally, but API pages and cross-linking should wait for D6 and D7.
- D9 intentionally comes last because docs truth should follow stabilized semantics, not guess them.

## Test Strategy

| Layer       | Focus                                                     | Requirements                                                                        |
| ----------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Contract    | planner, resolver, executor, output, completion contracts | black-box suites for each explicit stage                                            |
| Integration | cross-stage semantics                                     | kitchen-sink commands covering dispatch, resolution, hooks, output, and completions |
| End-to-end  | user-visible behavior                                     | help/version/default command, JSON mode, nested commands, generated completions     |
| Platform    | runtime and shell support                                 | Node, Bun, Deno, plus shell-specific validation for bash, zsh, fish, PowerShell     |
| Docs truth  | docs claims backed by proof                               | support matrix entries point to tests/examples/generated artifacts                  |

### Mandatory characterization suites before major movement

- planner outcomes independent of handler execution;
- extraction ordering for `--json`, `--config`, `--help`, `--version`;
- precedence matrices for flags and args;
- prompt gating under TTY, non-TTY, and stdin-backed paths;
- lifecycle hook ordering;
- output policy behavior across `jsonMode`, `isTTY`, and `verbosity`;
- propagated-flag masking across planning, help, and completions;
- shell completion output per supported shell.

## Documentation Strategy

### Safe to build early

- docs IA changes;
- generated examples foundation;
- changelog surfacing;
- docs health foundation;
- generated API inventory foundation;
- frontmatter and searchability improvements;
- cross-link plumbing.

### Must wait for semantic stabilization

- migration guides;
- troubleshooting;
- limitations/workarounds;
- decisions/rationale pages that explain settled architecture;
- strong “why switch” positioning claims;
- final example-to-symbol and hover-to-symbol cross-link semantics.

## Data Model Additions

These shapes are illustrative targets, not exact exported names.

### Example docs model

```ts
interface ExampleDoc {
	readonly slug: string;
	readonly title: string;
	readonly summary: string;
	readonly demonstrates: readonly string[];
	readonly usage: readonly string[];
	readonly importedSymbols: readonly string[];
	readonly sourceText: string;
	readonly sourcePath: string;
	readonly relatedGuides: readonly string[];
	readonly relatedSymbols: readonly string[];
}
```

### API symbol inventory model

```ts
interface ApiSymbolDoc {
	readonly id: string;
	readonly subpath: '.' | './testkit' | './runtime';
	readonly name: string;
	readonly kind: string;
	readonly summary: string | undefined;
	readonly sourceFile: string;
	readonly deprecated: boolean;
	readonly examples: readonly string[];
}
```

### Docs health model

```ts
interface DocsHealthReport {
	readonly generatedAt: string;
	readonly totalPages: number;
	readonly generatedExamplePages: number;
	readonly publicSymbolCount: number;
	readonly symbolsWithSummary: number;
	readonly symbolsWithSignaturePages: number;
	readonly pagesMissingDescriptions: readonly string[];
	readonly brokenInternalLinks: readonly string[];
	readonly extractionWarnings: readonly string[];
}
```

## Trade-offs Made

| Chose                        | Over                          | Because                                                     |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------- |
| shared executor              | testkit-owned execution       | explicit ownership is more valuable than hidden convenience |
| staged re-foundation         | big-bang rewrite              | behavior must stay inspectable while code moves             |
| selective redesign           | strict semantic freeze        | some pain is semantic, not only structural                  |
| TypeDoc + normalization      | custom extractor first        | compiler-shape problems should be outsourced early          |
| hover on examples only       | hover everywhere              | examples are high-ROI and lower-noise                       |
| build-time generated docs    | dynamic runtime docs logic    | simpler, calmer, more reproducible                          |
| real fish/PowerShell support | narrowing the support surface | the product goal here is broader truth-backed capability    |

## Risks And Mitigations

| Risk                                               | Likelihood | Impact | Mitigation                                                                       |
| -------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------- |
| cleanup changes behavior accidentally              | High       | High   | D1 truth matrix plus D2 characterization suites before movement                  |
| shared executor becomes an abstraction blob        | Medium     | High   | keep planner and renderer outside; keep executor contract narrow                 |
| resolver redesign expands without bound            | High       | High   | separate structural extraction from explicit semantic changes                    |
| completion breadth steals focus                    | Medium     | Medium | do completions after planner and executor contracts stabilize                    |
| generated docs become a second product to maintain | Medium     | Medium | strict extraction/render split; build-time only; human prose remains human       |
| hover becomes noisy                                | Medium     | Medium | examples-only first; default Twoslash UI first; no hover-dependent comprehension |
| TypeDoc model gaps block reference work            | Medium     | Medium | normalize data and start with API inventory before full symbol pages             |
| CI hardening lands too early and slows refactor    | Medium     | Medium | add gates after major architectural churn settles                                |

## Success Metrics

### Architecture

- one shared executor owns command execution;
- planner, resolver, executor, and renderer each have explicit contracts and dedicated tests;
- `cli/index.ts`, `testkit/index.ts`, and `resolve/*` each have materially clearer ownership.

### Product truth

- every major support claim has a status and evidence path;
- shell completion support is fully implemented across bash, zsh, fish, and PowerShell;
- docs no longer overstate unsupported capability.

### Docs

- examples are discoverable from nav and search;
- changelog is visible inside docs;
- docs health is public and factual;
- every public export appears in a generated API index;
- example-page hover is stable, useful, and calm.

### Adoption

- docs answer who DreamCLI is for, when not to use it, and how to evaluate or adopt it;
- derive vs middleware vs interactive is documented with concrete decision guidance;
- the framework feels like a coherent product, not a set of clever internals.

## Definition of Done

This re-foundation is done when:

1. the execution path has one clear owner and one clear stage model;
2. selective semantic changes are intentional, documented, and regression-tested;
3. completion support is real across all claimed shells;
4. docs derive structured surfaces from code, examples, and changelog;
5. examples, reference, changelog, and docs health form one coherent docs system;
6. narrative docs explain not just what DreamCLI does, but why it is designed this way and where
   its boundaries are;
7. CI protects both the architecture and the docs platform from drift.

## Open Questions

None. Major scope decisions are resolved in this spec.

## First Breakdown Target

If this spec is converted into concrete tasks, the first breakdown should be:

1. D1 truth matrix and semantic baseline.
2. D2 characterization suites.
3. D3 shared executor seam.

Everything else depends on those being real, not assumed.
