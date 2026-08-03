# resolve — Flag/arg value resolution chain

Multi-file module (split from monolithic index). 10 source files, ~2870 source lines.

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
| `index.ts`       |   153 | `resolve()` — orchestrates the chain, then the Standard Schema pass           |
| `stages.ts`      |   263 | `runStages()` — one `SourceBinding` per stage, shared by both surfaces        |
| `flags.ts`       |   433 | `resolveFlags()` — two-pass walk over each flag's source bindings             |
| `args.ts`        |   299 | `resolveArgs()` — single-pass walk over each arg's bindings, then path checks |
| `coerce.ts`      |  1175 | `coerceValue()` — unified raw value -> flag's declared kind                   |
| `path-checks.ts` |   134 | `validatePathChecks()` — shared `flag.path()` / `arg.path()` filesystem pass  |
| `redaction.ts`   |    29 | `echoesValue()` / `REDACTED` — the one rule for value text in diagnostics     |
| `config.ts`      |    26 | `resolveConfigPath()` — dotted path lookup in config object                   |
| `errors.ts`      |   226 | Error aggregation + `throwAggregatedErrors()`                                 |
| `contracts.ts`   |   182 | `ResolveOptions`, `ResolutionProvenanceRecord`, `resolverContract`            |
| `standard.ts`    |   283 | Standard Schema v1 validation pass over resolved values                       |

## KEY FUNCTIONS

| Function                            | File             | Role                                                                |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `resolve()`                         | `index.ts`       | Main entry — orchestrates full resolution for a command             |
| `runStages()`                       | `stages.ts`      | Walks one input's source bindings, first outcome wins               |
| `resolveFlags()`                    | `flags.ts`       | All flags: the shared stage walk, in two passes                     |
| `resolveArgs()`                     | `args.ts`        | All args: the shared stage walk, then path checks                   |
| `coerceValue()`                     | `coerce.ts`      | Unified raw value -> flag's declared kind (stdin/env/config/prompt) |
| `coerceValueSchema()`               | `coerce.ts`      | Runs `decodeValue()` and names the flag on failure                  |
| `argValueCoercionError()`           | `coerce.ts`      | Words the same `ValueFailure` for the positional surface            |
| `resolveConfigPath()`               | `config.ts`      | Dotted path lookup in config object                                 |
| `validatePromptFlagCompatibility()` | `flags.ts`       | Prompt kind ↔ flag kind gate (before prompter invocation)           |
| `argPromptCompatibility()`          | `args.ts`        | The same gate read through the arg's value and cardinality axes     |
| `promptCompatibilityError()`        | `flags.ts`       | Words that gate's failure for whichever surface declared the prompt |
| `validatePathChecks()`              | `path-checks.ts` | Post-resolution filesystem pass, flags and args alike               |
| `echoesValue()`                     | `redaction.ts`   | Whether a recorded provenance permits quoting the value             |

## TWO-PASS ARCHITECTURE

1. **Pass 1** (all flags): the bindings ranked before `prompt` (CLI, stdin, env, config). Collect
   partial values.
2. **Interactive resolver call**: If command has `.interactive()`, invoke with partial flags.
3. **Pass 2** (unresolved flags): the bindings ranked at or after `prompt`, then required validation.

`withPromptBinding()` applies the `.interactive()` override to the second pass's list, since that
resolver may hand a prompt to a flag that declares none or take away the one it declares. Args have
no interactive resolver and walk their bindings in one pass.

## COERCION PATTERN

`coerceValue()` and `coerceArgValue()` take the `DecodedSourceBinding` the stage walked, which is
where every per-source setting lives: `binding.split` decides how a collection's text decodes and
`binding.trim` whether a single stdin value drops its terminator. `diagnosticSourceOf(binding)`
turns it into the `CoerceSource` discriminated union
(`{ kind: 'stdin' } | { kind: 'env'; envVar } | { kind: 'config'; configPath } | { kind: 'prompt' }`)
that parameterizes the wording alone: string leniency, boolean truthy/falsy sets, array
trim-on-split, and error message templates. `suggestBySource()` is the one place that maps a source
to its phrasing, so a new source is a new field rather than a fourth ternary arm.

No non-literal-CLI source echoes its value. Every message this file builds says `'<redacted>'` where the
value would go and every `details` record omits it, on both surfaces: stdin, the environment, a
config file, and a prompt answer all carry values a user may consider secret. `parse/index.ts` keeps
quoting the token the user typed, which is already on their screen. `sourceDetails()` writes
`source` on every coercion failure, which is what tells `errors.ts` a stage produced a value, as
against a required input that merely declares an env var.

`redaction.ts` owns the rule for the passes that run after coercion, where the raw source is gone
and only the recorded `ResolutionProvenance` says where a value came from. `echoesValue(provenance)`
is true for `{ stage: 'cli' }` alone, so an explicit `-` (`{ stage: 'cli', via: 'stdin' }`) and a
declared default both redact. `standard.ts` and `path-checks.ts` read it; `coerce.ts` takes the
`REDACTED` constant from the same module so one spelling reaches every surface.

Returns `CoerceResult` (`{ ok: true; value } | { ok: false; error: ValidationError }`).

What a value _means_ is not decided here. `coerceValue()` projects the flag through
`flagValueSchema()` and hands each raw value to `decodeValue()` in `schema/value.ts` with
`source.kind` as the input surface. How MANY values a source carries is the cardinality axis:
`flagCardinality()` / `argCardinality()` pick the arm, `coerceCollection()` reads the source under
its own split policy and aggregates it, and `count` keeps its own arm because its diagnostics name a
count rather than a number. `coerceArgValue()` does the same through `argValueSchema()`, then
rewrites the message and details so a raw value from any non-CLI source never reaches a diagnostic.

`finishCliFlagValue()` / `finishCliArgValue()` finish a CLI-sourced collection: the parser leaves the
occurrences in the order they were typed, and each `-` occurrence is replaced by what the stdin
buffer decodes to under the input's stdin policy. `StageInput.finishCli` is where `cliStage()` calls
it, so a scalar is unaffected and a collection aggregates in one place.

`spliceCliCollection()` reads what the parse result carries through `liftOccurrences()` in
`parse/occurrences.ts`, so the splice, the `many` order, and the `entries` fold all consume one
`Occurrence[]`. A value the parser did not leave as a list is an aggregate a caller built by hand:
it lifts to a single `aggregated` occurrence and reaches the resolved value untouched.

Each spliced occurrence keeps the source it came from, `{ kind: 'cli' }` for a typed token and
`{ kind: 'stdin' }` for one the buffer supplied. `AggregationErrors` takes that source, so a
duplicate-key message names `from stdin` only for a key the pipe carried and names nothing for a key
the user typed. The same source decides how the key is quoted: `duplicateKeyReport()` prints it for
a typed token and `'<redacted>'` for every other source, since a key is half of a `KEY=VALUE` pair
and therefore value text. `foldEntries()` reports the index of the repeating pair, which is how the source is
found without re-parsing. A `-` occurrence with no buffer is `dash-without-stdin`: a `MISSING_STDIN`
error when it sits beside typed occurrences, and absence when every occurrence is `-`, which keeps
the later stages reachable. A scalar `-` takes the second branch on its own, which is why a bare
dash with nothing piped falls through to env rather than failing.

`valueCoercionError()` owns the flag-facing half. It turns a `ValueFailure` into the message, code,
details, and suggestion for one source. The value layer never spells a subject, so every
`--flag`-shaped string in the resolver comes from this file.

## ERROR AGGREGATION

`resolveFlags()` and `resolveArgs()` collect all errors into an array, then throw a single
aggregated `ValidationError` via `throwAggregatedErrors()`. Users see all validation messages at
once.

## TEST FILES (19, aspect-split)

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
| `resolve-cardinality.test.ts`     | Per-source aggregation matrix, splicing, element validation  |
| `resolve-arg-tail.test.ts`        | Positional tail splicing + which source a duplicate names    |
| `resolve-stdin-trim.test.ts`      | `.stdin({ trim: true })` across surfaces and entry points    |
| `resolve-hand-built.test.ts`      | The projection a caller-built `ParseResult` resolves through |
| `resolve-redaction.test.ts`       | Redaction per source, argv literal, `MISSING_STDIN`          |
| `contracts.test.ts`               | Contract verification                                        |

## PROMPT — INPUT KIND COMPATIBILITY

`COMPATIBLE_PROMPT_KINDS` in `flags.ts` maps each `FlagKind` to allowed `PromptKind[]`. Every
`ArgKind` is also a `FlagKind`, so `argPromptCompatibility()` in `args.ts` reads the same map,
through the cardinality: an arg whose `argCardinality()` is `many` takes the `array` row, since a
variadic positional and a `flag.array()` aggregate the same way, and names itself `variadic <kind>`
in the diagnostic. Every other arg takes its kind's row:

| Flag kind | Allowed prompt kinds                      |
| --------- | ----------------------------------------- |
| boolean   | confirm                                   |
| string    | input, select                             |
| number    | input                                     |
| enum      | select, input                             |
| array     | multiselect                               |
| keyValue  | (not promptable)                          |
| count     | (not promptable)                          |
| custom    | input, select, confirm, multiselect (all) |

`validatePromptFlagCompatibility()` checks this map before `prompter.promptOne()` runs. Mismatches
produce a `CONSTRAINT_VIOLATED` `ValidationError` with `details.flagKind` (`details.argKind` on the
positional surface), `details.promptKind`, and an actionable `suggest`. Both surfaces word it through
`promptCompatibilityError()`, which reports a kind with an empty allowed list as not promptable
rather than naming a first allowed kind there is none of. This mirrors the compile-time
`AllowedPromptConfig<C>` in `schema/flag.ts` and `AllowedArgPromptConfig<C>` in `schema/arg.ts`.

## GOTCHAS

- Split from ~940-line monolithic index — `coerce.ts` (1177 lines) is the largest piece
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
  and produces messages that differ only there. Path checks belong to the element, so `pathValuesOf()`
  in `path-checks.ts` walks an array's string elements and a record's string values; both surfaces
  use it.
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
