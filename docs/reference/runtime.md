# dreamcli/runtime

Runtime adapter factory and platform detection.

```ts
import { createAdapter, detectRuntime } from 'dreamcli/runtime';
import type { RuntimeAdapter } from 'dreamcli/runtime';
```

## `createAdapter(runtime?)`

Create a runtime adapter for the specified platform.

```ts
const adapter = createAdapter(); // auto-detect
const adapter = createAdapter('node'); // explicit
const adapter = createAdapter('bun');
const adapter = createAdapter('deno');
```

### RuntimeAdapter Interface

| Method           | Description                        |
| ---------------- | ---------------------------------- |
| `argv()`         | Command-line arguments             |
| `env()`          | Environment variables              |
| `cwd()`          | Current working directory          |
| `exit(code)`     | Exit the process                   |
| `isTTY()`        | Whether stdin/stdout is a TTY      |
| `readFile(path)` | Read a file (for config discovery) |
| `homedir()`      | User home directory                |
| `configDir()`    | XDG config directory               |

## `detectRuntime()`

Detect the current runtime environment.

```ts
const runtime = detectRuntime();
// 'node' | 'bun' | 'deno'
```

## Supported Runtimes

| Runtime       | Adapter       | Notes                          |
| ------------- | ------------- | ------------------------------ |
| Node.js >= 22 | `NodeAdapter` | Full support                   |
| Bun >= 1.3    | `BunAdapter`  | Delegates to Node adapter      |
| Deno >= 2.6   | `DenoAdapter` | Permission-safe Deno namespace |
