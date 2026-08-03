# schema — Command/Flag/Arg/Middleware builders + prompt config types

Multi-file module in `core/`. All others (except resolve, output, completion) use single `index.ts`.

## FILES

| File                    | Lines | Purpose                                                                                                                     |
| ----------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------- |
| `command.ts`            |  1900 | `CommandBuilder<F, A, C>` — fluent builder + `Out` interface + schema + `createCommandSchema()`                             |
| `flag.ts`               |  2077 | `FlagBuilder` — `flag.string/number/boolean/enum/array/custom/url/path/date/duration/bytes/count/keyValue()`                |
| `arg.ts`                |  1547 | `ArgBuilder` — `arg.string/number/boolean/enum/custom/url/path/date/duration/bytes/keyValue()`                              |
| `brand.ts`              |    19 | `schemaBrand` — type-only `unique symbol` sealing flag, arg, command, CLI, and config-settings schemas                      |
| `activity.ts`           |   240 | Activity types — `SpinnerHandle`, `ProgressHandle`, `ActivityEvent`, etc.                                                   |
| `middleware.ts`         |   171 | `middleware<Output>(handler)` factory — phantom-branded `Middleware<Output>`                                                |
| `prompt.ts`             |   171 | Prompt config types — `PromptConfig` discriminated union (4 kinds)                                                          |
| `stdin.ts`              |   134 | `StdinBinding` / `StdinOptions` — the stdin axis both factories carry, plus its normalizer                                  |
| `cardinality.ts`        |   674 | Internal cardinality axis: `Cardinality`, split policies, aggregation rules, declared-default validation                    |
| `source.ts`             |   235 | Internal source axis — `RESOLUTION_ORDER`, `sourceBindings()`, stdin eligibility and exclusivity helpers                    |
| `number-constraints.ts` |   153 | `NumberConstraints` + shared `validateNumberConstraints()` (parse & resolve both import it)                                 |
| `string-constraints.ts` |   172 | `StringConstraints` + shared `validateStringConstraints()` / `stringConstraintDetails()` (parse & resolve both import them) |
| `standard.ts`           |   143 | Vendored Standard Schema v1 types (no runtime dep) + `isStandardSchemaV1()` guard                                           |
| `value.ts`              |   731 | Internal value layer (`ValueSchema`, `ValueCodec`, `decodeValue()`, both schema projections)                                |
| `value-parsers.ts`      |   329 | Value machinery behind the sugar factories on both `flag` and `arg` — parsers, path option types, `buildPathChecks()`       |
| `run.ts`                |   241 | `RunOptions` / `RunResult` — execution options + structured result (re-exported by testkit)                                 |
| `index.ts`              |   157 | Barrel — re-exports all public symbols                                                                                      |

## TYPE SYSTEM PATTERNS

- **`F` accumulator**: `{} & Record<name, InferFlag<...>>` grows per `.flag()` call
- **`A` accumulator**: same pattern for `.arg()`
- **`C` accumulator**: `Record<string, never>` replaced entirely on first `.middleware()`, then
  intersection-grown via `WidenContext<C, Output>`
- **`{}` as identity element**: `biome-ignore noBannedTypes` on `CommandBuilder` class generic
  defaults — justified, do not "fix"
- **Phantom brand**: `Middleware<Output>` carries type info at compile time, erased at runtime.
  Same for `_value` on FlagBuilder/ArgBuilder.
- **`flagKind` phantom discriminator**: `FlagConfig.flagKind` mirrors `FlagSchema.kind` at the type
  level. Each factory (`flag.string()`, `.enum()`, etc.) sets a literal `flagKind` so that
  `AllowedPromptConfig<C>` can map each kind to its compatible prompt types via the
  `PromptConfigByFlagKind` indexed-access map. `WithPresence` propagates `flagKind` through
  `.required()` / `.default()` chains. Never read at runtime — phantom only.
- **Type erasure**: `eraseBuilder()` centralizes the `as unknown as` cast for heterogeneous
  subcommand storage in `_subcommands`. This is the justified `as` cast site.
- **Schema seal**: `FlagSchema`, `ArgSchema`, `CommandSchema`, `CLISchema`, and `ConfigSettings`
  carry `readonly [schemaBrand]` from `brand.ts` as their first member. The symbol is `declare`-only,
  so no runtime key exists and
  callers cannot spell it, which makes the factories the only construction path. `brand.ts` exports
  the symbol with `export type`, and every importer uses `import type` — a value import breaks the
  rolldown build with `MISSING_EXPORT`. `buildFlagSchema()`, `buildArgSchema()`, and
  `buildCommandSchema()` each carry one `as` cast at their return statement to attach the brand;
  these are the only casts in the three files.

## VALUE LAYER (`value.ts`)

`value.ts` is internal. It is not exported from `index.ts`, from `src/index.ts`, or from any public
subpath, and importers reach it by direct file import (`#internals/core/schema/value.ts`).

A `ValueSchema` holds `{ codec, constraints, standard, pathChecks, valueHint }`. The codec set is
`string`, `number`, `boolean`, `enum`, and `custom`; the sugar members (`url`, `path`, `date`,
`duration`, `bytes`) are a `custom` codec wrapping the matching function from `value-parsers.ts`
plus a `valueHint`, and `path` is the `string` codec plus `pathChecks`. `array`, `count`, and `keyValue` ride the same carrier through
their element value; the cardinality axis in `cardinality.ts` says how many of them there are.

Two directions, one function each way:

- `flagValueSchema(schema)` / `argValueSchema(schema)` read the flat schema fields onto a
  `ValueSchema`. Every parse and resolve site that decodes, coerces, or validates a value goes
  through these instead of reading `stringConstraints`, `numberConstraints`, `enumValues`,
  `parseFn`, `standard`, `pathChecks`, or `valueHint` off the schema.
- `valueDefinitionFields(value)` flattens a `ValueSchema` back into the definition fields the
  factories hand to `createFlagSchema()` / `createArgSchema()`. `enumValues` is absent from it,
  since both enum definitions declare that field as required and an all-optional record cannot
  satisfy it; `flag.enum()` and `arg.enum()` pass it directly.

`flagValueSchema()` is total. A collection projects onto the value of each ELEMENT (the element
schema's codec, constraints, validator, and checks; an implicit passthrough for `array` and a strict
string for `keyValue`), and what the completed collection must satisfy is read through
`flagAggregateStandard()` / `argAggregateStandard()`. That is what makes `flag.array(flag.path())`
check every element and `.standard()` mean element on an element builder and aggregate on a
collection builder.

`decodeValue(value, raw, input)` is the one decoding entry point. `input` is `'token'` for an argv
token and `'stdin'` / `'env'` / `'config'` / `'prompt'` for resolver stages, which is what lets one
boolean implementation accept `true`/`1`/`false`/`0` from argv and also `yes`/`no`/`''`/`y`/`n` from
the resolver. It runs the codec and then the constraints, and returns a `ValueFailure` describing the
value problem alone. Naming the subject (`flag --x` versus `argument <x>`) belongs to the caller:
`flagValueError()` / `argValueError()` in `parse/index.ts` and `valueCoercionError()` in
`resolve/coerce.ts`.

`'stdin'` accepts exactly what `'env'` accepts, and one trailing `\n`, `\r\n`, or `\r` is dropped
before every codec except `string`, whose value is the bytes themselves.

`validateDecodedValue(value, decoded)` checks a value that never came from a raw source against
the codec's own output domain and then the constraints. A declared default is already typed, so the
default-validation pass validates it here rather than adding a second dispatch over
`stringConstraints` / `numberConstraints`. The domain half is what rejects a `number` default on a
`string` flag and an `enum` default outside `enumValues`; a `custom` codec has no domain, since its
output is whatever its parse function returns.

The public field shape of `FlagSchema` and `ArgSchema` is unchanged. Both still carry the flat
fields, the definition document still serializes them, and `value.ts` is a view over them.

## CARDINALITY AXIS (`cardinality.ts`)

Internal, reached by direct file import. `Cardinality` is
`one | many { unique, splitting } | entries { duplicateKeys, splitting } | count`.
`flagCardinality(schema)` and `argCardinality(schema)` project either surface onto
it: `array` is `many`, `keyValue` is `entries` (variadic or not, on args), `count`
is its own arm, everything else is `one`. Parse and resolve dispatch on those
projections, which is why neither carries an unreachable-kind throw any more.

Splitting is per source. `SplitBinding` holds one `SplitPolicy` for CLI tokens,
one for env values, and one for the stdin buffer; the carriers are the existing
`separator` field (CLI delimiter) and the new `split` field (env and stdin), so
`.separator(',')` and `.split({ cli: ',' })` write the same place and cannot
drift. `ALLOWED_SPLIT_FORMATS` decides which formats a source accepts, and
`splitBindingOf()` fills the defaults: whole CLI tokens, comma-delimited env
values, line-delimited stdin. A config value is native; a config string decodes
under the env policy.

`splitLines()` owns the Decision 5 rule: a final terminator frames the last line,
so the one empty element it produces is removed and genuine blank lines survive.
`foldEntries()` owns the duplicate-key policy, and `dedupe()` the uniqueness rule;
both run wherever the collection completes, so every source obeys them.

`validateDefault(element, cardinality, aggregate, value)` is the declared-default
pass. A default is a typed value, so it is validated rather than decoded:
constraints through `validateDecodedValue()`, the shape the cardinality requires,
and any Standard Schema verdict available synchronously. A validator returning a
promise is left to the resolution-time pass, as are filesystem checks.
`assertValidFlagDefault()` / `assertValidArgDefault()` call it from the factories,
from `.default()`, and from every modifier that could invalidate an existing
default (`nextFlag()` / `nextArg()`), so the verdict does not depend on the order
the chain was written in.

## SOURCE AXIS (`source.ts`, `stdin.ts`)

Both internal. `stdin.ts` owns the stdin axis a flag or arg stores:
`StdinBinding = { when: 'dash' | 'missing' | 'dash-or-missing', consume: 'exclusive' | 'broadcast' }`,
normalized from the partial `StdinOptions` a caller writes. `stdinReadsOnDash()` and
`stdinReadsWhenMissing()` are the only two places that decide what a `when` means, so the parse
boundary, the preflight eligibility check, and the resolver cannot drift on it.

`source.ts` owns the rest of the axis:

- `RESOLUTION_ORDER` is the one ordered stage list, `cli -> stdin -> env -> config -> prompt -> default`.
- `sourceBindings(schema)` projects a flag or arg onto the `SourceBinding[]` it actually declares.
  `resolve/stages.ts` walks that list, so a binding the projection omits is a source no stage can
  produce, and a per-source setting has one place to live.
- `bindingsBeforePrompt()` / `bindingsFromPrompt()` split it for the flag resolver's two passes, and
  `withPromptBinding()` applies an `.interactive()` override to one invocation's list.
- `invocationSelectsStdin()` answers whether reading the stream is warranted at all; both
  `cli/runtime-preflight.ts` and `readFlags()` call it, so stdin is read at most once and only when a
  stage would select it. A collection's occurrences reach it as a list, so it looks for the `-`
  sentinel among them as well as for a lone `-`, which is what makes `--tag before --tag -` read the
  stream at all.
- `stdinConsumers()` and `stdinConsumerReference()` back the `DUPLICATE_STDIN_INPUT` rule in
  `command.ts`, which spans flags and args together.

## ADDING A FLAG TYPE

Two flavors. A **sugar factory** (like `flag.url/date/duration/bytes`) adds a value constructor in
`value.ts` that wraps a `parseFn` from `value-parsers.ts` and sets a `valueHint`, then calls it
through `valueDefinitionFields()` in both factories; only steps 3 and 10–11 apply. A **new kind**
(like `count` / `keyValue`) touches every exhaustive `switch (schema.kind)` in the codebase:

1. `flag.ts` — add to `FLAG_KINDS`, add a `PromptConfigByFlagKind` entry (`never` = not promptable),
   extend `FlagSchema` if the kind carries new data. A new `FlagSchema` field also needs a
   `buildFlagSchema()` default and a `NORMALIZED_FLAG_SCHEMA_KEYS` entry.
2. `flag.ts` — add a `<Kind>FlagDefinition` interface extending `FlagDefinitionBase`, register it in
   `FlagDefinitionByKind`, and add a `KIND_SPECIFIC_FLAG_FIELDS` row for each field the kind owns
   exclusively
3. `flag.ts` — add the factory to the `FlagFactory` interface **and** the `flag` object literal
   (duplicate signatures; keep both in sync)
4. `value.ts` — add a codec and value constructor when the kind carries a value, then add
   `flagValueSchema()` / `argValueSchema()` handling. Collection kinds project their element value.
5. `parse/index.ts` — `flagTokenOccurrence()` case for a collection kind, plus a `flagValueError()` /
   `argValueError()` arm for any new `ValueFailure`; update `flagExpectsValue()` if the kind takes
   no value token; `flagTokenOccurrences()` if one token carries several elements, and
   `projectOccurrences()` in `parse/occurrences.ts` if the kind folds its occurrences its own way
6. `resolve/coerce.ts` — `coerceValue()` case for a collection kind, plus a `valueCoercionError()`
   arm for any new `ValueFailure`
7. `resolve/flags.ts` — `COMPATIBLE_PROMPT_KINDS` entry; unset-fallback branch in `resolveFlags()`
   if the kind resolves to a value when absent (array → `[]`, keyValue → `{}`);
   `buildRequiredFlagSuggest()` if no value token
8. `help/index.ts` — `formatValueHint()` case; no-value handling in `formatFlagLeft()` /
   default-suppression in `formatFlagDescription()` if applicable
9. `json-schema/index.ts` — `flagToJsonSchemaType()` case + `kind` union in the meta-schema
   `flag` def (completions pick up no-value kinds automatically via `flagExpectsValue`)
10. Exports — new public types go in `core/schema/index.ts` **and** root `src/index.ts`
    (alphabetical)
11. Tests in this dir + `docs/guide/flags.md` + `CHANGELOG.md`

## ARG / FLAG PARITY

The value-level surface is shared. `arg.url/path/date/duration/bytes()` call the same value
constructors in `value.ts` as their flag counterparts, so both surfaces get the same codec, the same
`valueHint`, and the same `pathChecks`. String constraints use one `stringConstraints` field on both
schemas, one validator, and one error-detail fragment (`stringConstraintDetails()`), so a message
differs only in the subject (`for flag --x` versus `for argument <x>`). `factory-parity.test.ts`
asserts that at the message level and pins the two value projections against each other, and a new
value-level member belongs on both factories or on neither.

The one place the two projections differ is the `custom` parse function. A flag's takes `unknown`
and is called with the raw value; an arg's takes `string`, so `argValueSchema()` stringifies a
non-string raw before calling it. Both store the caller's function verbatim on the schema.

Flag-only by design: `count`, `negatable`, `alias`, `duplicates`, `propagate` (flag syntax), and
`array` (`.variadic()` serves it). Arg-only: `variadic` and required-by-default presence. `boolean`,
`keyValue`, `separator`, `unique`, `split`, `duplicateKeys`, and `standard` are on both surfaces.

The source axis is shared outright. `.stdin()`, `.env()`, `.config()`, `.prompt()`, and `.default()`
are on both builders, and `source.ts` projects either schema onto the same ordered `SourceBinding`
list. A new source belongs on both factories or on neither.

`ArgSchema.valueHint` is carried and serialized but not rendered: help labels a positional by its
own name, so `.arg('file', arg.path())` stays `<file>` rather than becoming `<path>`, which would
collapse two path args into the same placeholder.

## PROMPT — FLAG KIND CONSTRAINTS

`FlagBuilder.prompt()` signature is `prompt(config: AllowedPromptConfig<C>)` — a compile-time gate.
`AllowedPromptConfig<C>` indexes into `PromptConfigByFlagKind` using `C['flagKind']`:

- `boolean` → `ConfirmPromptConfig`
- `string` → `InputPromptConfig | SelectPromptConfig`
- `number` → `InputPromptConfig`
- `enum` → `SelectPromptConfig | InputPromptConfig`
- `array` → `MultiselectPromptConfig`
- `custom` → `PromptConfig` (all kinds — the `parseFn` is responsible for handling any prompt result)
- `count` / `keyValue` → `never` (not promptable; `.prompt()` uncallable at compile time)

Runtime enforcement lives in `resolve/flags.ts` (`COMPATIBLE_PROMPT_KINDS` + `validatePromptFlagCompatibility()`).

## GOTCHAS

- `.middleware()` drops current handler (type signature changes) — intentional, forces
  re-registration after middleware addition
- Prompt types consumed directly by `core/prompt/` and `core/resolve/` (bypasses barrel)
- `deprecated()` modifier on both FlagBuilder and ArgBuilder — collects `DeprecationWarning` structs
- Activity types live in `activity.ts` (not in output/) because `Out` needs them in
  `CommandBuilder.action()` signature
- `Out.setExitCode(code)` is part of the public action-handler output surface. It requests a
  success-path process exit code without error output; thrown errors still own failure exits.
- `command.ts` imports activity types from `./activity.ts` directly
- `validateCommandFlagTree()` has exactly three call sites: `createCommandSchema()`, once over the
  finished tree, and the builder's `.flag()` and `.command()`, incrementally. `buildCommandSchema()`
  recurses into itself, not into `createCommandSchema()`, so a nested definition is normalized once
  and validated once. Callers downstream of a factory (`readFlags()`, `createCLISchema()`) must not
  re-run it. It catches collisions between distinct record entries only; `.flag()` owns the
  same-name duplicate check, since a second write to one key overwrites rather than colliding.
- `assertUsableFlagKey()` / `assertUsableArgKey()` throw `INVALID_SCHEMA` on the name `__proto__`.
  Assigning that key on a plain object sets the prototype instead of an entry, so the flag would
  vanish from `CommandSchema.flags` and an arg's value would vanish from `mapPositionals()` in
  `parse/` and `resolveArgs()` in `resolve/`. Both run on the factory path and the builder path
  (`.flag()` directly, `.arg()` through `validateArgEntry()`), so the two agree.
- A name check alone does not cover flags. An object literal routes a bare `__proto__` key to the
  prototype setter, so `Object.entries()` never yields it and the flag is already gone.
  `assertUsableFlagRecord()` reads the flag record's own prototype instead; `Object.prototype` and
  `null` (an `Object.create(null)` record) pass, anything else throws. It raises its own error
  rather than reusing the name error, because a replaced prototype also covers
  `Object.create(base)`, where nothing is named `__proto__` and the inherited entries are the ones
  that would be lost. `readFlags()` carries its own copy of both checks, worded for a definitions
  record.
- `buildCommandSchema()` runs `validateArgEntry()` over the accumulating arg list and
  `validateFlagStdinEntry()` over each flag, so the stdin/variadic invariants `.arg()` and `.flag()`
  enforce also apply to a definition composed as data. Stdin exclusivity spans both surfaces, so
  each check sees the flags and args registered so far. It takes
  the command name and puts it in `details` on all three errors, since a definition tree reaches
  those throws at any depth and the arg name alone does not say which command declared it.
- Membership tests against a flag record use `Object.hasOwn()`, never `in`. `in` walks
  `Object.prototype`, so `.flag('constructor')` reported a collision with a flag that did not exist
  and `collectPropagatedFlags()` in `cli/propagate.ts` treated every subcommand as overriding a
  propagated flag named after a prototype member.
- Reads carry the same rule, and grepping for `in` does not find them. A bare `record[flagName]` on
  a caller-supplied record returns the inherited `Object.prototype` method for a flag named
  `toString`, which then reads as a supplied value. `resolveFlags()` in `resolve/` guards its `env`
  lookup and the interactive resolver's override record with `Object.hasOwn()` for that reason.

## TEST FILES (20)

| File                                | Tests                                                         |
| ----------------------------------- | ------------------------------------------------------------- |
| `command.test.ts`                   | CommandBuilder API, schema, type inference                    |
| `schema-sealing.test.ts`            | Brand seal, spread propagation, factory normalization         |
| `flag.test.ts`                      | FlagBuilder API, kinds, validation                            |
| `flag-array-separator.test.ts`      | `.separator()` / `.unique()` parse + resolve                  |
| `flag-count-keyvalue.test.ts`       | `flag.count()` / `flag.keyValue()` end to end                 |
| `flag-negatable-duplicates.test.ts` | `.negatable()` spellings + `.duplicates()` policy             |
| `flag-element-eligibility.test.ts`  | `flag.array()` element eligibility, type level                |
| `standard.test.ts`                  | Standard Schema v1 types + `isStandardSchemaV1()`             |
| `string-constraints.test.ts`        | String constraint validation + flag/arg builder chaining      |
| `value-parsers.test.ts`             | URL/date/duration/bytes parsers + sugar factories             |
| `value.test.ts`                     | Codecs, constraint routing, hint carriage, projections        |
| `cardinality.test.ts`               | Split policies, folding, projections, validated defaults      |
| `arg-collection-kinds.test.ts`      | `arg.boolean()` / `arg.keyValue()` e2e + `readFlags()` parity |
| `arg.test.ts`                       | ArgBuilder API, kinds, validation                             |
| `arg-value-factories.test.ts`       | `arg.url/path/date/duration/bytes()` + arg constraints        |
| `factory-parity.test.ts`            | Same value through `flag.*` and `arg.*`, same verdict         |
| `middleware.test.ts`                | Middleware factory, context typing                            |
| `prompt.test.ts`                    | Prompt config types                                           |
| `stdin-exclusivity.test.ts`         | One exclusive stdin consumer per command + `sourceBindings()` |
| `derive.test.ts`                    | Type derivation tests                                         |
