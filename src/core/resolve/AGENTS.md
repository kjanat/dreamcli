# resolve — Flag/arg value resolution chain

Multi-file module (split from monolithic index). 9 source files, ~1930 source lines.

## RESOLUTION ORDER

```
CLI argv -> environment variable -> config file -> interactive prompt -> default value
```

Each source tried in order; first non-undefined wins. Missing required values with no source trigger
`ValidationError`.

## FILES

| File             | Lines | Purpose                                                                      |
| ---------------- | ----: | ---------------------------------------------------------------------------- |
| `index.ts`       |   124 | `resolve()` — orchestrates the chain, then the Standard Schema pass          |
| `flags.ts`       |   326 | `resolveFlags()` — all flags: CLI -> env -> config -> prompt -> default      |
| `args.ts`        |   184 | `resolveArgs()` — parsed -> stdin -> env -> default, then path checks        |
| `coerce.ts`      |   611 | `coerceValue()` — unified raw value -> flag's declared kind                  |
| `path-checks.ts` |   108 | `validatePathChecks()` — shared `flag.path()` / `arg.path()` filesystem pass |
| `config.ts`      |    26 | `resolveConfigPath()` — dotted path lookup in config object                  |
| `errors.ts`      |   227 | Error aggregation + `throwAggregatedErrors()`                                |
| `contracts.ts`   |   147 | `ResolveOptions`, `CoerceResult`, `CoerceSource` types                       |
| `standard.ts`    |   177 | Standard Schema v1 validation pass over resolved values                      |

## KEY FUNCTIONS

| Function                            | File             | Role                                                          |
| ----------------------------------- | ---------------- | ------------------------------------------------------------- |
| `resolve()`                         | `index.ts`       | Main entry — orchestrates full resolution for a command       |
| `resolveFlags()`                    | `flags.ts`       | All flags: CLI -> env -> config -> prompt -> default          |
| `resolveArgs()`                     | `args.ts`        | All args: CLI -> stdin -> env -> default, then path checks    |
| `coerceValue()`                     | `coerce.ts`      | Unified raw value -> flag's declared kind (env/config/prompt) |
| `coerceValueSchema()`               | `coerce.ts`      | Runs `decodeValue()` and names the subject on failure         |
| `resolveConfigPath()`               | `config.ts`      | Dotted path lookup in config object                           |
| `validatePromptFlagCompatibility()` | `flags.ts`       | Prompt kind ↔ flag kind gate (before prompter invocation)     |
| `validatePathChecks()`              | `path-checks.ts` | Post-resolution filesystem pass, flags and args alike         |

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

What a value _means_ is not decided here. `coerceValue()` projects the flag through
`flagValueSchema()` and, when the kind carries a value, hands the raw value to `decodeValue()` in
`schema/value.ts` with `source.kind` as the input surface. Only `array`, `count`, and `keyValue`
still coerce in this file, because they aggregate rather than decode. `coerceArgStringValue()` does
the same through `argValueSchema()`, then rewrites the message and details so a raw stdin or env
value never reaches a diagnostic.

`valueCoercionError()` owns the flag-facing half. It turns a `ValueFailure` into the message, code,
details, and suggestion for one source. The value layer never spells a subject, so every
`--flag`-shaped string in the resolver comes from this file.

## ERROR AGGREGATION

`resolveFlags()` and `resolveArgs()` collect all errors into an array, then throw a single
aggregated `ValidationError` via `throwAggregatedErrors()`. Users see all validation messages at
once.

## TEST FILES (13, aspect-split)

| File                              | Tests                                          |
| --------------------------------- | ---------------------------------------------- |
| `resolve.test.ts`                 | Core resolution logic, precedence rules        |
| `resolve-errors.test.ts`          | Validation errors, missing required values     |
| `resolve-env.test.ts`             | Environment variable resolution + coercion     |
| `resolve-config.test.ts`          | Config file resolution + dotted paths          |
| `resolve-prompt.test.ts`          | Prompt-based resolution                        |
| `resolve-interactive.test.ts`     | Two-pass interactive mode (full flow)          |
| `resolve-integration.test.ts`     | Cross-concern integration                      |
| `resolve-aggregation.test.ts`     | Error aggregation behavior                     |
| `resolve-arg-env.test.ts`         | Arg environment variable resolution            |
| `resolve-stdin.test.ts`           | Stdin-based resolution                         |
| `resolve-path-checks.test.ts`     | `flag.path()` / `arg.path()` filesystem checks |
| `resolve-standard-schema.test.ts` | Standard Schema v1 validation pass             |
| `contracts.test.ts`               | Contract verification                          |

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

- Split from ~940-line monolithic index — `coerce.ts` (680 lines) is the largest piece
- `ResolveOptions` injects everything: env, config, prompter, answers — never touches `process`
- Imports `schema/prompt.ts` directly (not through barrel) — circular dep avoidance
- `DeprecationWarning` structs collected during resolution for deprecated flag/arg usage
- `contracts.ts` defines shared types used across all resolve files
- Every read of a caller-supplied record keyed by a flag name, an arg name, or an env var name goes
  through `Object.hasOwn()` first. A flag may be named `toString` or `constructor`, and an env var
  may be too, so a bare `record[name]` returns the inherited `Object.prototype` method and the value
  reads as present. `resolveFlags()` guards `parsedFlags`, `env`, and the interactive resolver's
  override record; `resolveArgs()` guards `parsedArgs` and `env`; `resolveConfigPath()` guards every
  path segment.
- `resolveArgs()` is async because `arg.path()` checks reach the adapter, same as flags. Both call
  `validatePathChecks()` in `path-checks.ts`, which takes the subject (`{ kind: 'flag' | 'arg', name }`)
  and produces messages that differ only there. Arg path checks run over every entry a variadic arg
  collected, since a variadic path arg resolves to an array.
- Value-axis fields are read through the value layer, never off the schema. `flags.ts` gets its
  `pathChecks` and its prompt choices from `flagValueSchema()` / `valueEnumValues()`, `args.ts` gets
  its `pathChecks` from `argValueSchema()`, and `standard.ts` gets every validator (flag, array
  element, and arg) the same way. L15 can change what carries those fields without touching these
  files.
- `applyStandardValidators()` in `standard.ts` guards the resolved records for the same reason, even
  though `index.ts` builds them. They are incomplete whenever a resolver threw: `resolve()` catches
  the aggregated `ValidationError`, leaves `flags` or `args` at `{}`, and runs the validation pass
  anyway before rethrowing. A bare read handed a `toString` flag's `flag.custom()` validator the
  inherited method and added a second, invented `CONSTRAINT_VIOLATED` beside the real error.
