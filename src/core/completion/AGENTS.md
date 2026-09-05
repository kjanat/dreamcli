# completion — Shell completion script generation

Split into per-shell generators under `shells/`. `shell.ts` holds the shell targets and token
handling the CLI builder and planner need on the hot path; `index.ts` re-exports it and adds the
generators. The builder loads `index.ts` with a dynamic import, and consumers reach it through the
`@kjanat/dreamcli/completion` subpath.

## FILES

| File                   | Lines | Purpose                                                  |
| ---------------------- | ----: | -------------------------------------------------------- |
| `shell.ts`             |    80 | `Shell` type, `SHELLS`, `normalizeShell`, `detectShell`  |
| `index.ts`             |    60 | Generators plus `generateCompletion()` dispatch          |
| `shells/shared.ts`     |   327 | `CommandNode`, `walkCommandTree`, escaping, `versionTag` |
| `shells/bash.ts`       |   466 | `generateBashCompletion()` + all bash helpers            |
| `shells/zsh.ts`        |   388 | `generateZshCompletion()` + all zsh helpers              |
| `shells/fish.ts`       |   266 | `generateFishCompletion()` + fish path scanner helpers   |
| `shells/powershell.ts` |   447 | `generatePowerShellCompletion()` + metadata helpers      |

## PUBLIC API

| Symbol                           | Exported from | Role                                             |
| -------------------------------- | ------------- | ------------------------------------------------ |
| `generateCompletion()`           | `index.ts`    | Shell-agnostic dispatch -> per-shell generators  |
| `generateBashCompletion()`       | `index.ts`    | Bash completion script from command tree         |
| `generateZshCompletion()`        | `index.ts`    | Zsh completion script from command tree          |
| `generateFishCompletion()`       | `index.ts`    | Fish completion script from command tree         |
| `generatePowerShellCompletion()` | `index.ts`    | PowerShell completion script from command tree   |
| `SHELLS`                         | `shell.ts`    | `readonly ['bash', 'zsh', 'fish', 'powershell']` |
| `CompletionOptions`              | `shell.ts`    | Options type (re-exported from `shared.ts`)      |
| `Shell`                          | `shell.ts`    | Union type of supported shells                   |

## ARCHITECTURE

1. Walk command tree -> `CommandNode[]` (shared infrastructure in `shells/shared.ts`)
2. Per-shell generator receives `CLISchema` + `CompletionOptions`, calls `walkCommandTree()`
3. Emit shell-specific functions (one per command node)
4. Bash: `complete -F` with `compgen`; Zsh: `_arguments` + `_describe`

Handles nested command groups: `mycli db migrate` generates completions for each depth level.

## GOTCHAS

- `shells/shared.ts` imports `cli/propagate.ts` directly (`@internal` file, not through cli barrel)
  — needs `collectPropagatedFlags()` for flag inheritance in nested commands
- `biome-ignore noTemplateCurlyInString` in `shells/bash.ts` — emitting bash `${words[i]}` syntax
- Fish and PowerShell generators are fully implemented and tested
- `CompletionOptions` lives in `shells/shared.ts`, re-exported through `shell.ts` and `index.ts`
- Nothing on the hot path may import `index.ts` or `shells/*` statically; `cli/index.ts` and
  `cli/planner.ts` import `shell.ts` and reach the generators with `await import(...)`

## TEST FILES (2)

| File                             | Tests                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| `completion.test.ts`             | ~2400 lines — largest test file; bash/zsh/fish/powershell output matching |
| `completion-test-helpers.ts`     | Helper utilities for completion script extraction                         |
| (cli/cli-completion-e2e.test.ts) | Lives in `cli/` — end-to-end completion via CLI builder                   |
