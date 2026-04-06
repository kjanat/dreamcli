# parse — Tokenizer + schema-aware raw parser

## OVERVIEW

Single-file parser module. It tokenizes raw argv without schema knowledge, then parses against
`CommandSchema` into raw values for the resolve layer.

## FILES

| File            | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `index.ts`      | `tokenize()`, `parse()`, flag/arg coercion, lookup helpers |
| `parse.test.ts` | parser contract, edge cases, regressions                   |

## WHERE TO LOOK

| Task                             | Location                                | Notes                                                          |
| -------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| Change raw argv splitting        | `tokenize()`                            | `--`, `--flag=value`, grouped short flags, lone `-`            |
| Change alias or canonical lookup | `buildFlagLookup()`                     | names and aliases normalize to canonical keys                  |
| Change parse-time coercion       | `coerceFlagValue()`, `coerceArgValue()` | parse-time only, before resolve and defaults                   |
| Change main parse flow           | `parse()`                               | consumes tokens into raw flags and args or throws `ParseError` |

## CONVENTIONS

- Keep tokenizer schema-agnostic; resolve/default/env/config behavior belongs elsewhere
- Single `-` is a positional stdin sentinel, not a flag
- Boolean explicit values accept only `true`/`false` and `1`/`0`
- Parse errors use `ParseError` with structured codes and details, not ad hoc strings

## ANTI-PATTERNS

- Do not read env, config, prompts, or defaults here; that is `resolve/`
- Do not bypass canonical alias mapping when storing parsed flags
- Do not blur tokenization and parsing responsibilities to simplify a small change

## NOTES

- Custom flag parsers may throw; non-`ParseError` failures get wrapped with parse context
- This file is small in count, not in surface area. Respect the tests.
