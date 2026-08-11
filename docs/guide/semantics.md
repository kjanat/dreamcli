# CLI Semantics

This page is the canonical source of truth for dreamcli's edge-case behavior.
Use it when you need exact parser, resolver, or root-surface semantics rather than a feature
overview.

## Parser Rules

The tokenizer is schema-agnostic. It applies these rules before command-specific parsing starts:

| Raw argv form  | Meaning                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `--flag`       | long flag without an inline value                                           |
| `--flag=value` | long flag with an inline value                                              |
| `-abc`         | combined short flags                                                        |
| `--`           | end of options; everything after becomes positional                         |
| `-`            | stdin sentinel for an input declaring `.stdin()`, otherwise a plain positional |

Examples:

```text
deploy --region=eu prod
```

```json
["--region=eu", "prod"]
```

```text
deploy -- --region eu
```

After `--`, both `--region` and `eu` are treated as positional values.

## Flag Parsing

### Repeated flags

- Scalar flags overwrite earlier values. The last occurrence wins.
- Array flags accumulate in order.
- Key-value flags fold their occurrences into one record.
- Count flags total their occurrences.

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag.string(); // repeated -> last value wins
flag.number(); // repeated -> last value wins
flag.boolean(); // repeated -> true stays true unless an explicit false value is parsed
flag.array(flag.string()); // repeated -> accumulates
flag.keyValue(); // repeated -> folds into one record
flag.count(); // repeated -> totals
```

```bash
deploy --tag v1 --tag v2 --tag v3
```

Resolves to:

```json
{ "tag": ["v1", "v2", "v3"] }
```

### Boolean flags

- Bare boolean flags set the value to `true`.
- Long booleans also accept explicit inline values:
  - `--flag=true`
  - `--flag=false`
  - `--flag=1`
  - `--flag=0`
- Short booleans are presence-based. `-v` means `true`.

dreamcli does **not** implement special negated-boolean syntax automatically.
Call `.negatable()` on the boolean to accept `--no-confirm` alongside `--confirm`; see [Negatable Booleans](/guide/flags#negatable-booleans).

### Short-flag stacking

- Combined short booleans expand left to right: `-abc` means `-a -b -c`.
- If a short flag expects a value, it consumes either:
  - the rest of the current group, or
  - the next positional token if it is the last short flag in the group.

Examples:

```bash
-vo out.txt  # -> -v, then -o out.txt
-ofile.txt   # -> -o file.txt
-oVfile      # -> -o Vfile
```

Once a value-taking short flag consumes the remainder of the group, parsing of that group stops.

## Aggregation And Splitting

An input carries one value, an ordered list, a record of key-value entries, or
an occurrence count. Which of the four it is decides how every source fills it,
and it is decided separately from what each value means.

| Form      | Declared by                                   | Unset resolves to |
| --------- | --------------------------------------------- | ----------------- |
| one       | every scalar kind                             | `undefined`       |
| list      | `flag.array()`, `arg` with `.variadic()`      | `[]`              |
| entries   | `flag.keyValue()`, `arg.keyValue()`           | `{}`              |
| count     | `flag.count()`                                | `0`               |

### Per-source split policies

A source that carries text decodes it into elements under its own policy:

| Source | Accepts                                       | Default                      |
| ------ | --------------------------------------------- | ---------------------------- |
| cli    | a delimiter, `'whole'`                        | `'whole'`, or `.separator()` |
| env    | a delimiter, `'whole'`, `'json'`              | `','`                        |
| stdin  | a delimiter, `'whole'`, `'lines'`, `'json'`   | `'lines'`                    |
| config | a native array or object; a string uses `env` | native                       |

`.split({ cli, env, stdin })` sets them; a call names only the sources it
changes. `.separator()` writes the CLI policy on its own. A format a source does
not accept throws `INVALID_SCHEMA` where the input is declared. JSON is parsed
only where the policy says `'json'`, never guessed from the text.

Line splitting treats a final terminator as framing rather than a new element,
and accepts `\n`, `\r\n`, and `\r`: `'a\nb\n'` gives `['a', 'b']` and
`'a\nb\n\n'` gives `['a', 'b', '']`. Delimiter splitting drops empty segments.

### Aggregation rules

- A list applies `.unique()` after every source has resolved, in first-seen
  order with `SameValueZero` semantics.
- Entries split each segment at the **first** `=`, so `A=b=c` is
  `{ A: 'b=c' }`. A segment with no `=`, or an empty key, fails: `INVALID_VALUE`
  on a CLI token, `TYPE_MISMATCH` from every other source.
- Entries fold under `.duplicateKeys()`: `'last'` (the default), `'first'`, or
  `'error'`, which reports `CONSTRAINT_VIOLATED` naming the key and the source
  that carried it. The policy applies to every source, not only to repeated CLI
  occurrences.
- A count reads an explicit value (`--verbose=2`, env, config) as the count
  itself, and must be a non-negative integer.

Under `'error'`, each occurrence keeps its own source through aggregation, so a
collection filled from both the command line and a pipe names whichever one
carried the repeat. Tokens the user typed name no source:

```bash
$ mycli set --v A=1 --v A=2
Duplicate key 'A' for flag --v

$ printf 'A=2\n' | mycli set --v A=1 --v -
Duplicate key 'A' from stdin for flag --v

$ VARS='A=1,A=2' mycli set
Duplicate key 'A' from env VARS for flag --env
```

The argument surface words it the same way, with `for argument <vars>` in place
of `for flag --v`.

## Resolution Precedence

### Flags

Flags resolve in this order — the first source that provides a value wins:

```mermaid
flowchart LR
  CLI -->|miss| stdin -->|miss| env -->|miss| config -->|miss| prompt -->|miss| default
```

Example:

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag
  .enum(['us', 'eu', 'ap'])
  .stdin()
  .env('DEPLOY_REGION')
  .config('deploy.region')
  .prompt({ kind: 'select', message: 'Region?' })
  .default('us');
```

Outcomes:

| Available sources                                 | Result |
| ------------------------------------------------- | ------ |
| `--region ap`, env=`eu`, config=`us`, prompt=`eu` | `ap`   |
| piped stdin `eu`, env=`ap`                        | `eu`   |
| env=`eu`, config=`ap`, prompt=`us`                | `eu`   |
| config=`ap`, prompt=`us`                          | `ap`   |
| prompt=`eu`                                       | `eu`   |
| no value sources                                  | `us`   |

Notes:

- An optional flag that aggregates resolves to its empty form when no source
  provides a value: `[]` for an array, `{}` for a key-value flag, `0` for a
  count.
- Every other optional flag resolves to `undefined`.
- Required flags fail after the full chain is exhausted.

### Positional arguments

Positional arguments walk the same order as flags, and are CLI-only unless they
opt into extra sources. Only args that opt into `.stdin()`, `.env()`,
`.config()`, or `.prompt()` participate in those extra steps:

```mermaid
flowchart LR
  CLI["CLI token"] -->|miss| stdin -->|miss| env -->|miss| config -->|miss| prompt -->|miss| default
```

Example:

```ts twoslash
import { arg } from '@kjanat/dreamcli';

arg.string().stdin().env('DEPLOY_TARGET').config('deploy.target').default('local');
```

Outcomes:

| Available sources                      | Result    |
| -------------------------------------- | --------- |
| CLI token `prod`, stdin, env=`staging` | `prod`    |
| piped stdin `prod`, env=`staging`      | `prod`    |
| env=`staging`, config=`eu`             | `staging` |
| config=`eu`                            | `eu`      |
| no value sources                       | `local`   |

### Stdin

An input reads stdin only when it declares `.stdin()`. The binding has three
axes, `when`, `consume`, and `trim`, defaulting to `dash-or-missing`,
`exclusive`, and `false`.

| `when`              | `-` typed            | Input omitted        |
| ------------------- | -------------------- | -------------------- |
| `'dash'`            | reads stdin          | falls through to env |
| `'missing'`         | literal string `'-'` | reads stdin          |
| `'dash-or-missing'` | reads stdin          | reads stdin          |

A `-` that selects stdin resolves on the `cli` stage, so it outranks every later
source. An omitted input reads stdin only for `when: 'missing'` or
`when: 'dash-or-missing'`. With `when: 'dash'`, omission falls through to env,
config, prompt, and default. When nothing is piped, every stdin form produces no
value and the walk continues, except for a `-` typed beside other occurrences of
a collection, which fails instead.

The stream is read at most once per invocation, and only when a declared binding
would fire. Declaring a second exclusive stdin input on one command, flag or
argument, throws `DUPLICATE_STDIN_INPUT` at build time; every stdin input on a
command that passes `{ consume: 'broadcast' }` receives the same buffer.

For a scalar input, the whole buffer becomes the value. Codecs that preserve
text terminators keep it byte for byte; this includes strings and paths. Other
codecs drop one trailing `\n`, `\r\n`, or `\r` before decoding, then accept
exactly what an env value accepts. `{ trim: true }` drops that one terminator
for a preserving codec and is what a piped path wants before a `mustExist`
check runs.

For a collection, the buffer decodes into elements under the input's stdin
policy, `'lines'` by default. A `-` occurrence stands for the whole stdin source
at the position it holds, and the decoded elements are spliced in there. A
variadic argument reads its tail the same way:

```bash
$ printf 'a\nb\n' | mycli send --tag before --tag - --tag after
# flags.tag === ['before', 'a', 'b', 'after']

$ printf 'a\nb\n' | mycli build x - y
# args.files === ['x', 'a', 'b', 'y']
```

Splicing rules:

- A spliced read stays on the `cli` stage, so it outranks env, config, prompt,
  and the default exactly as a scalar `-` does.
- Entries splice into the same occurrence order and then fold under
  `.duplicateKeys()`, so a piped key can be overridden by a later CLI one.
- Two `-` occurrences splice the buffer twice. The buffer is read once and each
  occurrence stands for all of it, so `--tag - --tag -` over `'a\n'` resolves to
  `['a', 'a']` and `mycli build - -` over `'x\n'` to `['x', 'x']`.
- When every occurrence is `-` and nothing was piped, the input produces no CLI
  value, so env, config, prompt, and the default stay reachable.
- A `-` typed beside other occurrences with nothing piped fails with
  `REQUIRED_FLAG` or `REQUIRED_ARG`, rather than dropping the occurrence and
  silently shortening the collection.
- A scalar `-` with nothing piped falls through instead. It is the whole value,
  so dropping it loses nothing, and env, config, prompt, and the default stay
  reachable. Only a collection can be shortened, so only a collection can error.
- An input that declares no stdin binding treats `-` as an ordinary element and
  never reads the stream. An input that does declare one can never receive a
  literal `-` as a value, on either surface: the token names the source before
  anything reads it as text. `{ when: 'missing' }` is the one binding that
  leaves a typed `-` literal.

## Non-Interactive Behavior

Prompting is conditional, not mandatory.

- Prompts run only after CLI, stdin, env, and config resolution fail to provide a value.
- Prompts run only when a prompter is available.
- In normal CLI execution, auto-prompting is enabled only when `stdinIsTTY` is `true`.
- In non-interactive environments, prompt-backed values fall through to defaults or required-value
  errors.

Implications:

- CI, pipes, and redirected stdin do not trigger automatic prompts.
- Required prompt-backed flags still fail with a structured validation error when no other source
  resolves them.
- Prompt cancellation falls through to the default when one exists; otherwise required validation
  still applies.

## Propagation and Masking

Flags marked with `.propagate()` are inherited by descendant commands.

Important masking rules:

- Only ancestor flags marked `propagate: true` are inherited.
- A child command that defines the same flag name masks the ancestor's propagated flag.
- That masking applies even if the child flag does **not** propagate.
- Intermediate overrides block deeper descendants from receiving the ancestor definition.

Example shape:

```mermaid
flowchart TD
  root["root<br/>--verbose (propagate)"] -->|inherits| db["db<br/>--verbose (local, masks)"]
  db -->|blocked| migrate
```

`migrate` does not inherit root's propagated `--verbose`, because the intermediate `db` command
redefined the same flag name.

## Root and Default-Command Semantics

dreamcli distinguishes between executability and visibility.
Hidden commands stay executable, but they are omitted from root help and shell completions.

### Root help

- No default command: root usage shows `<command>`.
- Visible default command: root usage shows `[command]`.
- Single visible default command: root help merges the root summary with the default command's
  detailed help.
- Visible sibling commands: root help stays command-centric and lists commands instead of merging
  full default-command help.
- Hidden default command: still executable, but treated as invisible in root help.

Examples:

| Root shape                         | Help behavior                            |
| ---------------------------------- | ---------------------------------------- |
| default only, visible              | merged root + default help               |
| visible default + visible siblings | root command list                        |
| hidden default + visible sibling   | root command list without default        |
| no default                         | root command list with `<command>` usage |

### Root completions

Completion behavior depends on both the root shape and `rootMode`.

- `'subcommands'` is the default.
- `'surface'` additionally exposes the default command's root-usable flags at the CLI root.
- A single visible default command exposes its flags at the root even in `'subcommands'` mode.
- Hidden defaults are not surfaced through root completions.
- Root surface exposure includes the default command's own root-usable flags, not child-only flags
  from its subcommands.

Examples:

| Root shape                         | `rootMode`    | Root completion surface                            |
| ---------------------------------- | ------------- | -------------------------------------------------- |
| default `serve` + sibling `status` | `subcommands` | `serve`, `status`, root built-ins                  |
| default `serve` + sibling `status` | `surface`     | commands + root built-ins + `serve` root flags     |
| single visible default `serve`     | `subcommands` | command name + root built-ins + `serve` root flags |

### Command resolution with value-flags

When locating the command name in argv, dreamcli skips the token a space-separated value-flag
consumes, so that value is never mistaken for a command name. This is most visible with a default
command, where every token sits at the root level:

```bash
mycli --region status   # `status` is the value of --region (even if a command
                        # named `status` exists), so this runs the default command
mycli --region=status   # inline form, same result
mycli status            # a bare token dispatches the `status` command
```

The same applies one level down: `mycli db --tag x migrate` resolves `migrate`, not `x`. Boolean
flags take no value, so a following token is still treated as a command name. For example,
`mycli --verbose deploy` runs `deploy`. The `--` separator stops command-name scanning entirely;
everything after it is positional.

## Related Guides

- [Commands](/guide/commands)
- [Flags](/guide/flags)
- [Config Files](/guide/config)
- [Interactive Prompts](/guide/prompts)
- [Shell Completions](/guide/completions)
- [Semantic Delta Log](/reference/semantic-delta-log)
