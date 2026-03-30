# Commands

Commands are the primary building block in dreamcli. Every CLI has at least one.

## Single Command

The simplest CLI is a single command that calls `.run()`:

```ts
import { command, flag, arg } from 'dreamcli';

const greet = command('greet')
	.description('Greet someone')
	.arg('name', arg.string().describe('Who to greet'))
	.flag('loud', flag.boolean().alias('l'))
	.action(({ args, flags, out }) => {
		const msg = `Hello, ${args.name}!`;
		out.log(flags.loud ? msg.toUpperCase() : msg);
	});

greet.run();
```

## Multi-Command CLI

Use `cli()` to compose multiple commands:

```ts
import { cli, command, flag } from 'dreamcli';

const deploy = command('deploy')
	.description('Deploy the app')
	.action(({ out }) => out.log('deploying...'));

const login = command('login')
	.description('Authenticate')
	.action(({ out }) => out.log('logging in...'));

cli('mycli').version('1.0.0').description('My tool').command(deploy).command(login).run();
```

## Command Groups

Nest commands under a group for `cli group subcommand` patterns:

```ts
import { command, group } from 'dreamcli';

const migrate = command('migrate')
	.description('Run migrations')
	.action(({ out }) => out.log('migrating'));

const seed = command('seed')
	.description('Seed database')
	.action(({ out }) => out.log('seeding'));

const db = group('db').description('Database operations').command(migrate).command(seed);

// Usage: mycli db migrate, mycli db seed
```

Groups can be nested arbitrarily deep.

## Command Configuration

### Description and Examples

```ts
command('deploy')
	.description('Deploy to an environment')
	.example('deploy production', 'Deploy to prod')
	.example('deploy staging --force', 'Force deploy to staging');
```

### Default Command

Set a default command that runs when no subcommand is specified:

```ts
cli('mycli').default(mainCommand).command(other).run();
```

### Version

```ts
cli('mycli').version('1.0.0').run();
```

Adds `--version` / `-V` automatically.

## Action Handler

The `.action()` callback receives a single object with typed fields:

```ts
.action(({ args, flags, ctx, out }) => {
  // args  — typed positional arguments
  // flags — typed flag values (fully resolved)
  // ctx   — typed middleware context
  // out   — output channel
})
```

Actions can be `async`:

```ts
.action(async ({ args, flags, out }) => {
  const result = await deploy(args.target, flags);
  out.json(result);
})
```

## What's Next?

- [Flags](/guide/flags) — all flag types and modifiers
- [Arguments](/guide/arguments) — positional argument types
- [Middleware](/guide/middleware) — typed context propagation
