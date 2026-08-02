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
pattern** and apply to CLI, stdin, and env values. A `.default()` value is
trusted as declared and is not re-checked. On the first failure, CLI parsing
throws `INVALID_VALUE` while stdin and env resolution report
`CONSTRAINT_VIOLATED` (both exit code `2`). A variadic string argument checks
every value it collects. See [String constraints](/guide/flags#string-constraints)
for the option table, the declaration-time rules, and how the constraints reach
the exported JSON Schema.

Argument values that came from stdin or env are redacted in the error message,
so the reason is reported without echoing a piped secret:

```ts
command('auth').arg('token', arg.string().minLength(5).stdin());
```

```bash
$ printf 'ab' | mycli auth -
# Invalid value '<redacted>' from stdin for argument <token>: must be at least 5 characters
```

A value typed on the command line is quoted in full, matching the flag message
byte for byte apart from the subject.

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
runs after CLI, env, stdin, or default resolution. A variadic custom argument validates each
resolved element separately.

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
`.env()`, `.describe()`, and `.deprecated()`, under the same rules as any other
argument, so `.variadic()` and `.stdin()` still cannot be combined. A variadic
one validates each collected value separately.

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
resolution** through the runtime adapter, so CLI, stdin, env, and defaulted
values are all validated:

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

`arg.keyValue()`, `.prompt()`, and `.config()` have no arg form today.

`flag.keyValue()` merges repeated `KEY=VALUE` occurrences into one
`Record<string, string>`. A positional slot cannot express that merge, since
each slot holds one value and a variadic argument holds a list rather than a
record.

`.prompt()` and `.config()` are resolution-chain sources. An argument resolves
through `CLI → stdin → env → default` and does not read a config file or open an
interactive prompt.

For all three, parse the value yourself with `arg.custom()`, optionally with a
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

When a value genuinely has to come from a config file or a prompt, declare it as
a flag and combine it with the positional in `.derive()`, which runs after
resolution and before the action.

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

When the CLI value is omitted, dreamcli resolves arguments in this order:
`CLI → stdin → env → default`. With `stdinData: 'hello'` in tests or piped input at runtime,
`args.data === 'hello'`.

Passing the literal sentinel `-` means “skip normal CLI resolution for this slot and read stdin
instead”. Omitted positional input follows `CLI → stdin → env → default`, while `-` bypasses the
CLI step and therefore resolves through `stdin → env → default`.

### `.stdin()` Constraints

Only one argument per command may call `.stdin()`, and stdin-backed arguments cannot also be
variadic. If stdin is absent, resolution falls through to env/default and then to required vs
optional behavior, so use `.optional()` when missing piped input should resolve to `undefined`
instead of a validation error.

## What's Next?

- [Flags](/guide/flags) — flag types and resolution chain
- [What the arg factory does not have](#flag-only-surface), the deliberate
  differences between the two factories
- [Output](/guide/output) — structured output channel
