# runtime — Platform abstraction layer

Multi-file module. Not truly independent of core — imports `WriteFn` from `core/output/` and
`ReadFn` from `core/prompt/`.

Runtime symbols re-exported from `dreamcli/runtime` subpath (`src/runtime.ts`): `RuntimeAdapter`,
adapter factories, `ExitError`, detection. `createTestAdapter`/`TestAdapterOptions` are testkit-only
(exported from `dreamcli/testkit`, not `dreamcli/runtime`).

## FILES

| File                 | Status     | Lines | Purpose                                                             |
| -------------------- | ---------- | ----: | ------------------------------------------------------------------- |
| `adapter.ts`         | **Active** |   120 | `RuntimeAdapter` interface — process/env/IO abstraction             |
| `auto.ts`            | **Active** |    35 | `createAdapter()` — auto-detecting adapter factory                  |
| `node.ts`            | **Active** |   230 | `createNodeAdapter()` — Node.js implementation                      |
| `bun.ts`             | **Active** |    20 | `createBunAdapter()` — delegates to Node adapter                    |
| `deno.ts`            | STUB       |     4 | `export {}` — planned Deno adapter                                  |
| `detect.ts`          | **Active** |    90 | `detectRuntime()` — Bun/Deno/Node feature detection                 |
| `node-builtins.d.ts` | Types      |    45 | `@internal` — ambient decls for `node:readline`, `node:fs/promises` |
| `index.ts`           | Barrel     |    30 | Re-exports `RuntimeAdapter`, adapters, `ExitError`                  |

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

## TEST FILES (4)

| File              | Tests                                                     |
| ----------------- | --------------------------------------------------------- |
| `runtime.test.ts` | Node adapter, test adapter, `ExitError`, adapter contract |
| `detect.test.ts`  | Runtime detection logic (globalThis feature probing)      |
| `bun.test.ts`     | Bun adapter delegation                                    |
| `auto.test.ts`    | Auto-detecting adapter factory                            |

## GOTCHAS

- `globalThis as unknown as GlobalForDetect` in `detect.ts` — runtime boundary, justified cast
- `node.ts` has 7 `@internal` symbols: `NodeProcess`, `NodeSystemError`, `getNodeProcess`,
  `isNodeSystemError`, `createNodeReadLine`, `resolveHomedir`, `resolveConfigDir`
- `createTestAdapter()` exported from `dreamcli/testkit` only, not `dreamcli/runtime`
- `ExitError` thrown by `adapter.exit()` — caught by CLI dispatch layer
- Empty-string env var fallbacks treated as unset in `node.ts`
- Win32 paths: `resolveConfigDir` strips trailing separator, `resolveHomedir` has
  `HOMEDRIVE`+`HOMEPATH` fallback
