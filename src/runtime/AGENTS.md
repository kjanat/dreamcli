# runtime: platform adapters

Host I/O lives here. Core receives a `RuntimeAdapter`. This directory imports `WriteFn` from `core/output/writer.ts` and `ReadFn` from `core/prompt/`.

`src/runtime.ts` re-exports `RuntimeAdapter`, the factories, `ExitError`, and detection on `@kjanat/dreamcli/runtime`. `createTestAdapter` is testkit-only.

## FILES

| File                 | Role                                                   |
| -------------------- | ------------------------------------------------------ |
| `adapter.ts`         | `RuntimeAdapter`                                       |
| `auto.ts`            | `createAdapter()`                                      |
| `node.ts`            | `createNodeAdapter()`, also the Bun path               |
| `deno.ts`            | `createDenoAdapter()`                                  |
| `detect.ts`          | `detectRuntime()`                                      |
| `input.ts`           | shared line and secret reader                          |
| `config-module.ts`   | native config module import, worker fallback           |
| `paths.ts`           | XDG and platform directories                           |
| `support.ts`         | feature probes                                         |
| `node-builtins.d.ts` | ambient module types. Check `node.ts` for live imports |
| `index.ts`           | barrel                                                 |

## ADDING A PLATFORM

1. Implement `RuntimeAdapter` in `{platform}.ts`
2. Export `create{Platform}Adapter()` from the barrel and from `src/runtime.ts`
3. Add a case in `detect.ts` and `auto.ts`

## ANTI-PATTERNS

- Do not treat `node-builtins.d.ts` as the import list. It still declares `node:readline`, `node:fs/promises`, and `node:url` after callers move on
- Do not enumerate `adapter.env` under a partial Deno grant. The env proxy reads granted names one at a time and lists no keys
- Do not `write()` stdout from the Deno adapter. `WriteFn` is synchronous. Use `writeSync`

## NOTES

- `adapter.exit()` throws `ExitError`. CLI dispatch catches it
- Empty-string env fallbacks are unset in `node.ts`
- Deno argv has no binary. The adapter prepends `['deno', 'run']`
- `deno-permissions.test.ts` spawns Deno. Under Deno that spawn uses `Deno.Command`. `node:child_process` rewrites a spawn of Deno's executable into `deno run -A`
- `globalThis as unknown as GlobalForDetect` in `detect.ts` is the detection boundary
