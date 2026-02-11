# schema — Command/Flag/Arg/Middleware builders + prompt config types

Only multi-file module in `core/`. All others use single `index.ts`.

## FILES

| File            | Lines | Purpose                                                                                                                             |
| --------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------- |
| `command.ts`    |   784 | `CommandBuilder<F, A, C>` — fluent builder + `Out` interface + command schema                                                       |
| `activity.ts`   |   150 | Activity types — `Fallback`, `SpinnerHandle`, `ProgressHandle`, `SpinnerOptions`, `ProgressOptions`, `ActivityEvent`, `TableColumn` |
| `flag.ts`       |   455 | `FlagBuilder` — `flag.string()`, `.boolean()`, `.number()`, `.count()`, `.enum()`, `.custom()`                                      |
| `arg.ts`        |   341 | `ArgBuilder` — `arg.string()`, `.number()`, `.enum()`                                                                               |
| `middleware.ts` |   164 | `middleware<Output>(handler)` factory — phantom-branded `Middleware<Output>` type                                                   |
| `prompt.ts`     |    70 | Prompt config types — `PromptConfig` discriminated union (4 kinds)                                                                  |
| `index.ts`      |    80 | Barrel — re-exports all public symbols                                                                                              |

## TYPE SYSTEM PATTERNS

- **`F` accumulator**: `{} & Record<name, InferFlag<...>>` grows per `.flag()` call
- **`A` accumulator**: same pattern for `.arg()`
- **`C` accumulator**: `Record<string, never>` replaced entirely on first `.middleware()`, then
  intersection-grown via `WidenContext<C, Output>`
- **`{}` as identity element**: `biome-ignore noBannedTypes` on `CommandBuilder` class generic
  defaults — justified, do not "fix"
- **Phantom brand**: `Middleware<Output>` carries type info at compile time, erased at runtime.
  `_output` property is phantom — compile-time only. Same for `_value` on FlagBuilder/ArgBuilder.
- **Type erasure**: `eraseBuilder()` / `eraseCommand()` centralize `as unknown as` casts for
  heterogeneous subcommand storage. These are the justified `as` cast sites.

## `command.ts` TYPE DENSITY

21+ type/interface exports split across `command.ts` and `activity.ts`:

- **Activity types** (`activity.ts`): `ActivityEvent` (10-variant DU), `SpinnerHandle`,
  `ProgressHandle`, `SpinnerOptions`, `ProgressOptions`, `Fallback`, `TableColumn`
- **Output interface** (`command.ts`): `Out` (~110 lines JSDoc + signatures) — imports activity
  types from `./activity.ts`
- **Command schema** (`command.ts`): `CommandSchema`, `ErasedCommand`, `ActionHandler`,
  `ActionParams`, `InteractiveResolver`, `CommandExample`, etc.

Activity types live in `activity.ts` (still in schema/, not in output/) because `Out` needs them in
`CommandBuilder.action()` signature. `command.ts` imports them from `./activity.ts`.

## ADDING A FLAG TYPE

1. Add variant to `FlagKind` union in `flag.ts`
2. Add factory method on `FlagBuilder`
3. Update `InferFlag` conditional type
4. Wire through `resolve/` (add coercion case in the unified `coerceValue()` function)
5. Add tests in `flag.test.ts` + `resolve.test.ts`

## GOTCHAS

- `.middleware()` drops current handler (type signature changes) — intentional, forces
  re-registration after middleware addition
- Prompt types consumed directly by `core/prompt/` and `core/resolve/` (bypasses barrel to avoid
  circular dep through `schema → prompt → schema` path)
- `deprecated()` modifier on both FlagBuilder and ArgBuilder — collects `DeprecationWarning` structs
  during resolution
- Prompt types in `prompt.ts` re-exported through `flag.ts`, not through `prompt.ts` in the barrel
