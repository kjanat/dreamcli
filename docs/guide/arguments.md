# Arguments

Positional arguments are declared with `arg` and appear after the command name.

## Argument Types

### String

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const stringArg = arg.string();

declare const argTypes: {
  string: InferArg<typeof stringArg>;
};
argTypes.string;
//         ^?
```

#### String constraints

`arg.string()` takes the same string constraints as `flag.string()`, either as
an options object or via chained methods (they compose, and a later chained call
overrides an earlier value, including one set in the options object):

```ts
arg.string({ nonEmpty: true, pattern: /^ghp_/ });
arg.string().nonEmpty().pattern(/^ghp_/); // equivalent
arg.string().minLength(3).maxLength(64);
```

Constraints are checked in order **nonEmpty → minLength → maxLength →
pattern** and apply to CLI, stdin, env, config, and prompted values. A
`.default()` value is trusted as declared and is not re-checked. On the first
failure, CLI parsing throws `INVALID_VALUE` while every other source reports
`CONSTRAINT_VIOLATED` (both exit code `2`). A variadic string argument checks
every value it collects. See [String constraints](/guide/flags#string-constraints)
for the option table, the declaration-time rules, and how the constraints reach
the exported JSON Schema.

Argument values that came from anywhere but argv are redacted in the error
message, so the reason is reported without echoing a piped secret:

```ts
command('auth').arg('token', arg.string().minLength(5).stdin());
```

```bash
$ printf 'ab' | mycli auth -
# Invalid value '<redacted>' from stdin for argument <token>: must be at least 5 characters
```

The source is named in each message: `from env TOKEN`, `from config auth.token`,
`from prompt`. A value typed on the command line is quoted in full, matching the
flag message byte for byte apart from the subject.

### Number

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const numberArg = arg.number();

declare const argTypes: {
  number: InferArg<typeof numberArg>;
};
argTypes.number;
//         ^?
```

`arg.number()` takes the same numeric constraints as `flag.number()`: an
options object or chained `.int()` / `.min()` / `.max()` / `.finite()` methods,
which compose. `finite` defaults to `true`, so `Infinity` / `-Infinity` (and
`NaN`) are rejected with error code `INVALID_VALUE` (exit `2`). See
[Numeric constraints](/guide/flags#numeric-constraints) for the full table.

```ts
arg.number({ min: 0, max: 100, int: true });
arg.number().int().min(0).max(100); // equivalent
```

### Custom

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const customArg = arg.custom((v) => v.split(',').map(Number));

declare const argTypes: {
  custom: InferArg<typeof customArg>;
};
argTypes.custom;
//         ^?
```

`arg.custom()` also accepts any [Standard Schema v1](https://standardschema.dev/schema)
validator. Its output type is inferred, sync and async validators are supported, and validation
runs after resolution, whichever of CLI, stdin, env, config, prompt, or the default supplied the
value. A variadic custom argument validates each resolved element separately.

## Purpose-Built Argument Kinds

Five factories mirror their [flag counterparts](/guide/flags#flag-types)
exactly: same value types, same option objects, same parsers, same error codes.
Reach for one of these before `arg.custom()` with a hand-written parser.

| Factory          | Resolved type | Accepts                                          |
| ---------------- | ------------- | ------------------------------------------------ |
| `arg.url()`      | `URL`         | any URL, optionally restricted by protocol       |
| `arg.path()`     | `string`      | any string, with optional filesystem checks      |
| `arg.date()`     | `Date`        | strict ISO-8601, optional `min` / `max` bounds   |
| `arg.duration()` | `number` (ms) | `'30s'`, `'1h30m'`, `'250ms'`, or a bare number  |
| `arg.bytes()`    | `number`      | `'512mb'`, `'1.5gb'`, `'64kb'`, or a bare number |

All five compose with `.optional()`, `.default()`, `.variadic()`, `.stdin()`,
`.env()`, `.config()`, `.prompt()`, `.describe()`, and `.deprecated()`, under
the same rules as any other argument, so `.variadic()` and `.stdin()` still
cannot be combined. A variadic one validates each collected value separately.

### URL

Parses into a `URL`; invalid URLs are rejected with the argument named in the
error. Optionally restrict protocols:

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const urlArg = arg.url({ protocols: ['https'] });

declare const argTypes: {
  url: InferArg<typeof urlArg>;
};
// ---cut---
argTypes.url;
//        ^?
```

### Path

The value stays a `string`, with optional filesystem checks that run **after
resolution** through the runtime adapter, so CLI, stdin, env, config, prompted,
and defaulted values are all validated:

```ts
arg.path(); // any string
arg.path({ mustExist: true }); // rejects missing paths
arg.path({ type: 'directory' }); // must exist and be a directory
arg.path({ type: 'directory', mustExist: false }); // missing passes; existing must be a directory
arg.path({ type: 'directory', create: true }); // created recursively when missing
```

`create` is only available with `type: 'directory'` (enforced at the type
level) and still rejects an existing non-directory path. A variadic path
argument checks every value it collects, not just the first.

In process-free execution (`.execute()` / `runCommand()`), pass a `stat`
function via run options to enable the checks (plus `mkdir` for `create`);
without them the checks are skipped and nothing is created.

`arg.path()` resolves as a `string`, so a value read from stdin keeps the buffer
byte for byte, trailing line terminator included. `echo ./docs | mycli` reaches
a `mustExist` check as `'./docs\n'` and fails:

```
Path './docs
' for argument <p> does not exist
```

Use `printf './docs'` when piping a path, or strip the terminator before the
pipe.

Failures carry `CONSTRAINT_VIOLATED` and name the argument:

```
Path '/data/report.csv' for argument <outDir> is a file, expected a directory
```

Help renders a positional by its own name, so `arg.path()` shows `<outDir>`
rather than the `<path>` placeholder its flag counterpart uses. That keeps
`mycli copy <src> <dst>` readable instead of collapsing to `<path> <path>`.

### Date

Accepts strict ISO-8601 (`2026-07-10`, `2026-07-10T14:30:00Z`) and parses into
a `Date`. Lenient `Date.parse` inputs (`'0'`, `'March 5'`) and calendar-invalid
dates (`2026-02-31`) are rejected. Offset-less datetimes (`2026-07-10T14:30`)
are treated as **UTC**, not local time, so `min` / `max` acceptance never
depends on the machine's timezone. Optional inclusive `min` / `max` bounds:

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const dateArg = arg.date({ min: new Date('2020-01-01') });

declare const argTypes: {
  date: InferArg<typeof dateArg>;
};
// ---cut---
argTypes.date;
//         ^?
```

### Duration

Accepts `'30s'`, `'5m'`, `'1.5h'`, `'250ms'`, `'2d'`, compounds like `'1h30m'`,
or a bare millisecond count, and resolves to **milliseconds**:

```ts
arg.duration().default(30_000);
// mycli wait 45s   → 45000
// mycli wait 1h30m → 5400000
```

### Bytes

Accepts `'512mb'`, `'1.5gb'`, `'64kb'`, `'100b'` or a bare byte count, and
resolves to **bytes**. Units are binary (`1kb` = 1024) and case-insensitive:

```ts
arg.bytes().default(10 * 1024 ** 2);
// mycli split 512kb → 524288
```

## What The Arg Factory Does Not Have {#flag-only-surface}

The value-level surface is the same on both factories. Everything below is
missing from `arg` on purpose, and the reason differs per item.

### Bound to flag syntax

These describe how a token is spelled or repeated on the command line. A
positional slot has no name to spell and no repetition to police, so there is
nothing for them to configure.

| Flag member                  | Why it has no arg equivalent                                                    |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `flag.boolean()`             | A boolean flag carries no value token; a positional is nothing but a value token. |
| `flag.count()`               | Counts how many times `-v` appears. A positional slot is matched by position.     |
| `.negatable()`               | Synthesizes a `--no-x` spelling for an existing flag name.                        |
| `.alias()`                   | Adds a second CLI spelling for a flag name.                                       |
| `.duplicates()`              | Decides what a repeated `--x` means. A positional slot is filled once.            |
| `.separator()` / `.unique()` | Split and deduplicate the values of an array flag.                                |
| `.propagate()`               | Inherits a flag into subcommands. Positional slots belong to one signature.       |

### Served by another member

`flag.array()` has no `arg.array()`. Use `.variadic()`, which collects the
remaining positional values into an array on any argument kind:

```ts
arg.string().variadic(); // string[]
arg.url().variadic(); // URL[]
arg.path({ mustExist: true }).variadic(); // string[], every entry checked
```

### Not implemented

`arg.keyValue()` has no arg form today.

`flag.keyValue()` merges repeated `KEY=VALUE` occurrences into one
`Record<string, string>`. A positional slot cannot express that merge, since
each slot holds one value and a variadic argument holds a list rather than a
record.

`.prompt()` and `.config()` used to be on this list. Both surfaces now declare
the same sources, so an argument reads a dotted config key and opens an
interactive prompt exactly as a flag does.

For `keyValue`, parse the value yourself with `arg.custom()`, optionally with a
[Standard Schema v1](https://standardschema.dev/schema) validator doing the
validation:

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const pairs = arg.custom((raw: string): Record<string, string> =>
  Object.fromEntries(
    raw.split(',').map((pair) => {
      const at = pair.indexOf('=');
      if (at === -1) throw new Error(`Expected KEY=VALUE, got '${pair}'`);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  )
);

declare const argTypes: { pairs: InferArg<typeof pairs> };
// ---cut---
argTypes.pairs;
//         ^?
```

A positional parsed this way still reads every source. Chain `.env()`,
`.config()`, `.prompt()`, and `.default()` on the `arg.custom()` builder and the
parse function runs on whichever source wins.

## Declaration

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

command('deploy')
  .arg('target', arg.string().describe('Deploy target'))
  .arg(
    'version',
    arg.string().describe('Version tag').optional(),
  )
  .action(({ args }) => {
    type Args = typeof args;
    //    ^?
  });
```

Arguments are positional — order matters:

```bash
$ mycli deploy production v1.2.3
#              ^^^^^^^^^^ ^^^^^^
#              target     version
```

## Required vs Optional

Arguments are required by default.
Use `.optional()` to make them optional:

### Required

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const requiredArg = arg.string();

declare const requiredVsOptional: {
  required: InferArg<typeof requiredArg>;
};
requiredVsOptional.required;
//                   ^?
```

### Optional

```ts twoslash
import { arg, type InferArg } from '@kjanat/dreamcli';

const optionalArg = arg.string().optional();

declare const requiredVsOptional: {
  optional: InferArg<typeof optionalArg>;
};
requiredVsOptional.optional;
//                   ^?
```

## Variadic Arguments

The last argument can be variadic, collecting all remaining positional values:

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

command('copy')
  .arg(
    'files',
    arg.string().variadic().describe('Files to copy'),
  )
  .action(({ args }) => {
    args.files;
    //     ^?
  });
```

```bash
$ mycli copy a.txt b.txt c.txt
# args.files = ['a.txt', 'b.txt', 'c.txt']
```

## Environment-Backed Arguments

Arguments can fall back to environment variables when the positional value is missing:

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

command('auth')
  .arg(
    'token',
    arg
      .string()
      .env('API_TOKEN')
      .describe('Token from env'),
  )
  .action(({ args }) => {
    args.token;
    //     ^?
  });
```

If `API_TOKEN=secret` and no CLI value is provided, `args.token === 'secret'`.

## Config-Backed Arguments

`.config()` binds an argument to a dotted key in the loaded config object:

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

command('deploy')
  .arg(
    'target',
    arg.string().config('deploy.target').default('local'),
  )
  .action(({ args }) => {
    args.target;
    //     ^?
  });
```

```bash
# config: { "deploy": { "target": "eu-west" } }
mycli deploy             # target = 'eu-west'
mycli deploy ap-south    # target = 'ap-south', the CLI token wins
```

The config value is coerced to the argument's declared kind the same way a
flag's is, so `arg.duration().config('y.wait')` accepts both `"1h30m"` and
`5000`. A value that fails coercion reports `CONSTRAINT_VIOLATED` with the raw
value redacted.

## Prompt-Backed Arguments

`.prompt()` attaches an interactive prompt that runs when CLI, stdin, env, and
config all produce nothing:

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

command('deploy')
  .arg(
    'target',
    arg.string().prompt({ kind: 'input', message: 'Target:' }),
  )
  .action(({ args }) => {
    args.target;
    //     ^?
  });
```

```bash
mycli deploy             # asks "Target:"
mycli deploy production  # skips the prompt
```

The prompt kinds an argument accepts follow its kind, matching the flag table:
`string` takes `input` or `select`, `number` takes `input`, `enum` takes
`select` or `input`, and `custom` takes every kind. An incompatible pairing
throws `CONSTRAINT_VIOLATED` naming the argument:

```
Prompt kind 'confirm' is not compatible with number argument <n>. Use 'input' instead
```

Prompts run only when a prompter is available. Without one the argument falls
through to its default, or fails as missing.

## STDIN-Backed Arguments

Arguments can also read from piped stdin with `.stdin()`:

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

command('format')
  .arg(
    'data',
    arg.string().stdin().describe('Read from STDIN'),
  )
  .action(({ args }) => {
    args.data;
    //     ^?
  });
```

Arguments and flags resolve through the same order:
`CLI → stdin → env → config → prompt → default`. With `stdinData: 'hello'` in
tests or piped input at runtime, `args.data === 'hello'`.

The stdin stage sits ahead of env, so an argument set in the environment still
reads a pipe and the pipe wins. Passing the literal sentinel `-` selects stdin
too, but keeps CLI precedence: the bytes come from the pipe and every later
stage stays out of the way. When nothing was piped, both forms fall through to
env, config, prompt, and the default.

The whole buffer becomes the value. A string argument keeps it byte for byte, so
`echo hi | mycli` gives `'hi\n'`; every other kind drops the single line
terminator a pipe appends before decoding, so `echo 30s` reaches
`arg.duration()` as `30s`.

### Choosing when stdin is read

`.stdin()` takes `{ when, consume }`:

```ts twoslash
import { arg } from '@kjanat/dreamcli';

arg.string().stdin(); // '-' or an omitted slot reads stdin
arg.string().stdin({ when: 'dash' }); // only an explicit '-'
arg.string().stdin({ when: 'missing' }); // only an omitted slot; '-' stays literal
arg.string().stdin({ consume: 'broadcast' }); // shares the buffer with other inputs
```

Stdin is read at most once per invocation, and only when one of these bindings
would actually fire. A `when: 'dash'` argument the user never dashes never
touches the stream.

### Worked Transcripts

Take one command with a stdin-backed argument that also reads an env var:

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

command('format')
  .arg('data', arg.string().stdin().env('DATA').default('fallback'))
  .action(({ args }) => {
    args.data;
    //     ^?
  });
```

The explicit `-` form is CLI-sourced, so it outranks the env var:

```bash
$ echo 'piped text' | DATA=env-value mycli format -
# args.data === 'piped text\n'
```

Omitting the slot takes the stdin fallback stage, which still sits ahead of env:

```bash
$ echo 'piped text' | DATA=env-value mycli format
# args.data === 'piped text\n'
```

With nothing piped, both forms fall through to env, then to the default:

```bash
$ DATA=env-value mycli format -
# args.data === 'env-value'

$ mycli format
# args.data === 'fallback'
```

Under `{ when: 'missing' }` a typed `-` is the literal string, not a selector:

```ts
arg.string().stdin({ when: 'missing' }).default('fallback');
```

```bash
$ echo 'piped text' | mycli format -
# args.data === '-'
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

Stdin-backed arguments cannot also be variadic.

If stdin is absent, resolution falls through to the later stages and then to
required versus optional behavior, so use `.optional()` when missing piped input
should resolve to `undefined` instead of a validation error. A required
stdin-backed argument with nothing to read reports the stdin route in its
suggestion:

```
Missing required argument <data>
Suggestion: Provide a value for <data> or pipe a value to stdin or pass '-'
```

## What's Next?

- [Flags](/guide/flags) — flag types and resolution chain
- [What the arg factory does not have](#flag-only-surface), the deliberate
  differences between the two factories
- [Output](/guide/output) — structured output channel
