# @kjanat/dreamcli/runtime

Runtime adapter factory and platform detection.

```ts twoslash
import {
  createAdapter,
  detectRuntime,
} from '@kjanat/dreamcli/runtime';
import type { RuntimeAdapter, TerminalSize } from '@kjanat/dreamcli/runtime';
```

## `createAdapter()`

Create a runtime adapter via auto-detection.

```ts twoslash
import {
  createAdapter,
  createNodeAdapter,
  createDenoAdapter,
} from '@kjanat/dreamcli/runtime';

const adapter = createAdapter(); // auto-detect
const nodeAdapter = createNodeAdapter(); // explicit Node.js (also used for Bun)
const denoAdapter = createDenoAdapter(); // explicit Deno
```

> Bun exposes a Node-compatible `process`, so it uses the Node adapter — there is no separate Bun factory. Runtime detection still reports `'bun'` (see [`detectRuntime()`](#detectruntime)).

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
| `getTerminalSize()` | method | Read current stdout terminal dimensions, or `undefined` when unavailable                  |
| `onTerminalResize(listener)` | method | Subscribe to terminal resize events when supported                                |
| `exit(code)`     | method   | Exit the process                                                                          |
| `readFile(path)` | method   | Read a UTF-8 file for config discovery                                                    |
| `homedir`        | readonly | User home directory                                                                       |
| `configDir`      | readonly | Platform-specific configuration directory                                                 |

`TerminalSize` is `{ columns: number; rows: number }`. Node and Bun read `process.stdout.getWindowSize()` when available, falling back to `columns` / `rows`. Deno uses `Deno.consoleSize()`.

## `detectRuntime()`

Detect the current runtime environment.

```ts twoslash
import { detectRuntime } from '@kjanat/dreamcli/runtime';
import type { Runtime } from '@kjanat/dreamcli/runtime';

const runtime: Runtime = detectRuntime();
//               ^?
```

## Supported Runtimes

| Runtime            | Adapter       | Notes                          |
| ------------------ | ------------- | ------------------------------ |
| Node.js >= 22.22.2 | `NodeAdapter` | Full support                   |
| Bun >= 1.3         | `NodeAdapter` | Uses Node-compatible `process` |
| Deno >= 2.6.0      | `DenoAdapter` | Permission-safe Deno namespace |

These minimums are the tested support floor, declared in the package `engines` field. Adapter creation does not validate the runtime version or throw: as a dependency the package manager enforces `engines` at install time, and when DreamCLI is bundled the consuming CLI owns its supported-runtime policy.
