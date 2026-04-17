# Runtime Support

dreamcli runs on Node.js, Bun, and Deno without code changes.
A thin `RuntimeAdapter` interface abstracts the platform-specific edges.

## Supported Runtimes

| Runtime            | Status    | Package                  |
| ------------------ | --------- | ------------------------ |
| Node.js >= 22.22.2 | Supported | `@kjanat/dreamcli` (npm) |
| Bun >= 1.3         | Supported | `@kjanat/dreamcli` (npm) |
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
import {
  createAdapter,
  createNodeAdapter,
} from '@kjanat/dreamcli/runtime';

const adapter = createAdapter(); // auto-detect
const nodeAdapter = createNodeAdapter(); // explicit
```

## Deno Permissions

On Deno, the adapter handles permission-safe access to the Deno namespace.
If permissions are missing, features degrade gracefully with clear error messages.

```bash
deno run --allow-read --allow-env mycli.ts deploy
```

## Testing Runtime Seams

For command behavior tests, `runCommand()` is process-free and injects runtime state directly:

```ts twoslash
import { regionCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(regionCmd, [], {
  env: { MY_REGION: 'test' },
});
```

When you need adapter-level control (`argv`, filesystem reads, exit behavior), use
`createTestAdapter()` with `cli().run({ adapter })`.

## What's Next?

- [Testing](/guide/testing) — in-process test harness
- [Getting Started](/guide/getting-started) — installation per runtime
