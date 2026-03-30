# Runtime Support

dreamcli runs on Node.js, Bun, and Deno without code changes. A thin `RuntimeAdapter` interface
abstracts the platform-specific edges.

## Supported Runtimes

| Runtime       | Status    | Package                  |
| ------------- | --------- | ------------------------ |
| Node.js >= 22 | Supported | `dreamcli` (npm)         |
| Bun >= 1.3    | Supported | `dreamcli` (npm)         |
| Deno >= 2.6   | Supported | `@kjanat/dreamcli` (JSR) |

## How It Works

The core framework never imports platform-specific APIs directly. Instead, a `RuntimeAdapter`
provides:

- `argv` — command-line arguments
- `env` — environment variables
- `cwd` — current working directory
- `exit` — process exit
- `isTTY` — terminal detection
- `readFile` / `homedir` / `configDir` — filesystem access

Runtime detection is automatic — dreamcli picks the right adapter at startup.

## Explicit Adapter

```ts
import { createAdapter } from 'dreamcli/runtime';

const adapter = createAdapter('node');
// or 'bun', 'deno', 'auto' (default)
```

## Deno Permissions

On Deno, the adapter handles permission-safe access to the Deno namespace. If permissions are
missing, features degrade gracefully with clear error messages.

```bash
deno run --allow-read --allow-env mycli.ts deploy
```

## Testing with Adapters

The test harness uses a built-in test adapter that doesn't touch real process state:

```ts
import { runCommand } from 'dreamcli/testkit';

const result = await runCommand(cmd, ['--flag', 'value'], {
	env: { MY_VAR: 'test' },
	// Uses test adapter internally — no real process access
});
```

## What's Next?

- [Testing](/guide/testing) — in-process test harness
- [Getting Started](/guide/getting-started) — installation per runtime
