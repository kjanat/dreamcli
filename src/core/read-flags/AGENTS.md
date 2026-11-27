# read-flags: readFlags()

`readFlags()` runs a record of `FlagBuilder`s through the same schema, parser, coercion, and resolver a command uses. It returns `InferFlags`. There is no subcommand dispatch.

Parse and resolve failures throw `ParseError` and `ValidationError`. With the built-in help token still owned by the root, `--help`, `-h`, and `--help=all` before `--` print help and exit 0.

## ANTI-PATTERNS

- Do not grow a command runner here. Command execution belongs in `cli/` and `execution/`
- Do not skip `assertUsableFlagKey()` or the prototype check. A definitions record can hide `__proto__` the same way a command flag record can
- Do not reimplement stdin selection. Call `invocationSelectsStdin()` from `schema/source.ts`

## NOTES

- Tests cover parity with command flags, stdin, and the inferred type
- Help formatting calls `formatHelp()` from `help/`
