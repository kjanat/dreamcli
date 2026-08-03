# runtime — Platform abstraction layer

Multi-file module. Not truly independent of core — imports `WriteFn` from `core/output/` and
`ReadFn` from `core/prompt/`.

Runtime symbols re-exported from `dreamcli/runtime` subpath (`src/runtime.ts`): `RuntimeAdapter`,
adapter factories, `ExitError`, detection. `createTestAdapter`/`TestAdapterOptions` are testkit-only
(exported from `dreamcli/testkit`, not `dreamcli/runtime`).

## FILES

| File                 | Status      | Lines | Purpose                                                             |
| -------------------- | ----------- | ----: | ------------------------------------------------------------------- |
| `adapter.ts`         | **Active**  |   398 | `RuntimeAdapter` interface — process/env/IO abstraction             |
| `auto.ts`            | **Active**  |    87 | `createAdapter()` — auto-detecting adapter factory                  |
| `node.ts`            | **Active**  |   373 | `createNodeAdapter()` — Node.js impl (also used for Bun)            |
| `deno.ts`            | **Active**  |   446 | `createDenoAdapter()` — Deno namespace implementation               |
| `detect.ts`          | **Active**  |   105 | `detectRuntime()` — Bun/Deno/Node feature detection                 |
| `paths.ts`           | `@internal` |    64 | XDG/platform path resolution utilities                              |
| `support.ts`         | `@internal` |    77 | Runtime feature support detection                                   |
| `test-helpers.ts`    | Test        |    41 | Test adapter helpers (Deno namespace mock, etc.)                    |
| `node-builtins.d.ts` | Types       |    27 | `@internal` — ambient decls for `node:readline`, `node:fs/promises` |
| `index.ts`           | Barrel      |    20 | Re-exports `RuntimeAdapter`, adapters, `ExitError`                  |

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

## TEST FILES (6)

| File                         | Tests                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| `runtime.test.ts`            | Node adapter, test adapter, `ExitError`, adapter contract      |
| `detect.test.ts`             | Runtime detection logic (globalThis feature probing)           |
| `deno.test.ts`               | Deno adapter (mock namespace, permission handling, stdin)      |
| `auto.test.ts`               | Auto-detecting adapter factory                                 |
| `support.test.ts`            | Runtime feature support detection                              |
| `adapter-resolution.test.ts` | One resolution driven through the Node, Bun, and Deno adapters |

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
