# resolve — Flag/arg value resolution chain

Multi-file module (split from monolithic index). 8 source files, ~1333 source lines.

## RESOLUTION ORDER

```
CLI argv -> environment variable -> config file -> interactive prompt -> default value
```

Each source tried in order; first non-undefined wins. Missing required values with no source trigger
`ValidationError`.

## FILES

| File           | Lines | Purpose                                                                 |
| -------------- | ----: | ----------------------------------------------------------------------- |
| `index.ts`     |   108 | Barrel — re-exports public API                                          |
| `flags.ts`     |   201 | `resolveFlags()` — all flags: CLI -> env -> config -> prompt -> default |
| `args.ts`      |   141 | `resolveArgs()` — parsed -> default -> required validation              |
| `coerce.ts`    |   429 | `coerceValue()` — unified raw value -> flag's declared kind             |
| `config.ts`    |    25 | `resolveConfigPath()` — dotted path lookup in config object             |
| `errors.ts`    |   228 | Error aggregation + `throwAggregatedErrors()`                           |
| `property.ts`  |    87 | Property path resolution utilities                                      |
| `contracts.ts` |   114 | `ResolveOptions`, `CoerceResult`, `CoerceSource` types                  |

## KEY FUNCTIONS

| Function                            | File        | Role                                                          |
| ----------------------------------- | ----------- | ------------------------------------------------------------- |
| `resolve()`                         | `index.ts`  | Main entry — orchestrates full resolution for a command       |
| `resolveFlags()`                    | `flags.ts`  | All flags: CLI -> env -> config -> prompt -> default          |
| `resolveArgs()`                     | `args.ts`   | All args: parsed -> default -> required validation            |
| `coerceValue()`                     | `coerce.ts` | Unified raw value -> flag's declared kind (env/config/prompt) |
| `resolveConfigPath()`               | `config.ts` | Dotted path lookup in config object                           |
| `validatePromptFlagCompatibility()` | `flags.ts`  | Prompt kind ↔ flag kind gate (before prompter invocation)     |

## TWO-PASS ARCHITECTURE

1. **Pass 1** (all flags): CLI -> env -> config. Collect partial values.
2. **Interactive resolver call**: If command has `.interactive()`, invoke with partial flags.
3. **Pass 2** (unresolved flags): prompt -> default -> required validation.

Without interactive resolver, single-pass (per-flag prompts used directly).

## COERCION PATTERN

Single unified `coerceValue()` with `CoerceSource` discriminated union
(`{ kind: 'env'; envVar } | { kind: 'config'; configPath } | { kind: 'prompt' }`) parameterizing
source-specific behavior: string leniency, boolean truthy/falsy sets, array trim-on-split, and error
message templates.

Returns `CoerceResult` (`{ ok: true; value } | { ok: false; error: ValidationError }`).

## ERROR AGGREGATION

`resolveFlags()` and `resolveArgs()` collect all errors into an array, then throw a single
aggregated `ValidationError` via `throwAggregatedErrors()`. Users see all validation messages at
once.

## TEST FILES (10, aspect-split)

| File                          | Tests                                      |
| ----------------------------- | ------------------------------------------ |
| `resolve.test.ts`             | Core resolution logic, precedence rules    |
| `resolve-errors.test.ts`      | Validation errors, missing required values |
| `resolve-env.test.ts`         | Environment variable resolution + coercion |
| `resolve-config.test.ts`      | Config file resolution + dotted paths      |
| `resolve-prompt.test.ts`      | Prompt-based resolution                    |
| `resolve-interactive.test.ts` | Two-pass interactive mode (full flow)      |
| `resolve-integration.test.ts` | Cross-concern integration                  |
| `resolve-aggregation.test.ts` | Error aggregation behavior                 |
| `resolve-arg-env.test.ts`     | Arg environment variable resolution        |
| `resolve-stdin.test.ts`       | Stdin-based resolution                     |
| `contracts.test.ts`           | Contract verification                      |
| `property.test.ts`            | Property path resolution                   |

## PROMPT — FLAG KIND COMPATIBILITY

`COMPATIBLE_PROMPT_KINDS` in `flags.ts` maps each `FlagKind` to allowed `PromptKind[]`:

| Flag kind | Allowed prompt kinds                      |
| --------- | ----------------------------------------- |
| boolean   | confirm                                   |
| string    | input, select                             |
| number    | input                                     |
| enum      | select, input                             |
| array     | multiselect                               |
| custom    | input, select, confirm, multiselect (all) |

`validatePromptFlagCompatibility()` checks this map before `prompter.promptOne()` runs. Mismatches
produce a `CONSTRAINT_VIOLATED` `ValidationError` with `details.flagKind`, `details.promptKind`, and
an actionable `suggest`. This mirrors the compile-time `AllowedPromptConfig<C>` in `schema/flag.ts`.

## GOTCHAS

- Split from ~940-line monolithic index — `coerce.ts` (429 lines) is the largest piece
- `ResolveOptions` injects everything: env, config, prompter, answers — never touches `process`
- Imports `schema/prompt.ts` directly (not through barrel) — circular dep avoidance
- `DeprecationWarning` structs collected during resolution for deprecated flag/arg usage
- `contracts.ts` defines shared types used across all resolve files
