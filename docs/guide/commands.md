# Commands

Commands are the primary building block in dreamcli.
Every CLI has at least one.

## Single Command

The simplest CLI is a single command wrapped in `cli()`:

```ts twoslash
import { cli, command, flag, arg } from '@kjanat/dreamcli';

const greet = command('greet')
  .description('Greet someone')
  .arg('name', arg.string().describe('Who to greet'))
  .flag('loud', flag.boolean().alias('l'))
  .action(({ args, flags, out }) => {
    const msg = `Hello, ${args.name}!`;
    out.log(flags.loud ? msg.toUpperCase() : msg);
  });

cli('greet').default(greet).run();
```

## Multi-Command CLI

Use `cli()` to compose multiple commands:

```ts twoslash
import { cli, command, flag } from '@kjanat/dreamcli';

const deploy = command('deploy')
  .description('Deploy the app')
  .action(({ out }) => out.log('deploying...'));

const login = command('login')
  .description('Authenticate')
  .action(({ out }) => out.log('logging in...'));

cli('mycli')
  .version('1.0.0')
  .description('My tool')
  .command(deploy)
  .command(login)
  .run();
```

## Command Groups

Nest commands under a group for `cli group subcommand` patterns:

```ts twoslash
import { command, group } from '@kjanat/dreamcli';

const migrate = command('migrate')
  .description('Run migrations')
  .action(({ out }) => out.log('migrating'));

const seed = command('seed')
  .description('Seed database')
  .action(({ out }) => out.log('seeding'));

const db = group('db')
  .description('Database operations')
  .command(migrate)
  .command(seed);

// Usage: mycli db migrate, mycli db seed
```

Groups can be nested arbitrarily deep.

## Command Configuration

### Description and Examples

```ts twoslash
import { command } from '@kjanat/dreamcli';

command('deploy')
  .description('Deploy to an environment')
  .example('deploy production', 'Deploy to prod')
  .example('deploy staging --force', 'Force deploy to staging');
```

### Default Command

Set a default command that runs when no subcommand is specified:

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const mainCommand = command('main');
const other = command('other');

cli('mycli').default(mainCommand).command(other).run();
```

Root behavior depends on what else is visible:

- a single visible default command merges its command help into root help
- visible sibling commands keep root help command-centric
- hidden defaults remain executable but are omitted from root help and root completions

For the exact root, help, and completion rules, see [CLI Semantics](/guide/semantics).

### Version

```ts twoslash
import { cli } from '@kjanat/dreamcli';

cli('mycli').version('1.0.0').run();
```

Adds `--version` / `-V` automatically.

## Action Handler

The `.action()` callback receives a single object with typed fields:

```ts twoslash
import { command } from '@kjanat/dreamcli';

command('deploy').action(({ args, flags, ctx, meta, out }) => {
  // args  — typed positional arguments
  // flags — typed flag values (fully resolved)
  // ctx   — typed middleware context
  // meta  — CLI metadata: name (program name), bin (invoked binary name),
  //         version (program version), command (leaf command name)
  // out   — output channel
});
```

Actions can be `async`:

```ts twoslash
import { arg, command } from '@kjanat/dreamcli';

declare const deploy: (
  target: string,
  flags: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

command('deploy')
  .arg('target', arg.string())
  .action(async ({ args, flags, out }) => {
    const result = await deploy(args.target, flags);
    out.json(result);
  });
```

## What's Next?

- Related examples: [Basic CLI](/examples/basic), [Multi-command CLI](/examples/multi-command)
- [Flags](/guide/flags) — all flag types and modifiers
- [Arguments](/guide/arguments) — positional argument types
- [Middleware](/guide/middleware) — typed context propagation
- [CLI Semantics](/guide/semantics) — exact root and resolution behavior
