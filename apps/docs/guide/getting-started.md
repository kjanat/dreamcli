# Getting Started

## Installation

::: code-group

```bash [npm]
npm install @kjanat/dreamcli
```

```bash [bun]
bun add @kjanat/dreamcli
```

```bash [deno]
deno add jsr:@kjanat/dreamcli
```

:::

Supported minimum runtimes:
Node.js `>= 22.22.2`,
Bun `>= 1.3.11`,
Deno `>= 2.6.0`.

## Your First Command

```ts twoslash
import { cli, command, flag, arg } from '@kjanat/dreamcli';

const greet = command('greet')
  .description('Greet someone')
  .arg('name', arg.string().describe('Who to greet'))
  .flag(
    'loud',
    flag
      .boolean()
      .alias('l')
      .describe('Shout the greeting'),
  )
  .flag(
    'times',
    flag.number().default(1).describe('Repeat count'),
  )
  .action(({ args, flags, out }) => {
    for (let i = 0; i < flags.times; i++) {
      const msg = `Hello, ${args.name}!`;
      out.log(flags.loud ? msg.toUpperCase() : msg);
    }
  });

cli('greet').default(greet).run();
```

```bash
$ npx tsx greet.ts Alice --loud --times 3
HELLO, ALICE!
HELLO, ALICE!
HELLO, ALICE!
```

By the time `action` runs, `args.name` is `string` and `flags.times` is `number` — fully resolved,
no `undefined` to check.

## Multi-Command CLI

```ts twoslash
import {
  cli,
  command,
  group,
  flag,
  arg,
} from '@kjanat/dreamcli';

const deploy = command('deploy')
  .description('Deploy to an environment')
  .arg('target', arg.string())
  .flag('force', flag.boolean().alias('f'))
  .flag(
    'region',
    flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION'),
  )
  .action(({ args, flags, out }) => {
    out.log(
      `Deploying ${args.target} to ${flags.region ?? 'default'}`,
    );
  });

const login = command('login')
  .description('Authenticate with the service')
  .flag('token', flag.string())
  .action(({ flags, out }) => {
    out.log(
      flags.token
        ? 'Authenticated via token'
        : 'Authenticated interactively',
    );
  });

cli('mycli')
  .version('1.0.0')
  .description('My awesome tool')
  .command(deploy)
  .command(login)
  .run();
```

```bash
$ mycli deploy production --force
Deploying production to default

$ mycli login --token abc123
Authenticated via token
```

## What's Next?

- [Why dreamcli?](/guide/why) — how it compares to existing frameworks
- [Commands](/guide/commands) — command builders, groups, nesting
- [Flags](/guide/flags) — all flag types, modifiers, and resolution
- [Testing](/guide/testing) — in-process test harness
- [CLI Fundamentals](/concepts/anatomy) — new to CLIs? Start with the concepts
