# schema — Command/Flag/Arg/Middleware builders + prompt config types

Only multi-file module in the codebase. All others use single `index.ts`.

## FILES

| File            | Purpose                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `command.ts`    | `CommandBuilder<F, A, C>` — fluent builder, `.flag()` / `.arg()` / `.middleware()` / `.action()`                  |
| `flag.ts`       | `FlagBuilder` — `flag.string()`, `.boolean()`, `.number()`, `.count()`, `.enum()` + `.prompt()`                   |
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
  `_output` property is phantom — compile-time only.

## ADDING A FLAG TYPE

1. Add variant to `FlagKind` union in `flag.ts`
2. Add factory method on `FlagBuilder`
3. Update `InferFlag` conditional type
4. Wire through `resolve/` (add resolution case)
5. Add tests in `flag.test.ts` + `resolve.test.ts`

## GOTCHAS

- `command.ts` — largest in module, approaching split threshold
- `.middleware()` drops current handler (type signature changes) — intentional, forces
  re-registration
- Prompt types consumed directly by `core/prompt/` (bypasses barrel to avoid circular dep)
