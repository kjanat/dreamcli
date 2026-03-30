# Flags

Flags are the richest primitive in dreamcli. Each flag declaration configures parsing, type
inference, resolution, help text, and shell completions.

## Flag Types

```ts
import { flag } from 'dreamcli';

flag.string(); // string | undefined
flag.number(); // number | undefined
flag.boolean(); // boolean (defaults to false)
flag.enum(['us', 'eu', 'ap']); // "us" | "eu" | "ap" | undefined
flag.array(flag.string()); // string[] | undefined
flag.custom((v) => new URL(v)); // URL | undefined
```

## Modifiers

Every flag type supports the same modifier chain:

```ts
flag
	.string()
	.alias('r') // short alias: -r
	.describe('Target region') // help text
	.default('us') // default value (narrows type)
	.required() // must resolve or error
	.env('DEPLOY_REGION') // resolve from env var
	.config('deploy.region') // resolve from config file
	.prompt({ kind: 'input', message: 'Region?' }) // interactive fallback
	.deprecated('Use --target instead') // deprecation warning
	.propagate(); // inherit in subcommands
```

## Resolution Chain

Each flag resolves through an ordered pipeline. Every step is opt-in:

```
CLI argv  →  environment variable  →  config file  →  interactive prompt  →  default value
```

The first source that provides a value wins. Required flags that don't resolve produce a structured
error before the action handler runs.

### Example

```ts
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

```ts
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

```ts
flag.custom((value) => {
	const url = new URL(value);
	if (url.protocol !== 'https:') {
		throw new Error('URL must use HTTPS');
	}
	return url;
});
```

The parse function receives the raw string value and returns the parsed type. Thrown errors become
validation errors with the flag name in context.

## Propagation

Flags marked with `.propagate()` are inherited by all subcommands:

```ts
cli('mycli').command(
	command('deploy').flag('verbose', flag.boolean().alias('v').propagate()).command(nested), // also gets --verbose
);
```

## What's Next?

- [Arguments](/guide/arguments) — positional argument types
- [Config Files](/guide/config) — config file resolution
- [Interactive Prompts](/guide/prompts) — prompt integration
