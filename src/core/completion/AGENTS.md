# completion — Shell completion script generation

Split into per-shell generators under `shells/`. Barrel `index.ts` re-exports public API and
dispatches via `generateCompletion()`.

## FILES

| File                   | Lines | Purpose                                                  |
| ---------------------- | ----: | -------------------------------------------------------- |
| `index.ts`             |    80 | Barrel — `Shell` type, `SHELLS` constant, dispatch       |
| `shells/shared.ts`     |   160 | `CommandNode`, `walkCommandTree`, escaping, `versionTag` |
| `shells/bash.ts`       |   275 | `generateBashCompletion()` + all bash helpers            |
| `shells/zsh.ts`        |   280 | `generateZshCompletion()` + all zsh helpers              |
| `shells/fish.ts`       |    25 | Stub — throws `UNSUPPORTED_OPERATION`                    |
| `shells/powershell.ts` |    25 | Stub — throws `UNSUPPORTED_OPERATION`                    |

## PUBLIC API

| Symbol                     | Exported from | Role                                             |
| -------------------------- | ------------- | ------------------------------------------------ |
| `generateCompletion()`     | `index.ts`    | Shell-agnostic dispatch → per-shell generators   |
| `generateBashCompletion()` | `index.ts`    | Bash completion script from command tree         |
| `generateZshCompletion()`  | `index.ts`    | Zsh completion script from command tree          |
| `SHELLS`                   | `index.ts`    | `readonly ['bash', 'zsh', 'fish', 'powershell']` |
| `CompletionOptions`        | `index.ts`    | Options type (re-exported from `shared.ts`)      |
| `Shell`                    | `index.ts`    | Union type of supported shells                   |

## ARCHITECTURE

1. Walk command tree → `CommandNode[]` (shared infrastructure in `shells/shared.ts`)
2. Per-shell generator receives `CLISchema` + `CompletionOptions`, calls `walkCommandTree()`
3. Emit shell-specific functions (one per command node)
4. Bash: `complete -F` with `compgen`; Zsh: `_arguments` + `_describe`

Handles nested command groups: `mycli db migrate` generates completions for each depth level.

## INTERNAL HELPERS (all `@internal`)

### `shells/shared.ts`

- `versionTag()` — build-time version string for script headers
- `CommandNode` — flattened tree node with propagated flag context
- `walkCommandTree()` — depth-first command tree walker
- `sanitizeShellIdentifier()`, `quoteShellArg()` — shell escaping

### `shells/bash.ts`

- `emitBashPathDetection`, `quoteShellCasePattern` — subcommand path detection
- `escapeForSingleQuote`, `escapeBashDollarQuote` — bash string escaping
- `formatBashEnumCompletion` — COMPREPLY for enum values
- `collectFlagWords`, `collectEnumCasesFromFlags`, `EnumCase` — flag extraction

### `shells/zsh.ts`

- `emitZshGroupFunction`, `emitZshLeafFunction` — helper function emitters
- `escapeZshDescription`, `escapeZshEnumValue` — zsh string escaping
- `buildZshFlagSpecsFromFlags`, `buildZshFlagSpecs` — `_arguments` spec builders

## GOTCHAS

- `shells/shared.ts` imports `cli/propagate.ts` directly (`@internal` file, not through cli barrel)
  — needs `collectPropagatedFlags()` for flag inheritance in nested commands
- `biome-ignore noTemplateCurlyInString` in `shells/bash.ts` — emitting bash `${words[i]}` syntax
- Fish and PowerShell stubs throw `CLIError` with code `UNSUPPORTED_OPERATION`
- `CompletionOptions` lives in `shells/shared.ts`, re-exported through `index.ts`

## TEST FILES (2)

| File                    | Tests                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `completion.test.ts`    | ~1690 lines — largest test file; bash + zsh output matching |
| (cli-completion-e2e.ts) | Lives in `cli/` — end-to-end completion via CLI builder     |
