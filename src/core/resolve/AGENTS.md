# resolve: value resolution

Flags and args walk the same order. The order is `RESOLUTION_ORDER` in `schema/source.ts`. `sourceBindings()` drops stages the input does not declare. First present value wins.

```text
cli -> stdin -> env -> config -> prompt -> default
```

## FILES

| File             | Role                                                     |
| ---------------- | -------------------------------------------------------- |
| `index.ts`       | `resolve()`, then the Standard Schema pass               |
| `stages.ts`      | `runStages()` over one input's bindings                  |
| `flags.ts`       | two-pass flag walk                                       |
| `args.ts`        | one-pass arg walk, then path checks                      |
| `coerce.ts`      | `coerceValue()` / `coerceArgValue()` via `decodeValue()` |
| `path-checks.ts` | `checkResolvedPath()`                                    |
| `indexed-env.ts` | acquire an indexed env family                            |
| `env-access.ts`  | `ENV_ACCESS_HINT` for a partial env view                 |
| `config.ts`      | dotted config lookup                                     |
| `errors.ts`      | `throwAggregatedErrors()`                                |
| `contracts.ts`   | `ResolveOptions`, provenance record                      |
| `standard.ts`    | Standard Schema v1 over resolved values                  |

## WHERE TO LOOK

| Task                                      | Location                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Precedence or a missing stage             | `schema/source.ts`, then `stages.ts`                                                |
| Prompt vs earlier sources                 | pass 1 is before `prompt`. `.interactive()` runs. Pass 2 is `prompt` onward         |
| A raw env, config, stdin, or prompt value | `coerce.ts`                                                                         |
| Filesystem `flag.path()` / `arg.path()`   | `path-checks.ts`. `stat` and `mkdir` are injected                                   |
| Why an env var looks unset under Deno     | `env-access.ts`                                                                     |
| Sensitive values in messages              | `diagnosticValue()` from `errors/`. Sensitivity is the schema field, not provenance |

## ANTI-PATTERNS

- Do not read `process`. `ResolveOptions` injects env, config, prompter, and answers
- Do not import `schema/prompt.ts` through the schema barrel
- Do not read `stringConstraints` or `parseFn` off the schema. Use `flagValueSchema()` / `argValueSchema()`
- Do not index a caller record with a bare `record[name]`. Use `Object.hasOwn()`

## NOTES

- `resolveFlags()` and `resolveArgs()` collect errors and throw one aggregated `ValidationError`
- Args have no interactive resolver
- A declared path check with no `stat` is recorded on `skippedPathChecks`. `pathChecks: 'strict'` throws `PATH_CHECK_SKIPPED` before the aggregated validation errors
- `ResolveOptions.envPrefix` is applied inside `sourceBindings()`. Downstream stages see concrete names
