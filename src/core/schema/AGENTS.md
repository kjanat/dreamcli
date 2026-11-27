# schema: builders, value layer, source axis

Public factories live in `command.ts`, `flag.ts`, `arg.ts`, and `middleware.ts`. The value, cardinality, and source axes are internal and imported by file.

## FILES

| File                           | Role                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `command.ts`                   | `command()`, `CommandBuilder`, `createCommandSchema()`           |
| `flag.ts`                      | `flag.*()`                                                       |
| `arg.ts`                       | `arg.*()`                                                        |
| `value.ts`, `value-parsers.ts` | `ValueSchema`, `decodeValue()`, sugar parsers                    |
| `cardinality.ts`               | `one` / `many` / `entries` / `count`, split policy, defaults     |
| `source.ts`, `stdin.ts`        | `RESOLUTION_ORDER`, `sourceBindings()`, stdin `when` / `consume` |
| `provenance.ts`                | public `ResolutionProvenance`, `wasExplicit()`                   |
| `env-binding.ts`               | indexed env families, `{index}` templates                        |
| `constraints.ts`               | command-level `conflicts` / `requires` / counts                  |
| `completion.ts`                | runtime value-completion callbacks                               |
| `brand.ts`                     | `schemaBrand`, type-only                                         |
| `run.ts`                       | `RunOptions` / `RunResult`                                       |
| `activity.ts`                  | spinner and progress types used by `Out`                         |
| `standard.ts`                  | vendored Standard Schema v1 types                                |
| `index.ts`                     | public barrel                                                    |

## WHERE TO LOOK

| Task                                 | Location                                                     |
| ------------------------------------ | ------------------------------------------------------------ |
| Decode or validate one raw value     | `decodeValue()` in `value.ts`                                |
| How many values a source carries     | `flagCardinality()` / `argCardinality()`                     |
| Which sources a flag or arg declares | `sourceBindings()`                                           |
| Precedence                           | `RESOLUTION_ORDER`: cli, stdin, env, config, prompt, default |
| Indexed `GIT_CONFIG_*`-style env     | `env-binding.ts`                                             |
| A new flag or arg kind               | the checklist below                                          |

## ADDING A KIND

A sugar factory (`url`, `date`, `duration`, `bytes`) adds a value constructor in `value.ts` and calls it from both factories. A new `kind` also updates:

1. `FLAG_KINDS`, `FlagSchema`, `FlagDefinitionByKind`, and the `flag` object in `flag.ts`
2. `flagValueSchema()` / `argValueSchema()` when the kind carries a value
3. `parse/index.ts` occurrence and `flagExpectsValue()`
4. `resolve/coerce.ts` and the unset-fallback in `resolve/flags.ts`
5. `help/index.ts` value hint
6. `json-schema/index.ts` type and meta-schema `kind` union
7. `core/schema/index.ts` and `src/index.ts`
8. A test in this directory, `docs/guide/flags.md`, and `CHANGELOG.md`

Value-level members go on both `flag` and `arg`, or on neither. Flag-only: `count`, `negatable`, `alias`, `duplicates`, `propagate`, `array`. Arg-only: `variadic` and required-by-default presence.

## ANTI-PATTERNS

- Do not export `value.ts`, `cardinality.ts`, `source.ts`, or `stdin.ts` from `index.ts`
- Do not value-import `schemaBrand`. `brand.ts` uses `export type`. A value import breaks the rolldown build with `MISSING_EXPORT`
- Do not test flag or arg records with `in`. Use `Object.hasOwn()`. A bare `record[name]` returns `Object.prototype` methods for names like `toString`
- Do not store an indexed env binding next to `envVar`. It lives on `envIndexed`

## NOTES

- `{}` is the `CommandBuilder` identity element. The `biome-ignore noBannedTypes` on that default stays
- `.middleware()` drops the current handler. The action is registered again after the middleware
- `assertUsableFlagKey()` rejects the name `__proto__`
- A variadic arg is last. Exclusive stdin has one consumer per command
