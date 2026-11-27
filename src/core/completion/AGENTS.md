# completion: shell scripts and dynamic values

`shell.ts` is the hot-path module: `Shell`, `SHELLS`, `normalizeShell`, `detectShell`. Generators and dynamic completion stay behind `feature-loaders.ts`.

## FILES

| File                                                   | Role                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `shell.ts`                                             | shell targets. `cli/` and `planner.ts` import this file    |
| `index.ts`                                             | `generateCompletion()` and per-shell generators            |
| `dynamic.ts`                                           | `completeRequest()`, callbacks without running the handler |
| `shells/shared.ts`                                     | `walkCommandTree()`, escaping, propagated flags            |
| `shells/bash.ts`, `zsh.ts`, `fish.ts`, `powershell.ts` | script emitters                                            |

`SHELLS` is `bash`, `zsh`, `fish`, `powershell`.

## ANTI-PATTERNS

- Do not static-import `index.ts`, `dynamic.ts`, or `shells/*` from `cli/`. `loadCompletion` and `loadDynamicCompletion` are the entries
- Do not import `cli/propagate.ts` through the cli barrel. `shells/shared.ts` imports that file for inherited flags
- Do not treat Fish or PowerShell as stubs. Both generators have tests, including `powershell-native.test.ts` and `examples/pwsh-demo`

## NOTES

- `schema/completion.ts` holds the callback context. This directory turns a command tree into a script and resolves those callbacks
- Bash script strings contain `${words[i]}`. The `biome-ignore noTemplateCurlyInString` in `shells/bash.ts` stays
- Consumers use `@kjanat/dreamcli/completion`
