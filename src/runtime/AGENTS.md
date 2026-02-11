# runtime — Platform abstraction layer

Multi-file module. Only place `vi.fn()` mocks are used (for mock process objects).

## FILES

| File                 | Status     | Purpose                                                 |
| -------------------- | ---------- | ------------------------------------------------------- |
| `adapter.ts`         | **Active** | `RuntimeAdapter` interface — process/env/IO abstraction |
| `auto.ts`            | **Active** | `createAdapter()` — auto-detecting adapter factory      |
| `node.ts`            | **Active** | `createNodeAdapter()` — Node.js implementation          |
| `bun.ts`             | **Active** | `createBunAdapter()` — delegates to Node adapter        |
| `deno.ts`            | STUB       | `export {}` — planned Deno adapter                      |
| `detect.ts`          | **Active** | `detectRuntime()` — Bun/Deno/Node feature detection     |
| `node-builtins.d.ts` | Types      | `@internal` — Node built-in type shims                  |
| `index.ts`           | Barrel     | Re-exports `RuntimeAdapter`, adapters, `ExitError`      |

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
5. Re-export from `src/index.ts`

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
- `createTestAdapter()` is public API — used by testkit and consumer tests
- `ExitError` thrown by `adapter.exit()` — caught by CLI dispatch layer
