# Flags

Flags are the richest primitive in `dreamcli`.
Each flag declaration configures parsing, type inference, resolution, help text, and shell completions.

## Flag Types

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag.string(); // string | undefined
flag.number(); // number | undefined
flag.boolean(); // boolean (defaults to false)
flag.enum(['us', 'eu', 'ap']); // "us" | "eu" | "ap" | undefined
flag.array(flag.string()); // string[] (falls back to [])
flag.custom((v) => new URL(String(v))); // URL | undefined
```

Array flags are the one optional flag kind that still resolve to a value when
unset: if no CLI/env/config/prompt/default value is found, they fall back to
an empty array `[]`.

For the exact parser rules around repeated flags, short-flag stacking, `--`
separator handling, and `--no-*` spellings, see [CLI Semantics](/guide/semantics).

## Modifiers

Every flag type supports the same modifier chain:

```ts twoslash
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

## Resolution Chain

Each flag resolves through an ordered pipeline. Every step is opt-in:

```mermaid
flowchart LR
    A[CLI argv] --> B[Environment variable]
    B --> C[Config file]
    C --> D[Interactive prompt]
    D --> E[Default value]
```

The first source that provides a value wins.
Required flags that don't resolve produce a structured error before the action handler runs.

### Example

```ts twoslash
flag
  .enum(['us', 'eu', 'ap'])
  .env('DEPLOY_REGION')
  .config('deploy.region')
  .prompt({ kind: 'select', message: 'Which region?' })
  .default('us');
```

Resolution order:

1. `--region eu` on the command line
2. `DEPLOY_REGION=eu` in environment
3. `deploy.region: "eu"` in config file
4. Interactive select prompt (TTY only)
5. Default value `"us"`

## Required vs Optional

```ts twoslash
// Optional — handler sees string | undefined
flag.string();

// Optional with default — handler sees string
flag.string().default('hello');

// Required — must resolve or error before handler
flag.string().required();

// Boolean — always has a value (defaults to false)
flag.boolean();
```

## Custom Parsing

```ts twoslash
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

## Propagation

Flags marked with `.propagate()` are inherited by all subcommands:

```ts twoslash
const nested = command('start')
  .flag('verbose', flag.boolean().alias('v').propagate())
  .action(({ flags, out }) => {
    if (flags.verbose) {
      out.info('Verbose mode enabled');
    }
  });
// ---cut-start---
// (In practice, .propagate() on the parent makes this flag available
// on all children automatically — shown explicitly here for type safety)
// ---cut-end---

cli('mycli').command(
  command('deploy')
    .flag('verbose', flag.boolean().alias('v').propagate())
    .command(nested),
);
```

## What's Next?

- [Arguments](/guide/arguments) — positional argument types
- [Config Files](/guide/config) — config file resolution
- [Interactive Prompts](/guide/prompts) — prompt integration
- [CLI Semantics](/guide/semantics) — exact parser and precedence rules
