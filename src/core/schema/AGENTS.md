# schema — Command/Flag/Arg/Middleware builders + prompt config types

Only multi-file module in `core/`. All others use single `index.ts`.

## FILES

| File            | Purpose                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `command.ts`    | `CommandBuilder<F, A, C>` — fluent builder, `.flag()` / `.arg()` / `.middleware()` / `.action()`                  |
| `flag.ts`       | `FlagBuilder` — `flag.string()`, `.boolean()`, `.number()`, `.count()`, `.enum()`, `.custom()` + `.prompt()`      |
| `arg.ts`        | `ArgBuilder` — `arg.string()`, `.number()`, `.enum()` + `.prompt()`                                               |
| `middleware.ts` | `middleware<Output>(handler)` factory — phantom-branded `Middleware<Output>` type                                 |
| `prompt.ts`     | Prompt config types — `InputPromptConfig`, `SelectPromptConfig`, `ConfirmPromptConfig`, `MultiselectPromptConfig` |
| `index.ts`      | Barrel — re-exports all public symbols                                                                            |

## TYPE SYSTEM PATTERNS

- **`F` accumulator**: `{} & Record<name, InferFlag<…>>` grows per `.flag()` call
- **`A` accumulator**: same pattern for `.arg()`
- **`C` accumulator**: `Record<string, never>` replaced entirely on first `.middleware()`, then
  intersection-grown via `WidenContext<C, Output>`
- **`{}` as identity element**: `biome-ignore noBannedTypes` on `CommandBuilder` class generic
  defaults — justified, do not "fix"
- **Phantom brand**: `Middleware<Output>` carries type info at compile time, erased at runtime.
  `_output` property is phantom — compile-time only. Same for `_value` on FlagBuilder/ArgBuilder.
- **Type erasure**: `eraseBuilder()` / `eraseCommand()` centralize `as unknown as` casts for
  heterogeneous subcommand storage. These are the justified `as` cast sites.

## ADDING A FLAG TYPE

1. Add variant to `FlagKind` union in `flag.ts`
2. Add factory method on `FlagBuilder`
3. Update `InferFlag` conditional type
4. Wire through `resolve/` (add resolution case)
5. Add tests in `flag.test.ts` + `resolve.test.ts`

## ACTIVITY TYPES (v0.8)

`command.ts` exports `ActivityEvent` (discriminated union), `SpinnerHandle`, `ProgressHandle`,
`SpinnerOptions`, `ProgressOptions` — consumed by `output/` for spinner/progress implementation.
These types live here (not in output) because `Out` interface is defined here.

## GOTCHAS

- `command.ts` (869 lines) — largest in module
- `.middleware()` drops current handler (type signature changes) — intentional, forces
  re-registration after middleware addition
- Prompt types consumed directly by `core/prompt/` and `core/resolve/` (bypasses barrel to avoid
  circular dep through `schema → prompt → schema` path)
- `deprecated()` modifier on both FlagBuilder and ArgBuilder — collects `DeprecationWarning` structs
  during resolution
