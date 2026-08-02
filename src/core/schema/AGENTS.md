# schema — Command/Flag/Arg/Middleware builders + prompt config types

Multi-file module in `core/`. All others (except resolve, output, completion) use single `index.ts`.

## FILES

| File                    | Lines | Purpose                                                                                                       |
| ----------------------- | ----: | ------------------------------------------------------------------------------------------------------------- |
| `command.ts`            |  1828 | `CommandBuilder<F, A, C>` — fluent builder + `Out` interface + schema + `createCommandSchema()`               |
| `flag.ts`               |  2073 | `FlagBuilder` — `flag.string/number/boolean/enum/array/custom/url/path/date/duration/bytes/count/keyValue()`  |
| `arg.ts`                |  1102 | `ArgBuilder` — `arg.string()`, `.number()`, `.enum()`                                                         |
| `brand.ts`              |    19 | `schemaBrand` — type-only `unique symbol` sealing flag, arg, command, CLI, and config-settings schemas        |
| `activity.ts`           |   240 | Activity types — `SpinnerHandle`, `ProgressHandle`, `ActivityEvent`, etc.                                     |
| `middleware.ts`         |   171 | `middleware<Output>(handler)` factory — phantom-branded `Middleware<Output>`                                  |
| `prompt.ts`             |   171 | Prompt config types — `PromptConfig` discriminated union (4 kinds)                                            |
| `number-constraints.ts` |   153 | `NumberConstraints` + shared `validateNumberConstraints()` (parse & resolve both import it)                   |
| `string-constraints.ts` |   147 | `StringConstraints` + shared `validateStringConstraints()` (parse & resolve both import it)                   |
| `standard.ts`           |   143 | Vendored Standard Schema v1 types (no runtime dep) + `isStandardSchemaV1()` guard                             |
| `value-parsers.ts`      |   243 | Parse fns behind sugar factories — `parseUrlValue`, `parseDateValue`, `parseDurationValue`, `parseBytesValue` |
| `run.ts`                |   240 | `RunOptions` / `RunResult` — execution options + structured result (re-exported by testkit)                   |
| `index.ts`              |   148 | Barrel — re-exports all public symbols                                                                        |

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

## ADDING A FLAG TYPE

Two flavors. A **sugar factory** (like `flag.url/date/duration/bytes`) reuses `kind: 'custom'` with
a `parseFn` from `value-parsers.ts` + a `valueHint` — only steps 3 and 10–11 apply. A **new kind**
(like `count` / `keyValue`) touches every exhaustive `switch (schema.kind)` in the codebase:

1. `flag.ts` — add to `FLAG_KINDS`, add a `PromptConfigByFlagKind` entry (`never` = not promptable),
   extend `FlagSchema` if the kind carries new data. A new `FlagSchema` field also needs a
   `buildFlagSchema()` default and a `NORMALIZED_FLAG_SCHEMA_KEYS` entry.
2. `flag.ts` — add a `<Kind>FlagDefinition` interface extending `FlagDefinitionBase`, register it in
   `FlagDefinitionByKind`, and add a `KIND_SPECIFIC_FLAG_FIELDS` row for each field the kind owns
   exclusively
3. `flag.ts` — add the factory to the `FlagFactory` interface **and** the `flag` object literal
   (duplicate signatures; keep both in sync)
4. `parse/index.ts` — `coerceFlagValue()` case; update `flagExpectsValue()` if the kind takes no
   value token; `setFlagValue()` if occurrences accumulate (array/keyValue style)
5. `resolve/coerce.ts` — `coerceValue()` case (env/config/prompt sources)
6. `resolve/property.ts` — `toSharedFlagPropertySchema()` switch arm
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
- `buildCommandSchema()` runs `validateArgEntry()` over the accumulating arg list, so the
  stdin/variadic invariants `.arg()` enforces also apply to a definition composed as data. It takes
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

## TEST FILES (14)

| File                                | Tests                                                 |
| ----------------------------------- | ----------------------------------------------------- |
| `command.test.ts`                   | CommandBuilder API, schema, type inference            |
| `schema-sealing.test.ts`            | Brand seal, spread propagation, factory normalization |
| `flag.test.ts`                      | FlagBuilder API, kinds, validation                    |
| `flag-array-separator.test.ts`      | `.separator()` / `.unique()` parse + resolve          |
| `flag-count-keyvalue.test.ts`       | `flag.count()` / `flag.keyValue()` end to end         |
| `flag-negatable-duplicates.test.ts` | `.negatable()` spellings + `.duplicates()` policy     |
| `flag-element-eligibility.test.ts`  | `flag.array()` element eligibility, type level        |
| `standard.test.ts`                  | Standard Schema v1 types + `isStandardSchemaV1()`     |
| `string-constraints.test.ts`        | String constraint validation + builder chaining       |
| `value-parsers.test.ts`             | URL/date/duration/bytes parsers + sugar factories     |
| `arg.test.ts`                       | ArgBuilder API, kinds, validation                     |
| `middleware.test.ts`                | Middleware factory, context typing                    |
| `prompt.test.ts`                    | Prompt config types                                   |
| `derive.test.ts`                    | Type derivation tests                                 |
