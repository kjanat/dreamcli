# DreamCLI Re-Foundation PRD

**Status:** Proposed, execution-ready\
**Owner:** Kaj Kowalski\
**Repo:** `kjanat/dreamcli`\
**Related spec:** `specs/dreamcli-re-foundation.md`\
**Tracking project:** `https://github.com/users/kjanat/projects/4`\
**Execution model:** Multi-milestone, backlog-driven, mixed-depth delivery\
**Document intent:** Expand the re-foundation spec into an implementation-driving product requirements document with explicit backlog shape, acceptance criteria, rollout logic, documentation strategy, and governance.

## 1. Executive Summary

DreamCLI already has real strengths: strong type inference, a schema-first design, a useful test harness,
cross-runtime support, and a coherent builder surface. What it does not yet have is a coherent operating model
for its own core execution path or a product surface that consistently communicates why the framework is built
this way, how far the current implementation really goes, and how a serious adopter should approach it.

This PRD proposes a re-foundation of DreamCLI across four coupled layers:

1. **Execution architecture**
2. **Support truth and semantic clarity**
3. **Documentation and learning surfaces**
4. **Execution tracking and delivery governance**

This is not a small refactor. It is also not a rewrite for its own sake.

The core thesis is simple:

- DreamCLI should have one explicit execution pipeline.
- DreamCLI should have one explicit truth model for what is supported and why.
- DreamCLI docs should feel connected to the actual source tree instead of hand-maintained approximations.
- DreamCLI should make advanced capability discoverable without becoming noisy, gimmicky, or harder to maintain.

The end state is a framework that feels less like a clever internal architecture experiment and more like a
serious product with a legible execution model, honest support claims, first-class examples, IDE-like inspection
where it helps, and a maintained backlog that can be worked through incrementally without losing the big picture.

## 2. Background and Why Now

The current re-foundation need is driven by both code reality and product reality.

On the code side, the current execution path is distributed across:

- `src/core/cli/index.ts`
- `src/core/cli/dispatch.ts`
- `src/core/cli/propagate.ts`
- `src/core/testkit/index.ts`
- `src/core/resolve/index.ts`
- `src/core/output/index.ts`
- `src/core/output/activity.ts`
- `src/core/schema/command.ts`
- `src/core/schema/run.ts`

The code works, but the architecture still makes maintainers answer these questions by reading multiple files at
once:

- Who actually owns command execution?
- Where does planning stop and execution begin?
- Which layer decides output behavior versus rendering behavior?
- Which semantics are guaranteed versus accidental?
- Which product claims are source-backed versus aspirational?

On the product side, the current docs have strong bones but incomplete truth. There are good guides, a clear
high-level pitch, and real examples, but the system still lacks:

- a migration story;
- a consolidated limitations story;
- a troubleshooting story;
- a full explanation of architectural trade-offs;
- a first-class examples surface;
- generated API reference depth;
- calm, scoped IDE-like code inspection where it would add real value.

The evaluation that triggered this work was not wrong. The evaluator's complaints are mostly symptoms of the same
underlying issue: DreamCLI has already grown past the point where architecture, docs, examples, and support claims
can evolve independently.

## 3. Problem Statement

DreamCLI currently has a split identity.

It is strong enough internally to impress a technical reader, but not yet coherent enough externally to make a
serious adopter feel fully oriented and confident.

### 3.1 Core problem

DreamCLI lacks a single, explicit, tested, documented contract for how a command moves from raw invocation to
resolved values to handler execution to rendered output.

### 3.2 Product impact

This shows up in several ways:

- maintainers touch large hot files for changes that should be local;
- architecture decisions are harder to explain because they are not staged clearly;
- advanced features exist but do not yet feel like a connected system;
- docs explain much of the "what" but not enough of the "why";
- support breadth is not always expressed with full honesty;
- the product risks losing serious users after the first impressive demo.

### 3.3 Opportunity cost of doing nothing

If this work is deferred:

- architecture cleanup gets harder as more features land on the current seams;
- resolver and CLI semantics continue to accrete complexity in the hottest areas;
- docs will either become more manual and stale, or more generated and incoherent if done without a foundation;
- advanced features will remain underused because discoverability will lag behind capability;
- adoption risk remains high even if individual technical features keep improving.

## 4. Vision

DreamCLI should become a framework where:

- a maintainer can explain the execution pipeline in one diagram and one paragraph;
- a contributor can find the right seam for a change without re-deriving the whole system;
- an evaluator can see exactly what is supported, what is intentionally not yet supported, and why;
- a new user can learn through examples quickly;
- an advanced user can navigate from examples to exact API details without friction;
- docs feel directly wired into the codebase, not manually approximated;
- the backlog for finishing this transformation is explicit and actively trackable.

## 5. Users and Stakeholders

### 5.1 Primary users

**Maintainer / framework author**

Needs:

- clear seams;
- lower cognitive load in core code;
- explicit test protection for semantics;
- a path to evolve the framework without hidden regressions.

**Advanced evaluator / power user**

Needs:

- architectural coherence;
- truthful support claims;
- a compelling explanation of trade-offs;
- enough examples and reference to judge whether the framework is real.

**New adopter**

Needs:

- a confident getting-started path;
- examples that scale beyond toy snippets;
- discoverability of advanced features;
- guidance for when to use DreamCLI and when not to.

### 5.2 Secondary stakeholders

**Future contributors**

Need:

- visible contracts;
- docs that map to code;
- a living backlog and project board.

**Course/evaluation audience**

Need:

- strong rationale;
- a coherent explanation of trade-offs and limitations;
- evidence, not just claims.

## 6. Product Principles

The re-foundation must preserve and strengthen the project's best existing instincts.

### 6.1 Schema is still the law

The system should continue to treat schema definitions as the single source of truth for parsing, resolution,
help, completions, and testing.

### 6.2 Explicit beats implicit

If a core stage exists conceptually, it should exist architecturally.

### 6.3 Calm docs win

The docs should feel alive and helpful, not loud or over-instrumented.

### 6.4 Source-backed truth

Generated surfaces should derive from actual source-of-truth inputs:

- source code;
- example files;
- changelog;
- explicit docs-health checks.

### 6.5 Tests protect semantics, not file structure

The re-foundation should be protected by black-box and contract tests, not by incidental line coverage or internal
shape.

### 6.6 Ambition must stay operationally boring

DreamCLI can be distinctive, but the implementation should still prefer durable, build-time, low-magic solutions.

## 7. Goals

### 7.1 Architecture goals

1. Introduce a single shared internal execution engine.
2. Separate runtime preflight, planning, parsing, resolution, execution, and rendering into explicit stages.
3. Reduce mixed-responsibility hotspots in `cli`, `testkit`, `resolve`, and `output`.
4. Support selective redesign where the current semantics are weak or misleading.

### 7.2 Product-truth goals

1. Create an explicit support matrix.
2. Align support claims with actual implementation.
3. Explain major architecture and DX trade-offs clearly.

### 7.3 Docs goals

1. Make examples a first-class docs surface.
2. Surface `CHANGELOG.md` inside the docs.
3. Add a public docs-health page.
4. Build a real generated API index and later symbol pages.
5. Add Twoslash-style hover on example pages only.

### 7.4 Delivery goals

1. Turn the re-foundation into a trackable project with draft backlog items.
2. Sequence work so riskier architecture changes happen before truth-sensitive docs work.
3. Preserve a working multi-session flow via `.opencode/state/`.

## 8. Non-Goals

1. Keep the current internal module boundaries.
2. Preserve non-public APIs or type names.
3. Keep fish and PowerShell as unimplemented placeholders.
4. Build a site-wide interactive IDE.
5. Replace authored guides/concepts with generated prose.
6. Introduce runtime dependencies into DreamCLI core.
7. Treat the re-foundation as one giant unrecoverable rewrite.

## 9. Constraints and Assumptions

### 9.1 Explicit constraints

- Breaking changes are acceptable because there are no external consumers to preserve.
- Internal files and names may move freely.
- Human-written docs remain human-written.
- Generated docs should be build-time derived.
- GitHub tracking should use a new private project.
- Tracked items in GitHub should be draft project items, not real repo issues.

### 9.2 Working assumptions

- The repo remains centered on Bun/VitePress/Vitest/TypeScript tooling.
- TypeDoc and Twoslash can be added as docs-tooling dependencies if they materially improve the docs platform.
- The current spec in `specs/dreamcli-re-foundation.md` remains the short architectural backbone; this PRD expands it.

## 10. Scope Model

This re-foundation includes several major workstreams that must be treated as one coordinated effort.

### 10.1 In scope

- support truth inventory and semantic baseline;
- explicit planner/resolver/executor/renderer contracts;
- new shared internal executor;
- CLI planner extraction and runtime preflight split;
- resolver decomposition and selective redesign;
- output policy cleanup;
- fish and PowerShell completion implementation;
- docs preparation pipeline;
- generated examples;
- Twoslash hover on examples;
- changelog surfacing;
- docs health;
- API index;
- TypeDoc normalization and symbol pages;
- rationale, migration, troubleshooting, limitations, and comparison docs;
- CI and coverage hardening relevant to the re-foundation.

### 10.2 Out of scope for first-wave execution

- hover across arbitrary guide snippets;
- custom interactive tutorial editor machinery;
- versioned docs;
- animation catalogs and other visually rich side systems;
- bundle-size dashboards;
- custom extractor replacing TypeDoc before real evidence says it is needed.

## 11. Current-State Diagnosis

### 11.1 Execution ownership is hidden

`runCommand()` in `src/core/testkit/index.ts` is effectively the execution owner, but the architecture does not
present it that way. CLI routing, output shaping, and execution wiring remain split enough that ownership still
needs to be inferred rather than read.

### 11.2 Planning and execution are coupled

`src/core/cli/index.ts` still mixes several concerns:

- runtime sourcing;
- config/package metadata discovery;
- root command behavior;
- command erasure;
- dispatch outcome branching;
- command meta assembly;
- final result shaping.

### 11.3 Resolver density is too high

`src/core/resolve/index.ts` currently blends:

- precedence policy;
- prompt orchestration;
- coercion behavior;
- config path traversal;
- arg-specific fallbacks;
- deprecation collection;
- error aggregation;
- source-specific suggestion building.

Even when correct, that is too much semantic density in one place.

### 11.4 Output policy and output implementation are not separated cleanly enough

Output behavior currently works, but the distinction between choosing a mode and rendering that mode is not as
crisp as it should be for future extension or simpler reasoning.

### 11.5 Docs are strong but not yet systematized

Docs already have enough substance to support a much richer product surface, but they still rely too much on
manual discoverability and too little on structured derivation.

## 12. Proposed Future-State Architecture

### 12.1 Stage model

The target stage model is:

```txt
runtime preflight -> invocation planner -> parser -> resolver -> executor -> renderer
```

This model is not just explanatory. It must become architectural truth.

### 12.2 Runtime preflight

Responsibilities:

- adapter selection;
- stdin availability facts;
- prompt availability facts;
- package.json discovery;
- config discovery;
- argv normalization at the CLI boundary.

Non-responsibilities:

- parsing command values;
- command resolution;
- handler invocation.

### 12.3 Invocation planner

Responsibilities:

- root `--help` and `--version` interception;
- nested command dispatch;
- default-command fallback;
- propagated flag collection and shadowing;
- merged schema handoff;
- command metadata construction.

Non-responsibilities:

- prompting;
- env/config lookup;
- running action handlers.

### 12.4 Parser

Responsibilities:

- tokenization;
- argv-to-parse-result conversion.

Non-responsibilities:

- runtime facts;
- value sourcing;
- validation against env/config/prompt sources.

### 12.5 Resolver

Responsibilities:

- source precedence;
- prompt behavior;
- coercion and validation;
- deprecation collection;
- aggregated error reporting.

Non-responsibilities:

- command routing;
- output rendering;
- lifecycle execution.

### 12.6 Shared executor

Responsibilities:

- parse -> resolve -> hooks -> derive/middleware -> action;
- common cleanup;
- common error wrapping;
- common `RunResult` assembly.

### 12.7 Renderer

Responsibilities:

- CLI-facing terminal rendering and exit behavior;
- in-process capture behavior for testkit;
- CLI-level JSON/text formatting of errors and output.

## 13. Contract Targets

The exact names may change, but these contract shapes should exist explicitly.

### 13.1 Dispatch / planner contract

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

### 13.2 Resolved input contract

```ts
interface ResolvedCommandInput {
	readonly flags: Readonly<Record<string, unknown>>;
	readonly args: Readonly<Record<string, unknown>>;
	readonly deprecations: readonly DeprecationWarning[];
}
```

### 13.3 Output policy contract

```ts
interface OutputPolicy {
	readonly jsonMode: boolean;
	readonly isTTY: boolean;
	readonly verbosity: Verbosity;
}
```

### 13.4 Support truth contract

```ts
interface SupportMatrixEntry {
	readonly claim: string;
	readonly status: 'supported' | 'deferred' | 'experimental';
	readonly evidence: readonly string[];
	readonly notes: string | undefined;
}
```

## 14. Workstream A - Support Truth and Semantic Baseline

This workstream exists so the re-foundation can distinguish:

- behavior that must be preserved;
- behavior that may be redesigned;
- behavior that is currently overclaimed;
- behavior that is intentionally deferred.

### Requirements

1. Create an explicit support matrix for major DreamCLI claims.
2. Mark each claim as supported, deferred, or experimental.
3. Link each supported claim to evidence.
4. List every planned semantic redesign explicitly.
5. Resolve completion support truth before broad docs changes.

### Acceptance criteria

- [ ] The support matrix includes architecture, runtime, completions, output, prompts, config, testing, examples, and docs surfaces.
- [ ] Each matrix entry includes status and evidence.
- [ ] Fish and PowerShell are not listed as supported until implementation lands.
- [ ] The matrix distinguishes intentional redesign from accidental current-state behavior.
- [ ] The matrix becomes a maintained source for docs and project tracking.

## 15. Workstream B - Characterization and Contract Testing

This workstream creates the regression net for the re-foundation.

### Requirements

1. Add black-box planner tests.
2. Add precedence matrix tests for flags and args.
3. Add prompt and stdin gating tests.
4. Add lifecycle order tests.
5. Add output policy tests across `jsonMode`, `isTTY`, and `verbosity`.
6. Add completion tests for all supported shells.
7. Keep existing high-value end-to-end suites green throughout refactoring.

### Acceptance criteria

- [ ] Planner outcomes can be tested without running handlers.
- [ ] Resolver precedence is covered by matrix-style tests instead of scattered single-source checks only.
- [ ] Prompt cancellation and stdin fallback behavior are black-box tested.
- [ ] Default-command, root-help, root-version, and nested-command behavior are explicitly protected.
- [ ] Completion tests cover bash, zsh, fish, and PowerShell once those shells are implemented.
- [ ] The test suite can distinguish intended semantic changes from regressions.

## 16. Workstream C - Shared Executor and CLI/Testkit Inversion

This is the architectural center of the re-foundation.

### Requirements

1. Introduce `src/core/execution/` or equivalent.
2. Move common execution flow into that layer.
3. Make testkit a consumer, not the owner, of execution.
4. Make CLI a planner and renderer over the same executor.
5. Consolidate result assembly and cleanup.

### Acceptance criteria

- [ ] There is one canonical path from parsed/resolved command input to handler invocation and result assembly.
- [ ] `runCommand()` no longer hides framework-wide execution ownership.
- [ ] CLI and testkit cannot drift in handler execution behavior without tests failing.
- [ ] Cleanup of active output handles is guaranteed in one place.
- [ ] `RunResult` ownership is explicit and no longer reconstructed ad hoc in multiple places.

## 17. Workstream D - CLI Planning and Runtime Preflight Split

### Requirements

1. Separate runtime sourcing from planner logic.
2. Represent planner outcomes as an explicit union.
3. Isolate command erasure and command-tree planning concerns.
4. Make propagated flag handling explicit and locally testable.

### Acceptance criteria

- [ ] Runtime preflight can be reasoned about separately from dispatch.
- [ ] Planner code does not also own execution semantics.
- [ ] Propagated flag merge rules are tested independently of handler execution.
- [ ] `cli/index.ts` materially loses mixed responsibilities rather than just moving lines around.

## 18. Workstream E - Resolver Decomposition and Selective Redesign

### Requirements

1. Split resolver code by concern.
2. Decide which semantics are intentionally improved.
3. Improve diagnostic quality where current behavior is opaque.
4. Reduce arg/flag duplication where a shared property model is justified.
5. Preserve the most valuable current invariants unless explicitly redesigning them.

### Candidate redesign targets

- stronger source-aware diagnostics;
- clearer aggregation strategy;
- cleaner prompt suppression semantics;
- less fragile arg/flag coercion reuse;
- clearer distinction between authoritative coercion failures and optional fallback behavior.

### Acceptance criteria

- [ ] `resolve/index.ts` is no longer the place where every resolution concern lives.
- [ ] Resolver redesign decisions are documented and reflected in tests.
- [ ] Error output tells users which source failed and what to do next.
- [ ] Aggregated errors are consistent across flags and args where appropriate.
- [ ] No redesign is allowed to remain implicit or undocumented.

## 19. Workstream F - Output Cleanup and Full Completion Support

### Requirements

1. Separate output policy selection from output rendering.
2. Preserve or improve activity semantics while making them easier to reason about.
3. Implement real fish completion support.
4. Implement real PowerShell completion support.
5. Align docs, types, and tests with actual shell support.

### Acceptance criteria

- [ ] Output policy exists as an explicit concept, not an emergent one.
- [ ] fish completion generation works and is tested.
- [ ] PowerShell completion generation works and is tested.
- [ ] No supported shell throws a placeholder exception.
- [ ] Docs and support matrix match implementation exactly.

## 20. Workstream G - Docs Preparation Foundation

This workstream creates the boring foundation for every generated docs surface.

### Requirements

1. Add `docs:prepare`.
2. Generate artifacts under `docs/.generated/`.
3. Create extraction scripts under `scripts/docs/`.
4. Wire docs generation into `docs:dev` and `docs:build`.
5. Keep authored and generated content sharply separated.

### Acceptance criteria

- [ ] `docs:prepare` can regenerate all generated docs artifacts from source-of-truth inputs.
- [ ] Generated docs live under `docs/.generated/`.
- [ ] `docs:dev` and `docs:build` depend on prepared artifacts.
- [ ] Generated artifacts are reproducible and not hand-edited.
- [ ] The docs platform can add new generated content types without architectural churn.

## 21. Workstream H - Generated Examples and Hover

Examples are the highest-ROI docs feature and the right first place for hover.

### Requirements

1. Generate an examples index.
2. Generate one docs page per example.
3. Extract metadata from module-level JSDoc and example source.
4. Add top-level Examples navigation.
5. Enable Twoslash hover on example pages only.
6. Keep pages readable without hover.

### Example page requirements

Every generated example page should include:

1. title;
2. summary;
3. what it demonstrates;
4. usage hints;
5. full source;
6. related guides;
7. related API symbols;
8. source path.

### Acceptance criteria

- [ ] Adding a new example file creates a new docs page automatically.
- [ ] Example pages are discoverable from nav and search.
- [ ] Hover works against local DreamCLI source on example pages.
- [ ] Hover is not required for comprehension.
- [ ] Example pages link clearly to related guides and symbols.

## 22. Workstream I - Changelog and Docs Health

### Requirements

1. Surface `CHANGELOG.md` inside the docs.
2. Add a factual public docs-health page.
3. Keep docs-health metrics objective and non-gamified.

### Docs-health v1 metrics

- total docs pages;
- total generated example pages;
- public API symbol count;
- symbols with summary docs;
- symbols with full signature pages;
- pages missing descriptions;
- broken internal links;
- extraction warnings;
- generation timestamp.

### Acceptance criteria

- [ ] The changelog is browsable in the docs site.
- [ ] Docs health is public, factual, and useful.
- [ ] The health page highlights real gaps instead of vanity metrics.
- [ ] Contributors can use the page to spot actionable docs work.

## 23. Workstream J - API Index and Symbol Pages

### Requirements

1. Generate a symbol inventory from public entrypoints.
2. Group symbols by subpath and kind.
3. Generate an API index page.
4. Use TypeDoc JSON for full signature data.
5. Normalize TypeDoc output before rendering.
6. Generate per-symbol pages.
7. Link examples and reference together.

### Acceptance criteria

- [ ] Every public export appears in the generated API index.
- [ ] The API index is more complete and more navigable than the current manual overview.
- [ ] TypeDoc output is normalized into DreamCLI's own docs model.
- [ ] Per-symbol pages are stable, linkable, and searchable.
- [ ] Examples and symbol pages can link to each other.

## 24. Workstream K - Narrative Docs, Rationale, Migration, and Troubleshooting

This workstream should happen after the architecture and truth surfaces are stable enough to document honestly.

### Required authored docs

1. Decision/rationale page.
2. Known limitations and workarounds page.
3. Troubleshooting page.
4. Migration/adoption guide.
5. Realistic side-by-side comparison page.
6. derive vs middleware vs interactive guidance.

### Acceptance criteria

- [ ] DreamCLI explains not just what it does, but why it does it this way.
- [ ] Limitations are consolidated with scope and workarounds.
- [ ] Troubleshooting covers the most likely real failure modes.
- [ ] Migration guidance helps a user think about switching from competing tools.
- [ ] Feature decision guidance reduces bounce risk for serious adopters.

## 25. Workstream L - CI, Coverage, and Reliability Hardening

### Requirements

1. Add an explicit coverage command.
2. Add coverage thresholds.
3. Make docs build verification part of the stable workflow.
4. Verify `docs:prepare` behavior in CI.
5. Improve clarity around runtime/platform checks.

### Acceptance criteria

- [ ] Coverage is measured and gated intentionally.
- [ ] Docs generation failures are caught in CI.
- [ ] Runtime support claims remain aligned with tests and docs.
- [ ] CI comments and workflow descriptions match actual behavior.

## 26. Data Models for Generated Docs

The generated docs platform should not improvise ad hoc JSON shapes per script.

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

### API symbol model

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

### Docs-health model

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

### Acceptance criteria

- [ ] Generated data models are explicit and reusable.
- [ ] Scripts do not each invent their own incompatible shapes.
- [ ] Rendering code depends on normalized data rather than raw extraction quirks.

## 27. Functional Requirements Summary

### FR-1: Shared executor

DreamCLI must have a single shared internal execution engine used by both CLI and testkit.

### FR-2: Explicit planner

DreamCLI must expose invocation planning as an explicit internal stage with clear outcomes.

### FR-3: Resolver redesign

DreamCLI must redesign and decompose the resolver so source precedence and diagnostics are explicit and testable.

### FR-4: Completion breadth

DreamCLI must support bash, zsh, fish, and PowerShell completions with tests.

### FR-5: Docs pipeline

DreamCLI must generate structured docs artifacts via `docs:prepare`.

### FR-6: Example-first docs

DreamCLI must generate example pages and make them top-level discoverable.

### FR-7: Example hover

DreamCLI must support Twoslash hover on example pages.

### FR-8: Changelog surfacing

DreamCLI must expose `CHANGELOG.md` in the docs.

### FR-9: Docs health

DreamCLI must publish a factual docs-health page.

### FR-10: API reference

DreamCLI must generate an API index and later symbol pages from normalized TypeDoc data.

### FR-11: Narrative docs completion

DreamCLI must publish rationale, limitations, troubleshooting, migration, and comparison docs after semantic stabilization.

### FR-12: Trackable execution

DreamCLI must maintain a backlog in both `.opencode/state/` and a private GitHub project.

## 28. Non-Functional Requirements

### NFR-1: Maintainability

Changes in planner, resolver, executor, and renderer should become easier to localize.

### NFR-2: Observability

Core semantic changes should be visible in tests and changelog/docs, not hidden in internal moves.

### NFR-3: Reliability

The architecture should make regressions harder to introduce silently.

### NFR-4: Docs calmness

Interactivity should remain scoped and subtle.

### NFR-5: Build-time orientation

Docs features should prefer build-time computation over runtime machinery.

### NFR-6: Truthfulness

No public docs surface should overstate support relative to implementation.

## 29. Rollout Strategy

### Phase 1 - Truth and contracts

Deliver:

- support truth matrix;
- semantic baseline;
- contract targets;
- characterization suites.

### Phase 2 - Core execution re-foundation

Deliver:

- shared executor;
- CLI planner split;
- runtime preflight split;
- clear execution ownership.

### Phase 3 - Resolver and output/completion modernization

Deliver:

- resolver decomposition;
- selective semantic redesign;
- fish and PowerShell completions;
- output policy cleanup.

### Phase 4 - Docs foundation and generated surfaces

Deliver:

- `docs:prepare`;
- generated examples;
- hover on examples;
- changelog;
- docs health;
- API index;
- TypeDoc normalization and symbol pages.

### Phase 5 - Narrative docs and hardening

Deliver:

- rationale;
- limitations;
- troubleshooting;
- migration;
- comparison;
- CI hardening.

## 30. GitHub Project Requirements

The re-foundation must be trackable outside the repo as active project work.

### Project configuration

- Project title: `DreamCLI Re-Foundation`
- Visibility: Private
- Item type: Draft project items
- Default workflow field: `Backlog`, `Ready`, `In Progress`, `Blocked`, `Done`
- Additional fields should support milestone/phase and execution priority.

### Project purpose

The project is not just a todo list. It should answer:

- what phase the work is in;
- what is blocked;
- what is ready next;
- which items are architecture-heavy versus docs/polish-heavy;
- which workstreams are already represented in the PRD.

### Acceptance criteria

- [ ] A dedicated private GitHub Project exists for the re-foundation.
- [ ] Draft items mirror the PRD task graph.
- [ ] Workflow states support backlog, readiness, active work, blockage, and done states.
- [ ] The project can be used as the operational board while `.opencode/state/` remains the file-based task source.

## 31. Backlog Design Principles

### 31.1 Mixed-depth backlog

The backlog should be detailed where risk is high and lighter where work is straightforward.

### 31.2 One PRD, many slices

This PRD is intentionally large, but execution should happen in bounded slices.

### 31.3 Dependencies must be real

Dependencies should reflect architectural blocking relationships, not bureaucratic sequencing.

### 31.4 Docs work should not outrun truth

Narrative docs must follow stabilized semantics.

## 32. Success Metrics

### Architecture success

- one shared executor exists and is used consistently;
- planner, resolver, executor, and renderer are each explicit concepts in both code and docs;
- core hotspots lose mixed responsibility, not just lines.

### Product-truth success

- every major claim has status and evidence;
- support breadth is honest;
- redesign decisions are visible.

### Docs success

- examples are top-level discoverable;
- hover works on examples without making the docs feel noisy;
- changelog is browsable;
- docs health is factual and useful;
- API index and symbol pages exist and are usable.

### Adoption success

- the docs explain why DreamCLI exists, who it is for, and where it is limited;
- derive vs middleware vs interactive is easier to reason about;
- the framework feels like a product with a roadmap, not a bag of features.

## 33. Risks and Mitigations

### Risk 1: The shared executor becomes just another blurry abstraction

Mitigation:

- keep the stage model explicit;
- keep planner and renderer out of the executor;
- test the executor as a boundary, not an implementation detail.

### Risk 2: Resolver redesign balloons into a local rewrite-without-end

Mitigation:

- separate decomposition from semantic redesign;
- require explicit redesign notes;
- protect behavior with matrix tests before movement.

### Risk 3: Completion breadth steals time from core architecture cleanup

Mitigation:

- sequence shell work after planner/executor seams are stable;
- keep shell generators black-box tested.

### Risk 4: Generated docs become a second product to maintain

Mitigation:

- strict extraction/render split;
- build-time only;
- calm UX;
- avoid custom runtime tricks until proven necessary.

### Risk 5: Hover becomes annoying or performative

Mitigation:

- examples only first;
- default Twoslash UI first;
- do not rely on hover for core understanding.

### Risk 6: TypeDoc shape is imperfect for DreamCLI's API presentation

Mitigation:

- normalize the data model;
- start with an API index;
- only consider a custom extractor if TypeDoc proves materially insufficient.

### Risk 7: Docs narrative is written too early and immediately becomes stale

Mitigation:

- keep semantics-sensitive docs until after architecture and truth stabilize.

## 34. Dependencies and Ordering Logic

### Hard dependencies

- truth matrix before narrative truth-sensitive docs;
- characterization tests before core movement;
- shared executor before full CLI/testkit ownership cleanup;
- planner split before broad completion and root-surface polish;
- docs foundation before generated examples/changelog/health/reference;
- TypeDoc normalization before symbol-page rendering.

### Soft dependencies

- docs health can begin once docs foundation exists;
- API index can precede full symbol pages;
- migration docs can begin once the major redesign choices are settled, even if some polish remains.

## 35. Detailed Acceptance Checklist

### Architecture checklist

- [ ] Execution ownership is explicit.
- [ ] Planner is a distinct internal concept.
- [ ] Runtime preflight is separated from planner logic.
- [ ] Resolver is decomposed by concern.
- [ ] Output policy is separated from rendering.
- [ ] Shared executor is used by CLI and testkit.
- [ ] Result assembly is not duplicated.

### Semantics checklist

- [ ] Preserved semantics are identified.
- [ ] Redesigned semantics are identified.
- [ ] Resolver precedence remains explicit.
- [ ] Error behavior is clearer than before.
- [ ] Completion support claims are honest.

### Docs checklist

- [ ] `docs:prepare` exists.
- [ ] Generated docs live under `docs/.generated/`.
- [ ] Examples are top-level discoverable.
- [ ] Twoslash hover works on example pages.
- [ ] `CHANGELOG.md` is visible in docs.
- [ ] Docs health is visible in docs.
- [ ] API index exists.
- [ ] Symbol pages exist.
- [ ] Rationale docs exist.
- [ ] Limitations docs exist.
- [ ] Troubleshooting docs exist.
- [ ] Migration docs exist.

### Reliability checklist

- [ ] Contract suites exist for planner, resolver, executor, output, and completions.
- [ ] Coverage thresholds exist.
- [ ] Docs build verification exists.
- [ ] Workflow descriptions in CI match actual behavior.

### Tracking checklist

- [ ] `.opencode/state/dreamcli-re-foundation/` exists.
- [ ] `prd.json` is populated and valid.
- [ ] `progress.txt` exists.
- [ ] GitHub project exists.
- [ ] Draft project items mirror the backlog.

## 36. Execution Readiness Criteria

The PRD is considered ready to drive work when:

1. the project backlog can be generated directly from it;
2. the first three phases are sufficiently concrete to start execution immediately;
3. the tracking project exists and is populated;
4. the document gives enough guidance that execution can continue across sessions without re-scoping the effort.

## 37. Initial Task Breakdown Intent

The first execution slices should be:

1. support truth matrix and semantic baseline;
2. characterization and contract tests;
3. shared executor seam;
4. CLI planner/runtime split.

That ordering is intentional because it minimizes the chance of elegant-looking but semantically unsafe refactors.

## 38. Out-of-Band Coordination Rules

While this PRD is active:

- docs truth should not be updated casually without checking the support matrix;
- completion support should not be marketed beyond what tests confirm;
- architecture moves should update the PRD backlog and progress log when they materially change sequencing;
- major semantic redesigns should be logged explicitly.

## 39. What Done Looks Like

When this PRD succeeds, DreamCLI should feel like this:

- the execution path is easy to explain and safe to change;
- the docs feel connected to the source tree;
- examples are a powerful entry point, not an afterthought;
- hover is useful but not noisy;
- the API reference is real;
- support claims are fully honest;
- the backlog is visible and tractable;
- the framework feels mature enough that a critical evaluator or adopter can trust it.

## 40. Final Product Judgment Target

This re-foundation should move DreamCLI from "technically strong with visible gaps" toward
"coherent, evidence-backed, product-grade framework".

That means the final standard is not merely fewer lines in hot files.

It is:

- clearer architecture;
- clearer semantics;
- clearer truth;
- clearer learning path;
- clearer execution discipline.

## 41. No Open Questions

The major framing decisions for this PRD are resolved:

- private dedicated GitHub project;
- draft project items instead of real repo issues;
- mixed-depth backlog;
- PRD expands the existing spec;
- examples, changelog, docs health, TypeDoc reference, and example hover are all in scope;
- fish and PowerShell completion support are in scope.

Further questions can emerge during execution, but they are implementation questions, not PRD-blocking questions.
