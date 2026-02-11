# resolve — Flag/arg value resolution chain

Single file: `index.ts` — largest in the codebase (~940 lines).

## RESOLUTION ORDER

```
CLI argv → environment variable → config file → interactive prompt → default value
```

Each source tried in order; first non-undefined wins. Missing required values with no source trigger
`ValidationError`.

## KEY FUNCTIONS

| Function              | Role                                                         |
| --------------------- | ------------------------------------------------------------ |
| `resolve()`           | Main entry — orchestrates full resolution for a command      |
| `resolveFlags()`      | All flags: CLI → env → config → prompt → default             |
| `resolveArgs()`       | All args: parsed → default → required validation             |
| `coerceValue()`       | Unified raw value → flag's declared kind (env/config/prompt) |
| `resolveConfigPath()` | Dotted path lookup in config object                          |

## TWO-PASS ARCHITECTURE

1. **Pass 1** (all flags): CLI → env → config. Collect partial values.
2. **Interactive resolver call**: If command has `.interactive()`, invoke with partial flags.
3. **Pass 2** (unresolved flags): prompt → default → required validation.

Without interactive resolver, single-pass (per-flag prompts used directly).

## COERCION PATTERN

Single unified `coerceValue()` function with a `CoerceSource` discriminated union
(`{ kind: 'env'; envVar } | { kind: 'config'; configPath } | { kind: 'prompt' }`) parameterizing
source-specific behavior: string leniency, boolean truthy/falsy sets ('y'/'n' for prompt), array
trim-on-split (prompt only), and error message templates.

Returns two-state `CoerceResult` (`{ ok: true; value } | { ok: false; error: ValidationError }`).
The prompt caller wraps this in a three-state `PromptResolveResult` at its own call site.

Helpers: `sourceLabel()` (error message fragment), `sourceDetails()` (error detail keys),
`coercionError()` (builds ValidationError with source context).

## ERROR AGGREGATION

`resolveFlags()` and `resolveArgs()` collect all errors into an array, then throw a single
aggregated `ValidationError` via `throwAggregatedErrors()`. Users see all validation messages at
once.

## TEST FILES (7, aspect-split)

| File                          | Tests                                      |
| ----------------------------- | ------------------------------------------ |
| `resolve.test.ts`             | Core resolution logic, precedence rules    |
| `resolve-errors.test.ts`      | Validation errors, missing required values |
| `resolve-env.test.ts`         | Environment variable resolution + coercion |
| `resolve-config.test.ts`      | Config file resolution + dotted paths      |
| `resolve-prompt.test.ts`      | Prompt-based resolution                    |
| `resolve-interactive.test.ts` | Two-pass interactive mode (full flow)      |
| `resolve-integration.test.ts` | Cross-concern integration                  |

## GOTCHAS

- ~940 lines — reduced from ~1.1k by unifying three coercion functions into one
- `ResolveOptions` injects everything: env, config, prompter, answers — never touches `process`
  directly
- Imports `schema/prompt.ts` directly (not through barrel) — circular dep avoidance
- `DeprecationWarning` structs collected during resolution for deprecated flag/arg usage
