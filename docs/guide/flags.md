# Flags

Flags are the richest primitive in `dreamcli`.
Each flag declaration configures parsing, type inference, resolution, help text, and shell completions.

## Flag Types

### String

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const stringFlag = flag.string();

declare const flagTypes: {
  string: InferFlag<typeof stringFlag>;
};
// ---cut---
flagTypes.string;
//          ^?
```

#### String constraints

`flag.string()` accepts optional string constraints, either as an options
object or via chained methods (they compose — a later chained call overrides an
earlier value, including one set in the options object):

```ts
flag.string({ nonEmpty: true, pattern: /^ghp_/ });
flag.string().nonEmpty().pattern(/^ghp_/); // equivalent
flag.string().minLength(3).maxLength(64);
```

| Option      | Meaning                                     | Default |
| ----------- | ------------------------------------------- | ------- |
| `nonEmpty`  | Reject the empty string `''`                | `false` |
| `minLength` | Inclusive minimum length (UTF-16 units)     | none    |
| `maxLength` | Inclusive maximum length (UTF-16 units)     | none    |
| `pattern`   | RegExp the value must match                 | none    |

Constraints are checked in order **nonEmpty → minLength → maxLength →
pattern** and apply to every source — CLI, env, config, and prompt. On the
first failure, CLI parsing throws `INVALID_VALUE` while env/config/prompt
resolution reports `CONSTRAINT_VIOLATED` (both exit code `2`). Anchor patterns
with `^`/`$` for full-string matching; length bounds must be non-negative
integers and `minLength` must not exceed `maxLength` (violations throw where
the flag is declared). String constraints are surfaced in the exported JSON
Schema as `minLength` / `maxLength` / `pattern`.

The same options and methods are available on
[`arg.string()`](/guide/arguments#string-constraints) for positional arguments.

### Number

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const numberFlag = flag.number();

declare const flagTypes: {
  number: InferFlag<typeof numberFlag>;
};
// ---cut---
flagTypes.number;
//         ^?
```

#### Numeric constraints

`flag.number()` accepts optional numeric constraints, either as an options
object or via chained methods (they compose — a later chained call overrides an
earlier value, including one set in the options object):

```ts
flag.number({ min: 0, max: 100, int: true });
flag.number().int().min(0).max(100); // equivalent
flag.number({ min: 0 }).max(100); // composes to { min: 0, max: 100 }
```

| Option   | Meaning                         | Default |
| -------- | ------------------------------- | ------- |
| `min`    | Inclusive lower bound           | none    |
| `max`    | Inclusive upper bound           | none    |
| `int`    | Require an integer              | `false` |
| `finite` | Reject `Infinity` / `-Infinity` | `true`  |

The resolved value type stays `number` — constraints are enforced at runtime
and surfaced in the exported JSON Schema (`minimum` / `maximum`, and
`type: "integer"` when `int` is set), not at the type level. `min` / `max` must
be finite; passing `Infinity` / `-Infinity` / `NaN` as a bound throws when the
flag is declared (omit the field for "no bound").

::: warning Finite by default
`flag.number()` now **rejects `Infinity` and `-Infinity`** (as well as `NaN`,
which was always rejected). Pass `finite: false` (or `.finite(false)`) to accept
non-finite values.
:::

Constraints are checked in order **finite → int → min → max**, and apply to
every source — CLI, env, config, and prompt. On the first failure, CLI parsing
throws `INVALID_VALUE` while env/config/prompt resolution reports
`CONSTRAINT_VIOLATED` (both exit code `2`):

| Input (`flag.number({ int: true, min: 0, max: 100 })`) | Result                               |
| ------------------------------------------------------ | ------------------------------------ |
| `42`                                                   | accepted                             |
| `0` / `100`                                            | accepted (bounds are inclusive)      |
| `NaN`                                                  | rejected — invalid number            |
| `Infinity`                                             | rejected — `must be a finite number` |
| `3.7`                                                  | rejected — `must be an integer`      |
| `-1`                                                   | rejected — `must be >= 0`            |
| `101`                                                  | rejected — `must be <= 100`          |

The same options and methods are available on `arg.number()` for positional
arguments.

### Boolean

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const booleanFlag = flag.boolean();

declare const flagTypes: {
  boolean: InferFlag<typeof booleanFlag>;
};
// ---cut---
flagTypes.boolean;
//         ^?
```

### Enum

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const enumFlag = flag.enum(['us', 'eu', 'ap']);

declare const flagTypes: {
  enum: InferFlag<typeof enumFlag>;
};
// ---cut---
flagTypes.enum;
//         ^?
```

### Array

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const arrayFlag = flag.array(flag.string());

declare const flagTypes: {
  array: InferFlag<typeof arrayFlag>;
};
// ---cut---
flagTypes.array;
//         ^?
```

Optional array flags resolve to `[]` when no source or default provides a value.
Required array flags fail when no value resolves.

The element builder describes the *value shape only*: kinds and their value
constraints (`flag.number({ int: true, min: 0 })`, `.nonEmpty()`, `.pattern()`,
enum values, custom `parseFn`). Flag-level settings such as `.alias()`,
`.env()`, `.default()`, `.prompt()`, and `.describe()` belong on the array
itself and are a **compile error** in element position, since an element schema
would silently ignore them:

```ts
flag.array(flag.number({ min: 1 })).env('PORTS').describe('Ports'); // ✓
// flag.array(flag.number().env('PORTS'))  ✗ compile error: env the array, not the element
```

`flag.string()`, `flag.number()`, `flag.boolean()`, `flag.enum()`,
`flag.custom()`, `flag.path()`, `flag.url()`, `flag.date()`, `flag.duration()`,
and `flag.bytes()` are element-eligible. `flag.count()`, `flag.keyValue()`, and
a nested `flag.array()` are rejected in element position, also at compile time.

### Collections

`flag.array()` and `flag.keyValue()` are the two collection kinds. Both are
decided along the same axis: how many values the flag carries and how they
combine. An array carries an ordered list, a key-value flag carries a record of
entries, and both fill from every source the flag declares under one set of
rules. `flag.count()` sits on the same axis, carrying an occurrence count rather
than values.

The sections below apply to `flag.array()` and `flag.keyValue()` alike.

#### How each source spells a collection

Each source decodes the text it carries under its own policy. `.split()` sets
all three at once, and `.separator()` sets the CLI one on its own:

```ts
flag.array(flag.string()).split({ cli: ',', env: { format: 'json' }, stdin: 'lines' });
// --tag a,b            →  ['a', 'b']
// TAGS='["a","b"]'     →  ['a', 'b']
// printf 'a\nb\n' | …  →  ['a', 'b']
```

| Source | Accepts                                       | Default                      |
| ------ | --------------------------------------------- | ---------------------------- |
| cli    | a delimiter, `'whole'`                        | `'whole'`, or `.separator()` |
| env    | a delimiter, `'whole'`, `'json'`              | `','`                        |
| stdin  | a delimiter, `'whole'`, `'lines'`, `'json'`   | `'lines'`                    |
| config | a native array or object; a string uses `env` | native                       |

The strings `'whole'`, `'lines'`, and `'json'` name their format. Every other
string is the delimiter to split on, so `.split({ env: ';' })` splits env values
on a semicolon. `{ format: 'json' }` and the bare `'json'` mean the same thing.
A format a source does not accept throws `INVALID_SCHEMA` where the flag is
declared, so `.split({ cli: 'json' })` is rejected at build time.

Each `.split()` call sets only the sources it names, so
`.split({ env: ';' }).split({ stdin: 'json' })` keeps both.

JSON is never guessed. An env value parses as JSON only when the binding says
so, which is why `TAGS='["a","b"]'` under the default comma policy resolves to
the two literal segments `['["a"', '"b"]']`.

#### Per-occurrence splitting on the command line

By default each occurrence of a collection flag contributes exactly one element
(`--tag a --tag b`). With a CLI delimiter, each occurrence is also split, so
comma-separated input works alongside repetition. Each element is coerced on its
own, so a failure names the offending element rather than the whole token:

```ts
flag.array(flag.enum(['us', 'eu', 'ap'])).separator(',').unique();
// --region us,eu --region eu  →  ['us', 'eu']
// --region us,mars            →  Invalid value 'mars' for flag --region. Allowed: us, eu, ap
```

`.separator(',')` and `.split({ cli: ',' })` write the same field, so pick
either. `.unique()` deduplicates the final resolved array in first-seen order
with `Set` semantics, whichever source produced the values. It is available on
`flag.array()` only.

::: warning A CLI separator is no longer inherited
Through 3.x, `.separator('|')` also decided how an env or config string
decoded. Each source now carries its own policy. Write
`.split({ cli: '|', env: '|' })` where the old coupling was intended.
:::

#### Reading a collection from stdin

`.stdin()` is available on both collection kinds. A `-` occurrence stands for
the whole stdin source at the position it holds, and what the buffer decodes to
under the stdin policy is spliced in there:

```ts
flag.array(flag.string()).stdin();
```

```bash
$ printf 'a\nb\n' | mycli send --tag before --tag - --tag after
# flags.tag === ['before', 'a', 'b', 'after']

$ printf 'a\nb\n' | mycli send --tag - --tag z
# flags.tag === ['a', 'b', 'z']

$ mycli send --tag -
# nothing piped: the flag produces no CLI value and env, config, prompt,
# and the default stay reachable, so an undeclared source leaves []

$ mycli send --tag a --tag -
# nothing piped beside a typed occurrence:
# No piped stdin for the '-' occurrence of flag --tag
```

A `-` the user typed beside other occurrences fails when nothing was piped,
rather than shortening the collection behind their back. Occurrences of nothing
but `-` are the whole value, so they fall through to the later sources the way
an absent flag does.

A flag that declares no stdin binding treats `-` as an ordinary element, and the
stream is never read:

```bash
$ printf 'piped' | mycli send --tag - --tag x   # flag.array(flag.string())
# flags.tag === ['-', 'x']
```

An explicit `-` and the implicit fallback decode identically. A spliced read is
CLI-sourced, so it still outranks env, config, prompt, and the default. Two `-`
occurrences splice the buffer twice, since the whole buffer is what each one
stands for: `--tag - --tag -` over `'a\n'` resolves to `['a', 'a']`.

A binding where `-` selects stdin never receives that token as a literal value,
on either surface. The token names the source before anything reads it as text.
A binding with `{ when: 'missing' }` remains stdin-enabled but leaves `-`
literal.

Broadcast consumers each decode the one shared buffer under their own binding,
so a line-split array flag and a JSON key-value flag can read the same pipe:

```ts
command('run')
  .flag('tag', flag.array(flag.string()).stdin({ consume: 'broadcast' }))
  .flag('vars', flag.keyValue().split({ stdin: 'json' }).stdin({ consume: 'broadcast' }));
// echo '{"A":"1"}' | mycli run
//   →  flags.tag === ['{"A":"1"}'], flags.vars === { A: '1' }
```

#### Key-value flags

`flag.keyValue()` merges `KEY=VALUE` occurrences into a record, splitting each
at the **first** `=`, so `--env A=b=c` yields `{ A: 'b=c' }`. Optional key-value
flags resolve to `{}` when no source or default provides a value; required flags
fail when no value resolves. An element builder gives each entry value its own
codec and checks:

```ts
flag.keyValue(flag.path({ mustExist: true }));
// --v src=/etc/hosts  →  every entry value is checked on disk
```

`.duplicateKeys()` decides what a repeated key means, on every source rather
than only across repeated CLI occurrences:

| Policy    | Meaning                                     |
| --------- | ------------------------------------------- |
| `'last'`  | the later occurrence wins (the default)     |
| `'first'` | the earlier occurrence wins                 |
| `'error'` | a repeat fails with `CONSTRAINT_VIOLATED`   |

```ts
flag.keyValue().duplicateKeys('first').alias('e').env('VARS');
// -e A=1 -e A=2      →  { A: '1' }
// VARS='A=1,A=2'     →  { A: '1' }
```

Under `'error'`, the message names the key and the source that carried it:
`Duplicate key 'A' from env VARS for flag --env` for the environment, and
`Duplicate key 'A' for flag --v` for occurrences the user typed, which name no
source. A key spliced in from a pipe reads `from stdin`. A JSON object cannot
preserve repeated member names through decoding, so `.duplicateKeys()` cannot
reliably detect them for `.split({ env: 'json' })`.

### Custom

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const customFlag = flag.custom((v) => new URL(String(v)));

declare const flagTypes: {
  custom: InferFlag<typeof customFlag>;
};
// ---cut---
flagTypes.custom;
//         ^?
```

### URL

Parses into a `URL`; invalid URLs are rejected with the flag named in the
error. Optionally restrict protocols:

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const urlFlag = flag.url({ protocols: ['https'] });

declare const flagTypes: {
  url: InferFlag<typeof urlFlag>;
};
// ---cut---
flagTypes.url;
//        ^?
```

### Path

The value stays a `string` (help shows `<path>`), with optional filesystem
checks that run **after resolution** through the runtime adapter, so CLI, stdin,
env, config, prompted, and defaulted values are all validated:

```ts
flag.path(); // any string
flag.path({ mustExist: true }); // rejects missing paths
flag.path({ type: 'directory' }); // must exist and be a directory
flag.path({ type: 'directory', mustExist: false }); // missing passes; existing must be a directory
flag.path({ type: 'directory', create: true }); // created recursively when missing
```

`create` is only available with `type: 'directory'` (enforced at the type
level) and still rejects an existing non-directory path.

In process-free execution (`.execute()` / `runCommand()`), pass a `stat`
function via run options to enable the checks (plus `mkdir` for `create`);
without them the checks are skipped and nothing is created.

`flag.path()` resolves as a `string`, so a value read from stdin keeps the
buffer byte for byte, trailing line terminator included. `echo ./docs | mycli`
reaches a `mustExist` check as `'./docs\n'` and fails. `.stdin({ trim: true })`
drops that terminator, and `printf './docs'` works too.

### Date

Accepts strict ISO-8601 (`2026-07-10`, `2026-07-10T14:30:00Z`) and parses into
a `Date`. Lenient `Date.parse` inputs (`'0'`, `'March 5'`) and
calendar-invalid dates (`2026-02-31`) are rejected. Offset-less datetimes
(`2026-07-10T14:30`) are treated as **UTC**, not local time, so `min` / `max`
acceptance never depends on the machine's timezone. Optional inclusive
`min` / `max` bounds:

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const dateFlag = flag.date({ min: new Date('2020-01-01') });

declare const flagTypes: {
  date: InferFlag<typeof dateFlag>;
};
// ---cut---
flagTypes.date;
//         ^?
```

### Duration

Accepts `'30s'`, `'5m'`, `'1.5h'`, `'250ms'`, `'2d'`, compounds like
`'1h30m'`, or a bare millisecond count — and resolves to **milliseconds**:

```ts
flag.duration().default(30_000);
// --timeout 45s   → 45000
// --timeout 1h30m → 5400000
```

### Bytes

Accepts `'512mb'`, `'1.5gb'`, `'64kb'`, `'100b'` or a bare byte count, and
resolves to **bytes**. Units are binary (`1kb` = 1024) and case-insensitive:

```ts
flag.bytes().default(10 * 1024 ** 2);
// --max-size 512kb → 524288
```

::: tip Positional equivalents
`arg.url()`, `arg.path()`, `arg.date()`, `arg.duration()`, and `arg.bytes()`
take the same options and produce the same values. See
[Purpose-built argument kinds](/guide/arguments#purpose-built-argument-kinds).
Of the two kinds below, `keyValue` has a positional counterpart in
`arg.keyValue()` and `count` does not; `array` is served on the arg surface by
`.variadic()`. See
[What the arg factory does not have](/guide/arguments#flag-only-surface).
:::

### Count

Resolves to how many times the flag appears — the classic verbosity pattern.
`-vvv`, `-v -v -v`, and `--verbose --verbose --verbose` all yield `3`; absent
yields `0`. An explicit value (`--verbose=2`, env, config) sets the count
directly. Count flags take no value token and are not promptable:

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const countFlag = flag.count().alias('v');

declare const flagTypes: {
  count: InferFlag<typeof countFlag>;
};
// ---cut---
flagTypes.count;
//         ^?
```

### Key-Value

Repeated `KEY=VALUE` occurrences merge into a `Record<string, string>`
(docker/kubectl `--env` style):

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const kvFlag = flag.keyValue().alias('e');

declare const flagTypes: {
  env: InferFlag<typeof kvFlag>;
};
// ---cut---
flagTypes.env;
//         ^?
```

Env values carry comma-delimited pairs (`A=1,B=2`) by default, which means an
env-sourced value cannot itself contain a comma. Change the env policy with
`.split({ env: ';' })` or `.split({ env: 'json' })`, or use a config file, whose
plain object is read natively. See [Collections](#collections) for the full
per-source table, the duplicate-key policies, and reading entries from stdin.

Array and key-value flags are the optional flag kinds that still resolve to a
value when unset: arrays fall back to `[]`, key-value flags to `{}`.

`arg.keyValue()` is the positional counterpart. See
[Key-value arguments](/guide/arguments#key-value-arguments).

For the exact parser rules around repeated flags, short-flag stacking, `--`
separator handling, and `--no-*` spellings, see [CLI Semantics](/guide/semantics).

## Flag Names

The string you pass to `.flag(name, …)` is the flag's **canonical name**, and it is used in two
places at once:

- on the command line as `--name`;
- as the key on the `flags` object inside your handler.

The name you declare is the name you read — handler keys are never case-converted. Single-word
names are valid identifiers, so dot access works (`flags.region`). Hyphenated names are not valid
identifiers, so read them with bracket access (`flags['node-ipc']`).

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('serve')
  .flag(
    'node-ipc',
    flag.boolean().describe('Use the Node IPC transport'),
  )
  .flag('dry-run', flag.boolean())
  .action(({ flags, out }) => {
    // Hyphenated names are read with bracket access — there is no `flags.nodeIpc`.
    if (flags['node-ipc']) out.log('ipc');
    if (flags['dry-run']) out.log('dry run');
  });
```

Reach for a hyphenated name when you want the conventional CLI spelling (`--node-ipc`,
`--dry-run`); reach for a single-word or camelCase name (`--nodeIpc`) when ergonomic dot access
matters more. Either way users can type both spellings — see
[Spelling parity](#spelling-parity-kebab-camel) below.

### Spelling Parity (kebab ↔ camel) {#spelling-parity-kebab-camel}

On the command line, every flag name and long alias also accepts its kebab↔camel counterpart:
a flag named `dry-run` matches both `--dry-run` and `--dryRun`, and a flag named `dryRun`
matches both spellings too. The handler key is always the canonical name — parity is purely
CLI-token sugar, and help, completions, and "did you mean" suggestions advertise only the
declared spelling.

Two escape hatches:

- **Per pair, automatic** — if a command explicitly defines *both* spellings as separate flags
  (`do-this` and `doThis`), parity is disabled for that pair and each spelling matches only its
  own flag.
- **Globally** — pass `flags: { caseParity: false }` to the `cli()` factory (or to
  `cmd.run()` / `.execute()` options) to accept declared spellings only:

```ts twoslash
import { cli, command, flag } from '@kjanat/dreamcli';

cli('mycli', { flags: { caseParity: false } })
  .command(
    command('build')
      .flag('dry-run', flag.boolean())
      .action(() => {}),
  );
// $ mycli build --dry-run   → ok
// $ mycli build --dryRun    → Unknown flag --dryRun
```

Parity is not case-insensitivity: `--DRY-RUN` never matches.

### Aliases Are CLI Tokens, Not Handler Keys

`.alias()` adds an alternate **spelling on the command line**. It resolves back to the canonical
name — it never becomes a second property on `flags`.

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('serve')
  // Accepts both `--skip-pass` and `--skipPass` on the CLI…
  .flag('skip-pass', flag.boolean().alias('skipPass'))
  .action(({ flags, out }) => {
    // …but the handler has exactly one key: the canonical name.
    if (flags['skip-pass']) out.log('skipping');
  });
```

So typing `--skipPass` still arrives as `flags['skip-pass']`.

## Modifiers

Every flag type supports the same modifier chain:

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag
  .string()
  // short alias: -r
  .alias('r')
  // help text
  .describe('Target region')
  // default value (narrows type)
  .default('us')
  // must resolve or error
  .required()
  // resolve from piped stdin
  .stdin()
  // resolve from env var
  .env('DEPLOY_REGION')
  // resolve from config file
  .config('deploy.region')
  // interactive fallback
  .prompt({ kind: 'input', message: 'Region?' })
  // deprecation warning
  .deprecated('Use --target instead')
  // inherit in subcommands
  .propagate();
```

## Negatable Booleans

`.negatable()` gives a boolean flag a negated spelling that sets it to `false` — the classic
`--sandbox` / `--no-sandbox` pair as **one logical flag**:

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('build')
  .flag(
    'sandbox',
    flag.boolean().default(true).negatable().describe('Run the build sandboxed'),
  )
  .action(({ flags, out }) => {
    if (!flags.sandbox) out.warn('sandbox disabled');
  });
// $ mycli build                → sandbox = true  (default)
// $ mycli build --sandbox      → sandbox = true
// $ mycli build --no-sandbox   → sandbox = false
```

Semantics:

- Both spellings are the same flag: the **last CLI occurrence wins** across them, and they share
  the flag's [duplicate policy](#duplicate-policy).
- The negated spelling is presence-only — `--no-sandbox=true` is an error. Explicit values stay
  on the positive spelling (`--sandbox=false`).
- Help renders the pair as one entry: `--[no-]sandbox`.
- Only CLI tokens are affected; env, config, prompt, and default resolution are unchanged.

Customize the spelling with `alias` (rendered as its own form) or keep it parseable but
unadvertised with `hidden`:

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag.boolean().negatable({ alias: 'plain' }); // --color / --plain
flag.boolean().negatable({ hidden: true }); // --no-… parses, help shows only the positive form
```

The negated spelling participates in schema-time collision validation — defining `no-sandbox` as
its own flag next to a negatable `sandbox` is an error.

## Duplicate Policy {#duplicate-policy}

By default, repeating a singleton flag on the command line is last-write-wins
(`--region us --region eu` → `'eu'`). For flags that are configuration knobs rather than
mergeable inputs, `.duplicates()` makes repeats explicit:

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('run')
  .flag('spawn', flag.enum(['session', 'same-dir', 'worktree']).duplicates('error'))
  .flag('capacity', flag.number().duplicates('first'))
  .action(() => {});
// $ mycli run --spawn session --spawn worktree
// #   → Error: Flag --spawn may only be specified once   (code: DUPLICATE_FLAG)
// $ mycli run --capacity 2 --capacity 9   → capacity = 2 (first wins)
```

- `'last'` — last occurrence wins (default, historic behavior).
- `'first'` — first occurrence wins; later occurrences still consume their value token, they just
  don't overwrite.
- `'error'` — a second occurrence throws a `ParseError` with code `DUPLICATE_FLAG` and
  `details: { flag, count, values }`.

Occurrences are counted per **logical flag** — aliases, negated spellings, and
[parity spellings](#spelling-parity-kebab-camel) all count toward the same flag. Only CLI tokens
count: a flag set both on the CLI and via env/config follows the normal precedence chain and is
never a duplicate. `.duplicates()` is unavailable on `array`, `count`, and `keyValue` flags,
which inherently accumulate.

## Resolution Chain

Each flag resolves through an ordered pipeline. Every step is opt-in:

```mermaid
flowchart LR
    A[CLI argv] --> S[Piped stdin]
    S --> B[Environment variable]
    B --> C[Config file]
    C --> D[Interactive prompt]
    D --> E[Default value]
```

The first source that provides a value wins.
Required flags that don't resolve produce a structured error before the action handler runs.
Positional arguments walk the same order; see [Arguments](/guide/arguments).

### Example

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag
  .enum(['us', 'eu', 'ap'])
  .stdin()
  .env('DEPLOY_REGION')
  .config('deploy.region')
  .prompt({ kind: 'select', message: 'Which region?' })
  .default('us');
```

Resolution order:

1. `--region eu` on the command line
2. Piped stdin, for a flag that declares `.stdin()`
3. `DEPLOY_REGION=eu` in environment
4. `deploy.region: "eu"` in config file
5. Interactive select prompt (TTY only)
6. Default value `"us"`

## STDIN-Backed Flags

`.stdin()` lets a flag read its value from piped stdin. It is available on every
kind but `count`, which counts occurrences rather than reading a value:
`flag.count().stdin()` does not compile, and both the builder and the equivalent
definition object throw `INVALID_SCHEMA`. A scalar takes the whole buffer; a
collection decodes it into elements, one per line by default, and splices them
where a `-` occurrence sits, which [Collections](#collections) covers in full.

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('send')
  .flag('body', flag.string().stdin().describe('Message body'))
  .action(({ flags }) => {
    flags.body;
    //     ^?
  });
```

```bash
echo hi | mycli send      # body = 'hi\n'
mycli send --body -       # body reads stdin
mycli send --body hello   # body = 'hello'
```

The stdin stage sits ahead of env, so a flag set in the environment still reads a
pipe and the pipe wins. Passing the sentinel `-` selects stdin too, but keeps CLI
precedence: the bytes come from the pipe and every later stage stays out of the
way. When nothing was piped, both forms fall through to env, config, prompt, and
the default. A scalar `-` is the whole value, so dropping it loses nothing. That
is where a scalar and a collection part: `--tag a --tag -` with nothing piped
fails because dropping the occurrence would shorten the list.

The whole buffer becomes the value. Codecs that preserve text terminators keep
it byte for byte, so `echo hi | mycli` gives a string flag `'hi\n'` and a path
keeps the terminator too. Decoding codecs remove one framing terminator first,
so `echo true` reaches `flag.boolean()` as `true`.

`{ trim: true }` drops that terminator for a string flag too, so
`echo ./dist | mycli clean --path -` reaches a `mustExist` check as `'./dist'`.
It applies to a single value; a collection's terminators separate its elements
and `.split({ stdin })` decides them.

### Choosing when stdin is read

`.stdin()` takes `{ when, consume, trim }`:

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag.string().stdin(); // '-' or an absent flag reads stdin
flag.string().stdin({ when: 'dash' }); // only an explicit '-'
flag.string().stdin({ when: 'missing' }); // only an absent flag; '-' stays literal
flag.string().stdin({ consume: 'broadcast' }); // shares the buffer with other inputs
flag.string().stdin({ trim: true }); // drops one trailing terminator
```

Stdin is read at most once per invocation, and only when one of these bindings
would actually fire. If the user does not provide `-`, a `when: 'dash'` flag
does not read the stream.

### Worked Transcripts

Take one flag that reads stdin and an env var:

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('send')
  .flag('body', flag.string().stdin().env('BODY').default('fallback'))
  .action(({ flags }) => {
    flags.body;
    //     ^?
  });
```

The explicit `-` form is CLI-sourced, so it outranks the env var:

```bash
$ echo 'piped text' | BODY=env-value mycli send --body -
# flags.body === 'piped text\n'
```

Omitting the flag takes the stdin fallback stage, which still sits ahead of env:

```bash
$ echo 'piped text' | BODY=env-value mycli send
# flags.body === 'piped text\n'
```

With nothing piped, both forms fall through to env, then to the default:

```bash
$ BODY=env-value mycli send --body -
# flags.body === 'env-value'

$ mycli send
# flags.body === 'fallback'
```

Under `{ when: 'missing' }` a typed `-` is the literal string, not a selector:

```ts
flag.string().stdin({ when: 'missing' }).default('fallback');
```

```bash
$ echo 'piped text' | mycli send --body -
# flags.body === '-'
```

Under `{ when: 'dash' }` an omitted flag leaves the pipe unread, so env wins:

```ts
flag.string().stdin({ when: 'dash' }).env('BODY').default('fallback');
```

```bash
$ echo 'piped text' | BODY=env-value mycli send
# flags.body === 'env-value'
```

A required stdin-backed flag with nothing to read reports the stdin route in its
suggestion:

```
Missing required flag --body
Suggestion: Provide --body <value> or pipe a value to stdin
```

### `.stdin()` Constraints {#stdin-constraints}

One command has one exclusive stdin consumer. Declaring a second stdin input of
any kind, flag or argument, throws `DUPLICATE_STDIN_INPUT` at build time:

```ts
command('convert')
  .flag('body', flag.string().stdin())
  .arg('input', arg.string().stdin());
```

```
Only one input may consume stdin exclusively; --body already consumes stdin
Suggestion: Keep .stdin() on a single input per command, or declare every stdin input with { consume: 'broadcast' }
```

The message names the input declared first, and `details` carries the offending
input under `flag` or `arg` and the existing one under `existingFlag` or
`existingArg`. Pass `{ consume: 'broadcast' }` on every stdin input to share one
buffer among them:

```ts
command('convert')
  .flag('body', flag.string().stdin({ consume: 'broadcast' }))
  .arg('input', arg.string().stdin({ consume: 'broadcast' }));
// echo shared | mycli convert → flags.body === 'shared\n', args.input === 'shared\n'
```

`flag.count()` is the one kind that cannot read stdin, since it counts
occurrences rather than reading a value. The builder method is refused by the
compiler, and both it and the definition object throw the same error:

```ts
createFlagSchema('count', { stdin: {} });
```

```
Flag schema field 'stdin' is not available on kind 'count'
Suggestion: Drop 'stdin' or declare the flag as one of: string, number, boolean, enum, custom, array, keyValue
```

## Required vs Optional

### Optional

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const optionalFlag = flag.string();

declare const requiredVsOptional: {
  optional: InferFlag<typeof optionalFlag>;
};
// ---cut---
requiredVsOptional.optional;
//                    ^?
```

### Defaulted

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const defaultedFlag = flag.string().default('hello');

declare const requiredVsOptional: {
  defaulted: InferFlag<typeof defaultedFlag>;
};
// ---cut---
requiredVsOptional.defaulted;
//                    ^?
```

#### Defaults are validated where they are declared

A `.default()` value is already the typed value, so it is validated rather than
decoded. String and number constraints, element and aggregate Standard Schema
validators, and the shape the flag's cardinality requires all apply to it. A
violation whose verdict is available synchronously throws `INVALID_DEFAULT`
where the chain declares it:

```ts
flag.string({ minLength: 3 }).default('ab');
// Default value for a string flag is invalid: must be at least 3 characters

flag.array(flag.number({ min: 0 })).default([-1]);
// Default value for an array flag at 0 is invalid: must be >= 0

flag.count().default(-1);
// Default value for a count flag is invalid: expected a non-negative integer
```

Chain order does not change the verdict. A constraint or validator added after
the default is checked against it too:

```ts
flag.string().default('ab').minLength(3); // same error as the first line above
```

A collection default takes the shape the flag resolves to: an array for
`flag.array()`, a record for `flag.keyValue()`, a non-negative integer for
`flag.count()`.

Two checks stay at resolution time: command resolution awaits a validator that
returns a promise and probes the filesystem for `flag.path()` checks.
`flag.path({ mustExist: true }).default('/nope')` therefore builds, and fails
when the path is probed.

Fix the default, or widen the declaration where the value was intended:
`flag.number({ finite: false }).default(Number.POSITIVE_INFINITY)` holds.

### Required

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const requiredFlag = flag.string().required();

declare const requiredVsOptional: {
  required: InferFlag<typeof requiredFlag>;
};
// ---cut---
requiredVsOptional.required;
//                    ^?
```

### Boolean

```ts twoslash
import { flag, type InferFlag } from '@kjanat/dreamcli';

const booleanFlag = flag.boolean();

declare const requiredVsOptional: {
  boolean: InferFlag<typeof booleanFlag>;
};
// ---cut---
requiredVsOptional.boolean;
//                  ^?
```

## Custom Parsing

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag.custom((value) => {
  const url = new URL(String(value));
  if (url.protocol !== 'https:') {
    throw new Error('URL must use HTTPS');
  }
  return url;
});
```

The parse function receives the raw string value and returns the parsed type.
Thrown errors become validation errors with the flag name in context.

### Standard Schema Validators

`flag.custom()` also accepts any [Standard Schema v1](https://standardschema.dev/schema)
validator, including Zod, Valibot, and ArkType schemas:

```ts
import { flag } from '@kjanat/dreamcli';
import { z } from 'zod';

const port = flag.custom(z.coerce.number().int().min(1).max(65_535));
// inferred type: number | undefined
```

Standard Schema validation runs after source resolution, so the same sync or async validator
handles CLI, stdin, env, config, prompt, and default values. Validation issues become
`CONSTRAINT_VIOLATED` errors.

#### Element and aggregate validators

On a collection, where the validator sits decides what it sees. A validator on
the element builder runs once per resolved element or entry value. A validator
on the collection builder runs once on the completed array or record, after
every element has passed its own:

```ts
flag.array(flag.string().standard(upperCase)); // each element
flag.array(flag.string()).standard(atLeastOne); // the finished array
flag.keyValue(flag.string().standard(upperCase)); // each entry value
flag.keyValue().standard(hasApiKey); // the finished record
```

The two produce different messages. An element failure names the position, an
aggregate failure names the flag:

```
--tag[1] failed validation: must be upper case
--vars.KEY failed validation: must be upper case
--tag failed validation: at least one tag is required
```

`.standard()` on a scalar builder is the element validator, since a scalar
carries one value. An aggregate validator on a kind that does not aggregate
throws `INVALID_SCHEMA`.

## Propagation

Flags marked with `.propagate()` are inherited by all subcommands:

```ts twoslash
import { cli, command, flag } from '@kjanat/dreamcli';

const nested = command('start')
  .flag('verbose', flag.boolean().alias('v').propagate())
  .action(({ flags, out }) => {
    if (flags.verbose) {
      out.info('Verbose mode enabled');
    }
  });
// ---cut-start---
// ---cut-end---

cli('mycli').command(
  command('deploy')
    .flag('verbose', flag.boolean().alias('v').propagate())
    .command(nested),
);
```

## What's Next?

- [Arguments](/guide/arguments) — positional argument types
- [What the arg factory does not have](/guide/arguments#flag-only-surface), the
  flag members bound to flag syntax
- [Config Files](/guide/config) — config file resolution
- [Interactive Prompts](/guide/prompts) — prompt integration
- [CLI Semantics](/guide/semantics) — exact parser and precedence rules
