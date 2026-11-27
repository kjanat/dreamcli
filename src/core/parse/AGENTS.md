# parse: tokenizer and occurrence model

`tokenize()` is schema-agnostic. `parse()` reads tokens against `CommandSchema` and stops before env, config, prompts, and defaults.

## FILES

| File                 | Role                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `index.ts`           | `tokenize()`, `parse()`, `buildFlagLookup()`, `coerceFlagValue()` |
| `occurrences.ts`     | `Occurrence`, `projectOccurrences()`, `liftOccurrences()`         |
| `argv-boundaries.ts` | positions removed during preflight and dispatch                   |
| `context.ts`         | `ParseOccurrence` for inspection, before duplicate policy         |

## OCCURRENCES

One input's command line is an ordered `Occurrence[]`: a decoded value, an entry pair, a `-` stdin sentinel, a negated spelling, a count increment, or a caller-supplied aggregate. Nothing folds while argv is read.

`projectOccurrences()` is what `ParseResult` shows: last scalar, folded count, ordered collection. `resolve/coerce.ts` calls `liftOccurrences()` so a hand-built `ParseResult` and a parsed one share that list.

`argv-boundaries.ts` keeps WeakMaps of stripped tokens, hyphen operands, and original indexes. Root flag scans and completion consult it.

## ANTI-PATTERNS

- Do not read env, config, prompts, or defaults here
- Do not store a flag under the spelling the user typed. Store the canonical name
- Do not fold an occurrence list outside `projectOccurrences()` and the resolver

## NOTES

- A lone `-` is a positional stdin sentinel
- Boolean tokens accept `true`, `false`, `1`, and `0`
- A custom parser throw that is not a `ParseError` is wrapped with the typed spelling
- `coerceFlagValue()` stays exported for `cli/root-output-flags.ts`
