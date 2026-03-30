# Getting Started

## Installation

::: code-group

```bash [npm]
npm install dreamcli
```

```bash [bun]
bun add dreamcli
```

```bash [deno]
deno add jsr:@kjanat/dreamcli
```

:::

## Your First Command

```ts
import { command, flag, arg } from 'dreamcli';

const greet = command('greet')
	.description('Greet someone')
	.arg('name', arg.string().describe('Who to greet'))
	.flag('loud', flag.boolean().alias('l').describe('Shout the greeting'))
	.flag('times', flag.number().default(1).describe('Repeat count'))
	.action(({ args, flags, out }) => {
		for (let i = 0; i < flags.times; i++) {
			const msg = `Hello, ${args.name}!`;
			out.log(flags.loud ? msg.toUpperCase() : msg);
		}
	});

greet.run();
```

```bash
$ node greet.ts Alice --loud --times 3
HELLO, ALICE!
HELLO, ALICE!
HELLO, ALICE!
```

By the time `action` runs, `args.name` is `string` and `flags.times` is `number` — fully resolved,
no `undefined` to check.

## Multi-Command CLI

```ts
import { cli, command, group, flag, arg } from 'dreamcli';

const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string())
	.flag('force', flag.boolean().alias('f'))
	.flag('region', flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION'))
	.action(({ args, flags, out }) => {
		out.log(`Deploying ${args.target} to ${flags.region ?? 'default'}`);
	});

const login = command('login')
	.description('Authenticate with the service')
	.flag('token', flag.string())
	.action(({ flags, out }) => {
		out.log(`Logged in with token: ${flags.token ?? 'interactive'}`);
	});

cli('mycli').version('1.0.0').description('My awesome tool').command(deploy).command(login).run();
```

```bash
$ mycli deploy production --force
$ mycli login --token abc123
```

## What's Next?

- [Why dreamcli?](/guide/why) — how it compares to existing frameworks
- [Commands](/guide/commands) — command builders, groups, nesting
- [Flags](/guide/flags) — all flag types, modifiers, and resolution
- [Testing](/guide/testing) — in-process test harness
- [CLI Fundamentals](/concepts/anatomy) — new to CLIs? Start with the concepts
