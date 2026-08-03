# Resolver Contract

This page records the internal resolver boundary for the `dreamcli-re-foundation` workstream.
It is a stability target for tests and refactors, not a public API guarantee.

## Responsibilities

- apply one precedence order to both surfaces:
  `cli -> stdin -> env -> config -> prompt -> default`
- read stdin only when resolution will select it
- gate prompts after non-interactive sources have been checked
- coerce and validate sourced values
- collect deprecations from explicit sources
- aggregate validation failures into one thrown `ValidationError`

## Non-Responsibilities

- read from runtime globals like `process.env` or terminal APIs directly
- discover config files or package metadata
- parse argv tokens into `ParseResult`
- run middleware or action handlers
- format terminal-facing error output

## Invocation Boundary

The resolver contract is modeled in `src/core/resolve/contracts.ts` as:

```ts twoslash
import type {
  CommandSchema,
  DeprecationWarning,
  ParseResult,
  PromptEngine,
} from '@kjanat/dreamcli';

interface ResolverInvocation {
  readonly schema: CommandSchema;
  readonly parsed: ParseResult;
  readonly options?: ResolveOptions;
}

interface ResolveOptions {
  readonly stdinData?: string | null;
  readonly env?: Readonly<
    Record<string, string | undefined>
  >;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly prompter?: PromptEngine;
}

interface ResolveResult {
  readonly flags: Readonly<Record<string, unknown>>;
  readonly args: Readonly<Record<string, unknown>>;
  readonly deprecations: readonly DeprecationWarning[];
}
```

The intent is simple:

- callers inject all external state through `ResolveOptions`
- resolver output is resolved values plus structured deprecation facts
- the executor layer owns rendering and handler execution after this point

## Source And Precedence Facts

`schema/source.ts` names the one stable precedence order, and `contracts.ts`
re-exports it:

```ts twoslash
const RESOLUTION_ORDER = [
  'cli',
  'stdin',
  'env',
  'config',
  'prompt',
  'default',
] as const;
```

Both surfaces walk it. An explicit `-` is CLI-sourced with bytes from stdin and
keeps CLI precedence, so it lands on `cli`; the `stdin` stage is the implicit
fallback an absent input takes before env. That order is the behavior contract
tests target.

Resolution also records which stage produced each value, keyed by input name.
The record distinguishes the two ways stdin delivers bytes
(`{ stage: 'cli', via: 'stdin', trigger: 'dash' }` versus
`{ stage: 'stdin', via: 'stdin', trigger: 'fallback' }`) and names the binding
that fired (`{ stage: 'env', envVar }`, `{ stage: 'config', configPath }`). It
is internal until the provenance surface lands.

## Diagnostic Expectations

- env, config, prompt, and stdin failures carry source-aware detail payloads
- hard coercion errors stop later fallback for that same field
- multiple validation failures are thrown as one aggregate error with per-error details
- aggregate validation failures also include per-issue summaries with normalized input labels and source labels when the failing source is known
- missing-value errors remain actionable via source-ordered suggestions

## Redesign Boundaries

This contract intentionally freezes behavior before deeper resolver work:

- module splitting can move orchestration, coercion, lookup, and error helpers apart
- aggregated diagnostics can improve, but source-aware details and explicit precedence must remain testable
- aggregate wrappers may change presentation, but they must keep nested per-error payloads plus explicit per-issue summaries for flags and args
- any shared flag/arg property model must preserve the current stage ordering unless a later contract explicitly changes it

## Shared Property Model Decision

The current resolver now makes that decision explicit in `src/core/schema/value.ts`:

- the shared flag/arg value model is **coercion-only**
- it supports `string`, `number`, `boolean`, `enum`, and `custom`
- the flag/argument overlap excludes flag-only `boolean`
- it does **not** own precedence order, fallback order, prompt/stdin policy, or required-value validation

That split is intentional.

Both surfaces own `cli -> stdin -> env -> config -> prompt -> default`. The
source axis is shared because the sources themselves are the same set;
`schema/source.ts` normalizes a flag or arg schema onto an ordered
`SourceBinding` list, and `resolve/stages.ts` walks that order once for both.
What stays per-surface is what genuinely differs: how a parsed CLI value reads,
how a raw value coerces, and how diagnostics name the subject.

## Evidence

- Contract module: `src/core/resolve/contracts.ts`
- Shared value model: `src/core/schema/value.ts`
- Current implementation: `src/core/resolve/index.ts`
- Existing behavior tests: `src/core/resolve/*.test.ts`
- RFC / PRD source: `specs/dreamcli-re-foundation.md`, `specs/dreamcli-re-foundation-prd.md`

## Current Status

- resolver input and output boundaries are now named explicitly in code
- precedence and diagnostic expectations now have one internal contract module
- resolver orchestration remains in `src/core/resolve/index.ts`, with flag and arg paths delegated to `flags.ts` and `args.ts`
