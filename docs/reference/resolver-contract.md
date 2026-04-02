# Resolver Contract

This page records the internal resolver boundary for the `dreamcli-re-foundation` workstream.
It is a stability target for tests and refactors, not a public API guarantee.

## Responsibilities

- apply flag precedence: `cli -> env -> config -> prompt -> default`
- apply arg precedence: `cli -> stdin -> env -> default`
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

```ts
interface ResolverInvocation {
  readonly schema: CommandSchema;
  readonly parsed: ParseResult;
  readonly options?: ResolveOptions;
}

interface ResolveOptions {
  readonly stdinData?: string | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
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

`contracts.ts` also names the stable precedence orders:

```ts
const FLAG_RESOLUTION_ORDER = [
  'cli',
  'env',
  'config',
  'prompt',
  'default',
] as const;
const ARG_RESOLUTION_ORDER = ['cli', 'stdin', 'env', 'default'] as const;
```

Those orders are the behavior future contract tests should target.

## Diagnostic Expectations

- env, config, prompt, and stdin failures carry source-aware detail payloads
- hard coercion errors stop later fallback for that same field
- multiple validation failures are thrown as one aggregate error with per-error details
- missing-value errors remain actionable via source-ordered suggestions

## Redesign Boundaries

This contract intentionally freezes behavior before deeper resolver work:

- module splitting can move orchestration, coercion, lookup, and error helpers apart
- aggregated diagnostics can improve, but source-aware details and explicit precedence must remain testable
- any shared flag/arg property model must preserve the current stage ordering unless a later contract explicitly changes it

## Evidence

- Contract module: `src/core/resolve/contracts.ts`
- Current implementation: `src/core/resolve/index.ts`
- Existing behavior tests: `src/core/resolve/*.test.ts`
- RFC / PRD source: `specs/dreamcli-re-foundation.md`, `specs/dreamcli-re-foundation-prd.md`

## Current Status

- resolver input and output boundaries are now named explicitly in code
- precedence and diagnostic expectations now have one internal contract module
- full resolver decomposition is still future work; production logic remains in `src/core/resolve/index.ts`
