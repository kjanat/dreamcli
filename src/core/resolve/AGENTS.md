# resolve — Flag/arg value resolution chain

Single file: `index.ts` — largest in the codebase (~1.1k lines).

## RESOLUTION ORDER

```
CLI argv → environment variable → config file → interactive prompt → default value
```

Each source tried in order; first non-undefined wins. Missing required values with no source trigger
`ValidationError`.

## KEY FUNCTIONS

| Function              | Role                                                    |
| --------------------- | ------------------------------------------------------- |
| `resolve()`           | Main entry — orchestrates full resolution for a command |
| `resolveFlags()`      | All flags: CLI → env → config → prompt → default        |
| `resolveArgs()`       | All args: parsed → default → required validation        |
| `coerceEnvValue()`    | String env value → flag's declared kind                 |
| `coerceConfigValue()` | JSON config value → flag's declared kind                |
| `coercePromptValue()` | Prompt answer → flag's declared kind                    |
| `resolveConfigPath()` | Dotted path lookup in config object                     |

## TWO-PASS ARCHITECTURE

1. **Pass 1** (all flags): CLI → env → config. Collect partial values.
2. **Interactive resolver call**: If command has `.interactive()`, invoke with partial flags.
3. **Pass 2** (unresolved flags): prompt → default → required validation.

Without interactive resolver, single-pass (per-flag prompts used directly).

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

- ~1.1k lines — split candidate, but resolution logic is inherently sequential
- `ResolveOptions` injects everything: env, config, prompter, answers — never touches `process`
  directly
- Imports `schema/prompt.ts` directly (not through barrel) — circular dep avoidance
- `resolve-env.test.ts` and `resolve-config.test.ts` are the heaviest test files (~900+ lines each)
