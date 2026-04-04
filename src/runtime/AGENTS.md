# runtime — Platform abstraction layer

Multi-file module. Not truly independent of core — imports `WriteFn` from `core/output/` and
`ReadFn` from `core/prompt/`.

Runtime symbols re-exported from `dreamcli/runtime` subpath (`src/runtime.ts`): `RuntimeAdapter`,
adapter factories, `ExitError`, detection. `createTestAdapter`/`TestAdapterOptions` are testkit-only
(exported from `dreamcli/testkit`, not `dreamcli/runtime`).

## FILES

| File                 | Status      | Lines | Purpose                                                             |
| -------------------- | ----------- | ----: | ------------------------------------------------------------------- |
| `adapter.ts`         | **Active**  |   300 | `RuntimeAdapter` interface — process/env/IO abstraction             |
| `auto.ts`            | **Active**  |   110 | `createAdapter()` — auto-detecting adapter factory                  |
| `node.ts`            | **Active**  |   278 | `createNodeAdapter()` — Node.js implementation                      |
| `bun.ts`             | **Active**  |    55 | `createBunAdapter()` — delegates to Node adapter                    |
| `deno.ts`            | **Active**  |   355 | `createDenoAdapter()` — Deno namespace implementation               |
| `detect.ts`          | **Active**  |   102 | `detectRuntime()` — Bun/Deno/Node feature detection                 |
| `paths.ts`           | `@internal` |    56 | XDG/platform path resolution utilities                              |
| `support.ts`         | `@internal` |   119 | Runtime feature support detection                                   |
| `test-helpers.ts`    | Test        |    40 | Test adapter helpers (Deno namespace mock, etc.)                    |
| `node-builtins.d.ts` | Types       |    23 | `@internal` — ambient decls for `node:readline`, `node:fs/promises` |
| `index.ts`           | Barrel      |    21 | Re-exports `RuntimeAdapter`, adapters, `ExitError`                  |

## `RuntimeAdapter` INTERFACE

```
argv: string[]
env: Record<string, string | undefined>
cwd: string
stdout: WriteFn
stderr: WriteFn
stdin: ReadFn
exit(code: number): never
isTTY: boolean
stdinIsTTY: boolean
homedir(): string
configDir(appName: string): string
readFile(path: string): Promise<string>
joinPath(...segments: string[]): string
```

## ADDING A NEW PLATFORM

1. Implement `RuntimeAdapter` in `{platform}.ts`
2. Add factory `create{Platform}Adapter()` to barrel
3. Add detection case in `detect.ts`
4. Wire auto-detection in `auto.ts`
5. Re-export from `src/runtime.ts`

## TEST FILES (5)

| File              | Tests                                                     |
| ----------------- | --------------------------------------------------------- |
| `runtime.test.ts` | Node adapter, test adapter, `ExitError`, adapter contract |
| `detect.test.ts`  | Runtime detection logic (globalThis feature probing)      |
| `bun.test.ts`     | Bun adapter delegation                                    |
| `deno.test.ts`    | Deno adapter (mock namespace, permission handling, stdin) |
| `auto.test.ts`    | Auto-detecting adapter factory                            |
| `support.test.ts` | Runtime feature support detection                         |

## GOTCHAS

- `globalThis as unknown as GlobalForDetect` in `detect.ts` — runtime boundary, justified cast
- `createTestAdapter()` exported from `dreamcli/testkit` only, not `dreamcli/runtime`
- `ExitError` thrown by `adapter.exit()` — caught by CLI dispatch layer
- Empty-string env var fallbacks treated as unset in `node.ts`
- Win32 paths: `resolveConfigDir` strips trailing separator, `resolveHomedir` has
  `HOMEDRIVE`+`HOMEPATH` fallback
- `deno.ts`: Deno.args pre-strips binary/script — adapter prepends synthetic `['deno', 'run']`
- Permission-safe: env/cwd catch `PermissionDenied`, readFile returns null for both `NotFound` and
  `PermissionDenied`
- `paths.ts` centralizes XDG config/data/cache path logic used by both Node and Deno adapters
- `support.ts` detects feature availability (stdin readability, TTY support) across runtimes
