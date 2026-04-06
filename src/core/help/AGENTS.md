# help — Schema-driven help formatter

## OVERVIEW

Single-file formatter for usage, description, args, flags, and examples. It turns `CommandSchema`
into stable text output, with width-aware wrapping and metadata annotations.

## FILES

| File           | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `index.ts`     | `formatHelp()`, wrapping and padding helpers, arg/flag/example rendering |
| `help.test.ts` | formatting contract and regression coverage                              |

## WHERE TO LOOK

| Task                          | Location                                                            | Notes                                                      |
| ----------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Change width or bin defaults  | `HelpOptions`, `resolveOptions()`                                   | default width 80, optional bin name                        |
| Change flag table formatting  | `formatFlagLeft()`, `formatFlagDescription()`, `buildFlagEntries()` | aliases, env/config/prompt/default/deprecation annotations |
| Change usage or arg rendering | arg and usage helpers in `index.ts`                                 | positional syntax and defaults                             |
| Change text wrapping          | `wrapText()`                                                        | continuation indentation is part of the contract           |

## CONVENTIONS

- Help text is generated from schema metadata; keep formatting rules derived, not duplicated per
  caller
- Flags with short aliases sort before long-only flags, then alphabetically
- Boolean defaults stay implicit; non-boolean default values render explicitly
- Output should remain stable enough for explicit string assertions in tests

## ANTI-PATTERNS

- Do not pull TTY or color logic into help formatting; that belongs in output
- Do not special-case caller behavior when schema metadata already expresses it
- Do not simplify wrapping or padding without checking narrow alignment regressions in tests

## NOTES

- `formatDisplayValue()` from `output/` is the shared path for default-value rendering
- `isDefaultHelp` exists for merged root/default help flows from `cli/`
