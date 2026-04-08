# @kjanat/dreamcli/runtime

Runtime adapter factory and platform detection.

```ts twoslash
import {
  createAdapter,
  detectRuntime,
} from '@kjanat/dreamcli/runtime';
import type { RuntimeAdapter } from '@kjanat/dreamcli/runtime';
```

## `createAdapter()`

Create a runtime adapter via auto-detection.

```ts twoslash
import {
  createAdapter,
  createNodeAdapter,
  createBunAdapter,
  createDenoAdapter,
} from '@kjanat/dreamcli/runtime';

const adapter = createAdapter(); // auto-detect
const nodeAdapter = createNodeAdapter(); // explicit Node.js
const bunAdapter = createBunAdapter(); // explicit Bun
const denoAdapter = createDenoAdapter(); // explicit Deno
```

### RuntimeAdapter Interface

| Member           | Kind     | Description                                                                               |
| ---------------- | -------- | ----------------------------------------------------------------------------------------- |
| `argv`           | readonly | Raw command-line arguments                                                                |
| `env`            | readonly | Environment variables                                                                     |
| `cwd`            | readonly | Current working directory                                                                 |
| `stdout`         | readonly | Stdout writer used by the output channel                                                  |
| `stderr`         | readonly | Stderr writer used by the output channel                                                  |
| `stdin`          | readonly | Line reader used for interactive prompts                                                  |
| `readStdin()`    | method   | Read all piped stdin as a single string, or `null` when stdin is a TTY / no data is piped |
| `isTTY`          | readonly | Whether stdout is connected to a TTY                                                      |
| `stdinIsTTY`     | readonly | Whether stdin is connected to a TTY                                                       |
| `exit(code)`     | method   | Exit the process                                                                          |
| `readFile(path)` | method   | Read a UTF-8 file for config discovery                                                    |
| `homedir`        | readonly | User home directory                                                                       |
| `configDir`      | readonly | Platform-specific configuration directory                                                 |

## `detectRuntime()`

Detect the current runtime environment.

```ts twoslash
import { detectRuntime } from '@kjanat/dreamcli/runtime';
import type { Runtime } from '@kjanat/dreamcli/runtime';

const runtime: Runtime = detectRuntime();
//               ^?
```

## Supported Runtimes

| Runtime                 | Adapter       | Notes                          |
| ----------------------- | ------------- | ------------------------------ |
| Node.js >=\u00a022.22.2 | `NodeAdapter` | Full support                   |
| Bun >=\u00a01.3.11      | `BunAdapter`  | Delegates to Node adapter      |
| Deno >=\u00a02.6.0      | `DenoAdapter` | Permission-safe Deno namespace |

Adapter creation validates these minimum versions and throws immediately when the host runtime is too old.
