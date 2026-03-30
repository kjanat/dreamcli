# Arguments

Positional arguments are declared with `arg` and appear after the command name.

## Argument Types

```ts
import { arg } from 'dreamcli';

arg.string(); // string
arg.number(); // number
arg.enum(['dev', 'staging', 'prod']); // "dev" | "staging" | "prod"
arg.custom((v) => new URL(v)); // URL
```

## Declaration

```ts
command('deploy')
	.arg('target', arg.string().describe('Deploy target'))
	.arg('version', arg.string().describe('Version tag').optional())
	.action(({ args }) => {
		args.target; // string (required)
		args.version; // string | undefined (optional)
	});
```

Arguments are positional — order matters:

```bash
$ mycli deploy production v1.2.3
#              ^^^^^^^^^^ ^^^^^^
#              target     version
```

## Required vs Optional

Arguments are required by default. Use `.optional()` to make them optional:

```ts
// Required — must be provided
arg.string();

// Optional — may be omitted
arg.string().optional();
```

## Variadic Arguments

The last argument can be variadic, collecting all remaining positional values:

```ts
command('copy')
	.arg('files', arg.string().variadic().describe('Files to copy'))
	.action(({ args }) => {
		args.files; // string[]
	});
```

```bash
$ mycli copy a.txt b.txt c.txt
# args.files = ['a.txt', 'b.txt', 'c.txt']
```

## What's Next?

- [Flags](/guide/flags) — flag types and resolution chain
- [Output](/guide/output) — structured output channel
