# Arguments

Positional arguments are declared with `arg` and appear after the command name.

## Argument Types

```ts twoslash
import { arg } from '@kjanat/dreamcli';

arg.string();
//     ^?

arg.number();
//     ^?

arg.custom((v) => new URL(v));
//     ^?
```

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
    args.target;
    //     ^?

    args.version;
    //     ^?
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

```ts twoslash
import { arg } from '@kjanat/dreamcli';

// Required — must be provided
arg.string();

// Optional — may be omitted
arg.string().optional();
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
- [Output](/guide/output) — structured output channel
