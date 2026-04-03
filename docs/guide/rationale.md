# Architecture Rationale

This page explains why dreamcli is shaped the way it is.

Use it when the API already makes sense, but you want the architectural trade-offs behind it.
For exact behavior, use [CLI Semantics](/guide/semantics) and the [Support Matrix](/reference/support-matrix).

## The Core Bet

dreamcli treats the command schema as the product truth, not just parser input.

One definition is expected to drive:

- parsing;
- type inference;
- resolution from CLI, env, config, prompts, and defaults;
- help and shell completions;
- test harness overrides;
- generated docs and reference surfaces.

That is the main reason the library has custom parser, resolver, completion, and testkit layers instead of delegating each concern to unrelated tools.

## Why Schema-First Instead of Glue-First

Many CLI stacks compose well if you are happy to wire several independent pieces by hand.
dreamcli optimizes for a different goal: define the command once, then keep types and semantics aligned across the whole path.

Benefits:

- handlers receive already-resolved typed values instead of partially parsed blobs;
- help, completions, and tests stay coupled to the same schema truth;
- advanced inputs like env, config, prompts, and stdin do not need separate adapter code in every app.

Trade-off:

- the framework owns more of the stack, so internal architecture matters more than in a thin parser-only library.

## Why One Explicit Execution Pipeline

The re-foundation moved DreamCLI toward one canonical execution path in `src/core/execution/index.ts`.
CLI entrypoints and `runCommand()` now delegate to the same executor instead of each owning their own version of the flow.

Why that matters:

- planner, resolver, and output changes can be localized more safely;
- contract tests can lock behavior at stage boundaries instead of through incidental file shape;
- docs can point at one owned execution seam instead of explaining overlapping ownership.

This design is documented further in the [Semantic Delta Log](/reference/semantic-delta-log), [Planner Contract](/reference/planner-contract), [Resolver Contract](/reference/resolver-contract), and [Output Contract](/reference/output-contract).

## Why The Resolution Chain Is Built In

dreamcli intentionally ships a first-class resolution chain instead of treating env/config/prompt input as userland glue.

The current supported precedence is:

```text
Flags: CLI -> env -> config -> prompt -> default
Args:  CLI -> stdin -> env -> default
```

Why this is built in:

- command handlers should see final values, not source-merging boilerplate;
- prompts only make sense when they participate in the same precedence story as other inputs;
- tests need a stable seam for injecting every supported source.

Trade-off:

- the resolver is a real subsystem, not a tiny helper, so its behavior must stay explicit and contract-tested.

## Why Runtime Adapters Exist

dreamcli supports Node, Bun, and Deno without putting runtime-specific APIs in the core command system.
The adapter layer keeps process, stdio, cwd, env, and package/config lookup concerns out of the schema, planner, and executor layers.

Why that is preferable here:

- core behavior stays portable;
- testkit can inject runtime behavior cleanly;
- Bun and Deno support can stay honest without forking the framework design.

Trade-off:

- the runtime floor is intentionally modern, because supporting older environments would force more conditional compatibility code into a codebase that is trying to stay small and explicit.

## Why Docs Are Half Authored And Half Generated

The docs strategy is intentionally mixed.

Human-written pages explain intent, trade-offs, and limitations.
Generated pages cover examples, changelog mirroring, docs health, API inventory, and symbol reference.

Why not generate everything:

- rationale and limitations need judgment, not extraction;
- authored guides are calmer and easier to read than generated prose;
- generated docs are strongest when they stay factual and source-backed.

Why not hand-write everything:

- example inventories, public exports, and symbol pages would drift too easily;
- source-backed docs give evaluators proof, not just claims.

## Why Hover Is Scoped To Example Pages

Twoslash-style hover is useful where a reader is already looking at real code.
It is not useful enough to justify turning the whole docs site into an IDE.

That is why hover is limited to generated example source blocks.

This keeps the docs:

- informative for serious readers;
- readable without interaction;
- operationally boring at build time.

## Why The Library Stays Opinionated

dreamcli is not trying to be the smallest possible CLI parser.
It is trying to be a coherent product for people who want typed commands, typed middleware, built-in structured output, and a serious in-process test harness.

That means the project is opinionated about:

- schema as the law;
- execution stages being explicit;
- generated truth surfaces being source-backed;
- advanced features staying calm instead of flashy.

If those opinions match your use case, the framework removes a lot of repetitive glue.
If you only need flag parsing plus a tiny action, the extra system may be unnecessary.

## Related Pages

- [Why dreamcli](/guide/why)
- [CLI Semantics](/guide/semantics)
- [Support Matrix](/reference/support-matrix)
- [Semantic Delta Log](/reference/semantic-delta-log)
- [Testing Commands](/guide/testing)
