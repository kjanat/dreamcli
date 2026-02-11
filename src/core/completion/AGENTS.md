# completion — Shell completion script generation

Single file: `index.ts` (~786 lines). Heavy `@internal` usage (18 symbols).

## PUBLIC API

| Symbol                     | Role                                             |
| -------------------------- | ------------------------------------------------ |
| `generateCompletion()`     | Shell-agnostic dispatch → bash/zsh generators    |
| `generateBashCompletion()` | Bash completion script from command tree         |
| `generateZshCompletion()`  | Zsh completion script from command tree          |
| `SHELLS`                   | `readonly ['bash', 'zsh', 'fish', 'powershell']` |
| `CompletionOptions`        | Options type (shell, binary name)                |
| `Shell`                    | Union type of supported shells                   |

## ARCHITECTURE

1. Walk command tree → `CommandNode[]` (internal tree representation)
2. Collect flag words + enum cases per command
3. Emit shell-specific functions (one per command node)
4. Bash: `complete -F` with `compgen`; Zsh: `_arguments` + `compadd`

Handles nested command groups: `mycli db migrate` generates completions for each depth level.

## INTERNAL HELPERS (all `@internal`)

- Tree walking: `CommandNode`, `EnumCase`, `walkCommandTree`
- Bash: `emitBashPathDetection`, `formatBashEnumCompletion`, `collectFlagWords`,
  `collectEnumCasesFromFlags`
- Zsh: `buildZshFlagSpecs`, `emitZshGroupFunction`, `emitZshLeafFunction`
- Shell escaping (6 functions): `escapeBashDollarQuote`, `escapeForSingleQuote`,
  `escapeZshDescription`, `escapeZshEnumValue`, `quoteShellArg`, `sanitizeShellIdentifier`

## GOTCHAS

- Imports `cli/propagate.ts` directly (`@internal` file, not through cli barrel) — needs
  `collectPropagatedFlags()` for flag inheritance in nested commands
- `biome-ignore noTemplateCurlyInString` on line ~204 — emitting bash `${words[i]}` syntax, not JS
- Fish and PowerShell shells declared in `SHELLS` but not yet implemented
- Natural split candidate (bash ~180 lines, zsh ~180 lines, shared infra) but single file works

## TEST FILES (2)

| File                    | Tests                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `completion.test.ts`    | ~1690 lines — largest test file; bash + zsh output matching |
| (cli-completion-e2e.ts) | Lives in `cli/` — end-to-end completion via CLI builder     |
