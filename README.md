# `@kjanat/dreamcli`

Schema-first, fully typed TypeScript CLI framework. Zero runtime dependencies.

One flag declaration configures the entire resolution pipeline:

```ts
import { cli, command, flag, arg, middleware, CLIError } from '@kjanat/dreamcli';

const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string().describe('Deploy target'))
	.flag(
		'region',
		flag
			.enum(['us', 'eu', 'ap'])
			.alias('r')
			.env('DEPLOY_REGION')
			.config('deploy.region')
			.prompt({ kind: 'select', message: 'Which region?' })
			.default('us')
			.propagate(),
	)
	.action(({ args, flags, out }) => {
		out.log(`Deploying ${args.target} to ${flags.region}`);
	});
```

By the time `action` runs, `flags.region` is `"us" | "eu" | "ap"` — not `string | undefined`.

The value is resolved through a documented chain: **CLI → env → config → interactive prompt →
default**. Every step is opt-in. Every step preserves types.

## Install

```bash
npm install @kjanat/dreamcli
```

```bash
bun add @kjanat/dreamcli
```

```bash
deno add jsr:@kjanat/dreamcli  # or npm:@kjanat/dreamcli
```

## Quick start

### Single command

```ts
import { command, flag, arg } from '@kjanat/dreamcli';

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

### Multi-command CLI

```ts
import { cli, command, group, flag, arg } from '@kjanat/dreamcli';

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
	.flag('token', flag.string().describe('Auth token'))
	.action(({ flags, out }) => {
		out.log(flags.token ? 'Authenticated via token' : 'Authenticated interactively');
	});

// Nested command groups
const migrate = command('migrate')
	.description('Run migrations')
	.flag('steps', flag.number())
	.action(({ flags, out }) => {
		out.log(`migrating ${flags.steps ?? 'all'} steps`);
	});

const seed = command('seed')
	.description('Seed database')
	.action(({ out }) => {
		out.log('seeding');
	});

const db = group('db').description('Database operations').command(migrate).command(seed);

cli('mycli')
	.version('1.0.0')
	.description('My awesome tool')
	.command(deploy)
	.command(login)
	.command(db)
	.run();

// mycli deploy production --force
// mycli login --token abc123
// mycli db migrate --steps 3
// mycli db seed
```

## Why dreamcli

Most TypeScript CLI frameworks treat the type system like decoration. You define flags in one place,
then use parsed values somewhere else as a loosely typed blob. Env vars, config files, and
interactive prompts live in separate universes. Testing means hacking `process.argv`.

dreamcli collapses all of that into a single typed schema:

Approximate comparison of first-party, built-in support as documented by each project.
Third-party plugins and custom glue can extend the other libraries.

| Capability                                 | Commander           | Yargs                  | Citty           | CAC           | Cleye         | dreamcli                              |
| ------------------------------------------ | ------------------- | ---------------------- | --------------- | ------------- | ------------- | ------------------------------------- |
| Type inference from definition             | Manual `.opts<T>()` | Good                   | Good            | Basic         | Good          | Full — flags, args, context           |
| Built-in value sources                     | CLI, defaults, env  | CLI, env, config       | CLI, defaults   | CLI, defaults | CLI, defaults | CLI, env, config, prompt, default     |
| Schema-driven prompts                      | No                  | No                     | No              | No            | No            | Integrated                            |
| Middleware / hooks                         | Lifecycle hooks     | Middleware             | Plugins / hooks | Events        | No            | Yes — typed middleware                |
| Built-in test harness with output capture  | No                  | No                     | No              | No            | No            | `runCommand()` + capture              |
| Shell completions from command definitions | No                  | Built-in (bash/zsh)    | No              | No            | No            | Built-in (bash/zsh)                   |
| Structured output primitives               | DIY                 | DIY                    | DIY             | DIY           | DIY           | Built-in (`--json`, tables, spinners) |
| Config file support                        | DIY                 | Built-in (`.config()`) | No              | No            | No            | Built-in (XDG discovery, JSON)        |

The closest analog is what tRPC did to API routes — individual pieces existed, the insight was
wiring them so types flow end-to-end.

## Features

### Flag types

```ts
flag.string(); // string | undefined
flag.number(); // number | undefined
flag.boolean(); // boolean (defaults to false)
flag.enum(['us', 'eu', 'ap']); // "us" | "eu" | "ap" | undefined
flag.array(flag.string()); // string[] | undefined
flag.custom((v) => new URL(v)); // URL | undefined
```

Every flag supports: `.default()`, `.required()`, `.alias()`, `.env()`, `.config()`, `.describe()`,
`.prompt()`, `.deprecated()`, `.propagate()`.

### Resolution chain

Each flag resolves through an ordered pipeline. Every step is opt-in:

```text
CLI argv  →  environment variable  →  config file  →  interactive prompt  →  default value
```

Required flags that don't resolve produce a structured error before the action handler runs. In
non-interactive contexts (CI, piped stdin), prompts are automatically skipped.

### Interactive prompts

Four prompt types, declared per-flag or per-command:

```ts
// Per-flag
flag.string().prompt({ kind: 'input', message: 'Name?' });
flag.boolean().prompt({ kind: 'confirm', message: 'Sure?' });
flag.enum(['a', 'b']).prompt({ kind: 'select', message: 'Pick one' });
flag
	.array(flag.string())
	.prompt({ kind: 'multiselect', message: 'Pick many', choices: [{ value: 'a' }, { value: 'b' }] });

// Per-command (conditional — receives partially resolved flags)
command('deploy')
	.flag('region', flag.enum(['us', 'eu', 'ap']))
	.interactive(({ flags }) => ({
		region: !flags.region && { kind: 'select', message: 'Which region?' },
	}));
```

### Derive typed context from resolved input

```ts
import { CLIError } from '@kjanat/dreamcli';

command('deploy')
	.flag('token', flag.string().env('AUTH_TOKEN'))
	.derive(({ flags }) => {
		if (!flags.token)
			throw new CLIError('Not authenticated', {
				code: 'AUTH_REQUIRED',
				suggest: 'Run `mycli login`',
			});
		return { token: flags.token };
	})
	.action(({ ctx }) => {
		ctx.token; // string — typed
	});
```

Use `derive()` when you need typed, command-scoped access to fully resolved flags and args before
the action handler runs.

### Middleware with typed context

```ts
import { middleware } from '@kjanat/dreamcli';

const timing = middleware<{ startTime: number }>(async ({ next }) => {
	const startTime = Date.now();
	await next({ startTime });
});

const trace = middleware<{ traceId: string }>(async ({ next }) =>
	next({ traceId: crypto.randomUUID() }),
);

command('deploy')
	.middleware(timing)
	.middleware(trace)
	.action(({ ctx }) => {
		ctx.startTime; // number — typed
		ctx.traceId; // string — typed
	});
```

Context accumulates through the middleware chain via type intersection. No manual interface merging.
Use middleware when you need wrapper behavior with `next()`.

### Output channel

Handlers receive `out` instead of `console`. Adapts to context automatically:

```ts
.action(({ out }) => {
  out.log('Human-readable message');
  out.json({ status: 'ok', count: 42 });
  out.table(rows, [{ key: 'name', header: 'Name' }, { key: 'status', header: 'Status' }]);

  const spinner = out.spinner('Deploying...');
  spinner.succeed('Done');

  const progress = out.progress({ label: 'Uploading', total: 100 });
  progress.update(50);
  progress.done('Upload complete');
})
```

- TTY → pretty formatting, spinners animate
- Piped → minimal stable output, spinners suppressed
- `--json` → structured JSON to stdout, everything else to stderr

### Shell completions

Generated from the command schema — always in sync:

```ts
import { generateCompletion } from '@kjanat/dreamcli';

generateCompletion(myCli.schema, 'bash');
generateCompletion(myCli.schema, 'zsh');
```

### Config file discovery

```ts
command('deploy').flag('region', flag.enum(['us', 'eu']).config('deploy.region'));
```

Searches XDG-standard paths automatically. JSON built-in, plugin hook for YAML/TOML:

```ts
import { configFormat } from '@kjanat/dreamcli';
import { parse as parseYAML } from 'yaml';

cli('mycli')
	.config('mycli')
	.configLoader(configFormat(['yaml', 'yml'], parseYAML));
```

### Structured errors

```ts
throw new CLIError('Deployment failed', {
	code: 'DEPLOY_FAILED',
	exitCode: 1,
	suggest: 'Check your credentials with `mycli login`',
	details: { target, region },
});
```

Parse and validation errors include "did you mean?" suggestions. In `--json` mode, errors serialize
to machine-readable JSON.

## Testing

dreamcli's test harness runs commands in-process with full control over inputs and outputs. No
subprocesses, no `process.argv` mutation, no mocking.

```ts
import { runCommand, createTestPrompter, PROMPT_CANCEL } from '@kjanat/dreamcli/testkit';

// Basic execution
const result = await runCommand(greet, ['Alice', '--loud']);

expect(result.exitCode).toBe(0);
expect(result.stdout).toEqual(['HELLO, ALICE!\n']);
expect(result.stderr).toEqual([]);
expect(result.error).toBeUndefined();

// With environment, config, and prompt answers
const result = await runCommand(deploy, ['production'], {
	env: { DEPLOY_REGION: 'eu' },
	config: { deploy: { region: 'us' } },
	answers: ['ap'], // prompt answers consumed in order
});

// Simulate prompt cancellation
const result = await runCommand(cmd, [], {
	prompter: createTestPrompter([PROMPT_CANCEL]),
});

// Activity events (spinners, progress)
expect(result.activity).toContainEqual(expect.objectContaining({ type: 'spinner:start' }));
```

`RunOptions` accepts: `env`, `config`, `answers`, `prompter`, `help`, `jsonMode`, `verbosity`,
`isTTY`, and more. Every dimension of CLI behavior is controllable from tests.

## Package structure

Three subpath exports, each with a focused API surface:

| Import                     | Purpose                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `@kjanat/dreamcli`         | Schema builders, CLI runner, output, parsing, resolution, errors                       |
| `@kjanat/dreamcli/testkit` | `runCommand()`, `createCaptureOutput()`, `createTestPrompter()`, `createTestAdapter()` |
| `@kjanat/dreamcli/runtime` | `createAdapter()`, `RuntimeAdapter`, runtime detection, platform adapters              |

ESM-only. Source included in package (`src/`).

## Runtime support

| Runtime            | Status                              |
| ------------------ | ----------------------------------- |
| Node.js >= 22.22.2 | Supported                           |
| Bun >= 1.3.11      | Supported                           |
| Deno >= 2.6.0      | Supported (JSR: `@kjanat/dreamcli`) |

Runtime detection is automatic. The core framework never imports platform-specific APIs directly — a
thin `RuntimeAdapter` interface handles the divergent edges (argv, env, filesystem, TTY detection,
exit behavior).

## License

[MIT][LICENSE]

[LICENSE]: https://github.com/kjanat/dreamcli/blob/master/LICENSE
