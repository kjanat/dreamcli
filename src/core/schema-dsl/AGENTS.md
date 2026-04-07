# schema-dsl — String-literal schema definitions with compile-time type inference

Enables defining commands from string-literal flag/arg specifications with full TypeScript inference.
Separate from `schema/` because it layers on top — consumers define schemas as strings, this module
parses them into typed `CommandBuilder` instances at compile time and runtime.

## FILES

| File                 | Lines | Purpose                                                           |
| -------------------- | ----: | ----------------------------------------------------------------- |
| `index.ts`           |   109 | Barrel — public API + `define()` factory function                 |
| `parse.ts`           |   241 | Compile-time string literal type parsing (template literal types) |
| `runtime.ts`         |   574 | Runtime parser — string -> FlagBuilder/ArgBuilder construction    |
| `to-json-schema.ts`  |    99 | DSL definition -> JSON Schema conversion                          |
| `schema-dsl.test.ts` |   373 | Tests for both compile-time and runtime parsing                   |

## ARCHITECTURE

Two parallel paths from the same string input:

1. **Compile-time**: `parse.ts` uses template literal types to extract flag names, types, and
   optionality from string definitions -> full type inference in `.action()` handler
2. **Runtime**: `runtime.ts` parses the same strings into `FlagBuilder`/`ArgBuilder` calls ->
   produces real `CommandBuilder` instance

Both paths must agree — a string that type-checks must also produce the correct runtime behavior.

## GOTCHAS

- `runtime.ts` (574 lines) is the largest file — contains the full runtime string parser
- Template literal type parsing in `parse.ts` is pure type-level code (zero runtime)
- `to-json-schema.ts` bridges DSL definitions to the `json-schema/` module
- Imports from `schema/` (flag, arg, command builders) — not circular because schema-dsl depends on
  schema, not vice versa
