# runtime — Platform abstraction layer

## FILES

| File                 | Status     | Purpose                                                 |
| -------------------- | ---------- | ------------------------------------------------------- |
| `adapter.ts`         | **Active** | `RuntimeAdapter` interface — process/env/IO abstraction |
| `node.ts`            | **Active** | `createNodeAdapter()` — Node.js implementation          |
| `bun.ts`             | STUB       | `export {}` — planned Bun adapter                       |
| `deno.ts`            | STUB       | `export {}` — planned Deno adapter                      |
| `detect.ts`          | STUB       | `export {}` — planned runtime detection                 |
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
```

## ADDING A NEW PLATFORM

1. Implement `RuntimeAdapter` in `{platform}.ts`
2. Add factory `create{Platform}Adapter()` to barrel
3. Wire `isTTY` detection for the platform
4. Re-export from `src/index.ts`

## TEST FILES

Single file `runtime.test.ts` — covers Node adapter, test adapter, `ExitError`, adapter contract
verification. Uses `vi.fn()` for mock process objects (only place mocks are used).
