# prompt: engines and sessions

Engines are pluggable. The resolver imports `index.ts` statically. Terminal and test engines load on first use.

## FILES

| File               | Role                                                          |
| ------------------ | ------------------------------------------------------------- |
| `index.ts`         | `PromptEngine`, `resolvePromptConfig()`                       |
| `definitions.ts`   | `Ask`, `InferPrompt`                                          |
| `session.ts`       | `createPromptSession()` for handlers and scripts              |
| `text.ts`          | shared text policy for terminal, scripted, and hosted prompts |
| `errors.ts`        | `PromptCancelledError`                                        |
| `terminal.ts`      | `createTerminalPrompter()`, line-based                        |
| `test-prompter.ts` | `createTestPrompter()`, `PROMPT_CANCEL`                       |

## ANTI-PATTERNS

- Do not re-export `terminal.ts` or `test-prompter.ts` from `index.ts`
- Do not open stdin in this module. Callers pass `ReadFn` and `WriteFn`
- Do not decide whether a prompt is allowed. CLI and resolve own that gate
- Do not import `schema/prompt.ts` through the schema barrel

## NOTES

- `feature-loaders.ts` exposes `loadPromptSession`, `loadTerminal`, and `loadTestPrompter`
- Choice lists are filled before the engine sees the config
- A string answer to `input` runs `config.validate`. A failing test answer cancels
- EOF from `ReadFn` cancels
- Consumers use `@kjanat/dreamcli/prompt`. Test helpers ship from `@kjanat/dreamcli/testkit`
