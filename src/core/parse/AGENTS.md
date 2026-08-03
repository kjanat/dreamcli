# parse — Tokenizer + schema-aware raw parser

## OVERVIEW

Two source files. `index.ts` tokenizes raw argv without schema knowledge, then parses against
`CommandSchema` into raw values for the resolve layer. `occurrences.ts` holds the representation
those two phases meet in.

## FILES

| File                        | Lines | Purpose                                                         |
| --------------------------- | ----: | --------------------------------------------------------------- |
| `index.ts`                  |  1286 | `tokenize()`, `parse()`, flag/arg token reading, lookup helpers |
| `occurrences.ts`            |   186 | `Occurrence`, `projectOccurrences()`, `liftOccurrences()`       |
| `parse.test.ts`             |  1045 | parser contract, edge cases, regressions                        |
| `parse-case-parity.test.ts` |   118 | kebab↔camel counterpart spellings                               |
| `occurrences.test.ts`       |   198 | the representation: projection, lifting, entry pairs            |

## OCCURRENCE MODEL

One input's command-line occurrences are one ordered `Occurrence[]`: a decoded `value`, a decoded
`entry` pair, the position a `-` `stdin` sentinel holds, a `negated` spelling, one count
`increment`, or an `aggregated` value a caller supplied ready-made. Nothing folds while argv is
being read.

`parse()` accumulates `Map<canonical name, FlagOccurrences>`, where each `FlagOccurrence` carries
what the duplicate policy reports for it and the items it contributes. `projectOccurrences()` then
turns each list into what `ParseResult` carries: the last occurrence for a scalar, the folded total
for a count, the ordered elements for a collection. `resolve/coerce.ts` calls `liftOccurrences()` to
read such a value back as occurrences, so a caller-built `ParseResult` and a parsed one aggregate
through one list.

## WHERE TO LOOK

| Task                             | Location                                        | Notes                                                            |
| -------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Change raw argv splitting        | `tokenize()`                                    | `--`, `--flag=value`, grouped short flags, lone `-`              |
| Change alias or canonical lookup | `buildFlagLookup()`                             | names and aliases normalize to canonical keys                    |
| Change parse-time coercion       | `flagTokenOccurrence()`, `argTokenOccurrence()` | parse-time only, before resolve and defaults                     |
| Change duplicate policy          | `recordFlagOccurrence()`                        | governs supplied values; count increments stay outside it        |
| Change what a parse result shows | `projectOccurrences()` in `occurrences.ts`      | the public projection of an occurrence list                      |
| Change main parse flow           | `parse()`                                       | consumes tokens into occurrences and args or throws `ParseError` |

## CONVENTIONS

- Keep tokenizer schema-agnostic; resolve/default/env/config behavior belongs elsewhere
- Single `-` is a positional stdin sentinel, not a flag
- Boolean explicit values accept only `true`/`false` and `1`/`0`
- Parse errors use `ParseError` with structured codes and details, not ad hoc strings
- A token is decoded where it is read, so an error names the spelling the user typed

## ANTI-PATTERNS

- Do not read env, config, prompts, or defaults here; that is `resolve/`
- Do not bypass canonical alias mapping when storing parsed flags
- Do not blur tokenization and parsing responsibilities to simplify a small change
- Do not fold an occurrence list anywhere but `projectOccurrences()` and the resolver

## NOTES

- Custom flag parsers may throw; non-`ParseError` failures get wrapped with parse context
- `coerceFlagValue()` stays exported for `cli/root-output-flags.ts`; it is one token read through
  `flagTokenOccurrence()`
- This module is small in count, not in surface area. Respect the tests.
