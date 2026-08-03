# resolve — Flag/arg value resolution chain

Multi-file module (split from monolithic index). 10 source files, ~2400 source lines.

## RESOLUTION ORDER

```
CLI argv -> piped stdin -> environment variable -> config file -> interactive prompt -> default value
```

Flags and args walk the same order. Each source tried in order; first non-undefined wins. Missing
required values with no source trigger `ValidationError`.

The order itself lives in `schema/source.ts` as `RESOLUTION_ORDER`, and `sourceBindings(schema)`
projects one flag or arg onto the subset it actually declares. `stages.ts` walks that projection, so
a source the projection omits is a source no stage can produce.

## FILES

| File             | Lines | Purpose                                                                       |
| ---------------- | ----: | ----------------------------------------------------------------------------- |
| `index.ts`       |   130 | `resolve()` — orchestrates the chain, then the Standard Schema pass           |
| `stages.ts`      |   226 | `runStages()` — one `SourceBinding` per stage, shared by both surfaces        |
| `flags.ts`       |   372 | `resolveFlags()` — two-pass walk over each flag's source bindings             |
| `args.ts`        |   281 | `resolveArgs()` — single-pass walk over each arg's bindings, then path checks |
| `coerce.ts`      |   658 | `coerceValue()` — unified raw value -> flag's declared kind                   |
| `path-checks.ts` |   108 | `validatePathChecks()` — shared `flag.path()` / `arg.path()` filesystem pass  |
| `config.ts`      |    26 | `resolveConfigPath()` — dotted path lookup in config object                   |
| `errors.ts`      |   227 | Error aggregation + `throwAggregatedErrors()`                                 |
| `contracts.ts`   |   188 | `ResolveOptions`, `ResolutionProvenance`, `resolverContract`                  |
| `standard.ts`    |   177 | Standard Schema v1 validation pass over resolved values                       |

## KEY FUNCTIONS

| Function                            | File             | Role                                                                |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `resolve()`                         | `index.ts`       | Main entry — orchestrates full resolution for a command             |
| `runStages()`                       | `stages.ts`      | Walks one input's source bindings, first outcome wins               |
| `resolveFlags()`                    | `flags.ts`       | All flags: the shared stage walk, in two passes                     |
| `resolveArgs()`                     | `args.ts`        | All args: the shared stage walk, then path checks                   |
| `coerceValue()`                     | `coerce.ts`      | Unified raw value -> flag's declared kind (stdin/env/config/prompt) |
| `coerceValueSchema()`               | `coerce.ts`      | Runs `decodeValue()` and names the subject on failure               |
| `resolveConfigPath()`               | `config.ts`      | Dotted path lookup in config object                                 |
| `validatePromptFlagCompatibility()` | `flags.ts`       | Prompt kind ↔ flag kind gate (before prompter invocation)           |
| `validatePathChecks()`              | `path-checks.ts` | Post-resolution filesystem pass, flags and args alike               |

## TWO-PASS ARCHITECTURE

1. **Pass 1** (all flags): the bindings ranked before `prompt` (CLI, stdin, env, config). Collect
   partial values.
2. **Interactive resolver call**: If command has `.interactive()`, invoke with partial flags.
3. **Pass 2** (unresolved flags): the bindings ranked at or after `prompt`, then required validation.

`withPromptBinding()` applies the `.interactive()` override to the second pass's list, since that
resolver may hand a prompt to a flag that declares none or take away the one it declares. Args have
no interactive resolver and walk their bindings in one pass.

## COERCION PATTERN

Single unified `coerceValue()` with `CoerceSource` discriminated union
(`{ kind: 'stdin' } | { kind: 'env'; envVar } | { kind: 'config'; configPath } | { kind: 'prompt' }`)
parameterizing source-specific behavior: string leniency, boolean truthy/falsy sets, array
trim-on-split, and error message templates. `suggestBySource()` is the one place that maps a source
to its phrasing, so a new source is a new field rather than a fourth ternary arm.

Returns `CoerceResult` (`{ ok: true; value } | { ok: false; error: ValidationError }`).

What a value _means_ is not decided here. `coerceValue()` projects the flag through
`flagValueSchema()` and, when the kind carries a value, hands the raw value to `decodeValue()` in
`schema/value.ts` with `source.kind` as the input surface. Only `array`, `count`, and `keyValue`
still coerce in this file, because they aggregate rather than decode. `coerceArgValue()` does
the same through `argValueSchema()`, then rewrites the message and details so a raw value from any
non-CLI source never reaches a diagnostic.

`valueCoercionError()` owns the flag-facing half. It turns a `ValueFailure` into the message, code,
details, and suggestion for one source. The value layer never spells a subject, so every
`--flag`-shaped string in the resolver comes from this file.

## ERROR AGGREGATION

`resolveFlags()` and `resolveArgs()` collect all errors into an array, then throw a single
aggregated `ValidationError` via `throwAggregatedErrors()`. Users see all validation messages at
once.

## TEST FILES (14, aspect-split)

| File                              | Tests                                                        |
| --------------------------------- | ------------------------------------------------------------ |
| `resolve.test.ts`                 | Core resolution logic, precedence rules                      |
| `resolve-errors.test.ts`          | Validation errors, missing required values                   |
| `resolve-env.test.ts`             | Environment variable resolution + coercion                   |
| `resolve-config.test.ts`          | Config file resolution + dotted paths                        |
| `resolve-prompt.test.ts`          | Prompt-based resolution                                      |
| `resolve-interactive.test.ts`     | Two-pass interactive mode (full flow)                        |
| `resolve-integration.test.ts`     | Cross-concern integration                                    |
| `resolve-aggregation.test.ts`     | Error aggregation behavior                                   |
| `resolve-arg-env.test.ts`         | Arg environment variable resolution                          |
| `resolve-stdin.test.ts`           | Stdin-based resolution                                       |
| `resolve-source-model.test.ts`    | Unified source model: precedence, stdin contract, provenance |
| `resolve-path-checks.test.ts`     | `flag.path()` / `arg.path()` filesystem checks               |
| `resolve-standard-schema.test.ts` | Standard Schema v1 validation pass                           |
| `contracts.test.ts`               | Contract verification                                        |

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
