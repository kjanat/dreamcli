# Runtime Support

dreamcli runs on Node.js, Bun, and Deno without code changes.
A thin `RuntimeAdapter` interface abstracts the platform-specific edges.

## Supported Runtimes

| Runtime            | Status    | Package                  |
| ------------------ | --------- | ------------------------ |
| Node.js >= 22.22.2 | Supported | `dreamcli` (npm)         |
| Bun >= 1.3.11      | Supported | `dreamcli` (npm)         |
| Deno >= 2.6.0      | Supported | `@kjanat/dreamcli` (JSR) |

Adapters validate these minimum versions during creation.
Unsupported runtimes fail fast with a descriptive error before command execution starts.

## How It Works

The core framework never imports platform-specific APIs directly.
Instead, a `RuntimeAdapter` provides:

- `argv` — command-line arguments
- `env` — environment variables
- `cwd` — current working directory
- `stdin` — line reader for interactive prompts
- `readStdin` — full piped stdin reader for `.stdin()` arguments
- `exit` — process exit
- `isTTY` — terminal detection
- `stdinIsTTY` — interactive stdin detection
- `readFile` / `homedir` / `configDir` — filesystem access

Runtime detection is automatic — dreamcli picks the right adapter at startup.

## Explicit Adapter

```ts twoslash
import { createAdapter, createNodeAdapter } from '@kjanat/dreamcli/runtime';

const adapter = createAdapter(); // auto-detect
const nodeAdapter = createNodeAdapter(); // explicit
```

## Deno Permissions

On Deno, the adapter handles permission-safe access to the Deno namespace.
If permissions are missing, features degrade gracefully with clear error messages.

```bash
deno run --allow-read --allow-env mycli.ts deploy
```

## Testing with Adapters

The test harness uses a built-in test adapter that doesn't touch real process state:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { cmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(cmd, ['--flag', 'value'], {
  env: { MY_VAR: 'test' },
  // Uses test adapter internally — no real process access
});
```

## What's Next?

- [Testing](/guide/testing) — in-process test harness
- [Getting Started](/guide/getting-started) — installation per runtime
