# resolve — Flag/arg value resolution chain

Single file: `index.ts` (992 lines) — largest in the codebase.

## RESOLUTION ORDER

```
CLI argv → environment variable → config file → interactive prompt → default value
```

Each source is tried in order; first non-undefined wins. Missing required values with no source
trigger `ValidationError`.

## KEY FUNCTIONS

| Function               | Role                                                    |
| ---------------------- | ------------------------------------------------------- |
| `resolve()`            | Main entry — orchestrates full resolution for a command |
| `resolveFlag()`        | Single flag resolution through the chain                |
| `resolveArg()`         | Single arg resolution through the chain                 |
| `coerceValue()`        | Type coercion (string → number/boolean/enum)            |
| `applyEnvMapping()`    | `env` option → `process.env` lookup                     |
| `applyConfigMapping()` | `config` option → config object lookup                  |

## TEST ORGANIZATION (7 FILES)

Split by concern, not by function:

| File                          | Tests                                      |
| ----------------------------- | ------------------------------------------ |
| `resolve.test.ts`             | Core resolution logic, precedence rules    |
| `resolve-errors.test.ts`      | Validation errors, missing required values |
| `resolve-env.test.ts`         | Environment variable resolution            |
| `resolve-config.test.ts`      | Config file resolution                     |
| `resolve-prompt.test.ts`      | Prompt-based resolution                    |
| `resolve-interactive.test.ts` | Interactive mode (full prompt flow)        |
| `resolve-integration.test.ts` | Cross-concern integration                  |

## GOTCHAS

- File is at 992 lines — split candidate, but resolution logic is inherently sequential
- `ResolveOptions` injects everything: env, config, prompter, answers — never touches `process`
  directly
- `env.test.ts` and `config.test.ts` are 591 and 856 lines respectively — resolution tests are heavy
