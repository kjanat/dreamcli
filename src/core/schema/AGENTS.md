# schema — Command/Flag/Arg/Middleware builders + prompt config types

Multi-file module in `core/`. All others (except resolve, output, completion) use single `index.ts`.

## FILES

| File            | Lines | Purpose                                                                                        |
| --------------- | ----: | ---------------------------------------------------------------------------------------------- |
| `command.ts`    |  1466 | `CommandBuilder<F, A, C>` — fluent builder + `Out` interface + schema                          |
| `flag.ts`       |   753 | `FlagBuilder` — `flag.string()`, `.boolean()`, `.number()`, `.count()`, `.enum()`, `.custom()` |
| `arg.ts`        |   713 | `ArgBuilder` — `arg.string()`, `.number()`, `.enum()`                                          |
| `activity.ts`   |   150 | Activity types — `SpinnerHandle`, `ProgressHandle`, `ActivityEvent`, etc.                      |
| `middleware.ts` |   164 | `middleware<Output>(handler)` factory — phantom-branded `Middleware<Output>`                   |
| `prompt.ts`     |    70 | Prompt config types — `PromptConfig` discriminated union (4 kinds)                             |
| `run.ts`        |    47 | `RunResult` — structured execution result (re-exported by testkit)                             |
| `index.ts`      |    80 | Barrel — re-exports all public symbols                                                         |

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
- **Type erasure**: `eraseBuilder()` / `eraseCommand()` centralize `as unknown as` casts for
  heterogeneous subcommand storage. These are the justified `as` cast sites.

## ADDING A FLAG TYPE

1. Add variant to `FlagKind` union in `flag.ts`
2. Add factory method on `FlagBuilder`
3. Update `InferFlag` conditional type
4. Wire through `resolve/coerce.ts` (add coercion case in unified `coerceValue()`)
5. Add tests in `flag.test.ts` + `resolve.test.ts`

## PROMPT — FLAG KIND CONSTRAINTS

`FlagBuilder.prompt()` signature is `prompt(config: AllowedPromptConfig<C>)` — a compile-time gate.
`AllowedPromptConfig<C>` indexes into `PromptConfigByFlagKind` using `C['flagKind']`:

- `boolean` → `ConfirmPromptConfig`
- `string` → `InputPromptConfig | SelectPromptConfig`
- `number` → `InputPromptConfig`
- `enum` → `SelectPromptConfig | InputPromptConfig`
- `array` → `MultiselectPromptConfig`
- `custom` → `PromptConfig` (all kinds — the `parseFn` is responsible for handling any prompt result)

Runtime enforcement lives in `resolve/flags.ts` (`COMPATIBLE_PROMPT_KINDS` + `validatePromptFlagCompatibility()`).

## GOTCHAS

- `.middleware()` drops current handler (type signature changes) — intentional, forces
  re-registration after middleware addition
- Prompt types consumed directly by `core/prompt/` and `core/resolve/` (bypasses barrel)
- `deprecated()` modifier on both FlagBuilder and ArgBuilder — collects `DeprecationWarning` structs
- Activity types live in `activity.ts` (not in output/) because `Out` needs them in
  `CommandBuilder.action()` signature
- `command.ts` imports activity types from `./activity.ts` directly

## TEST FILES (6)

| File                 | Tests                                      |
| -------------------- | ------------------------------------------ |
| `command.test.ts`    | CommandBuilder API, schema, type inference |
| `flag.test.ts`       | FlagBuilder API, kinds, validation         |
| `arg.test.ts`        | ArgBuilder API, kinds, validation          |
| `middleware.test.ts` | Middleware factory, context typing         |
| `prompt.test.ts`     | Prompt config types                        |
| `derive.test.ts`     | Type derivation tests                      |
