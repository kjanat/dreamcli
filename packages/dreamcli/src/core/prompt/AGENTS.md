# prompt — Prompt engines and test seams

## OVERVIEW

Prompting is a pluggable engine, not hard-wired terminal code. This module ships a terminal
implementation and a test prompter, and it receives already-resolved prompt configs from the
resolve layer.

## FILES

| File             | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `index.ts`       | `PromptEngine`, resolved prompt types, terminal and test prompters |
| `prompt.test.ts` | terminal behavior, test sentinel, resolved prompt guarantees       |

## WHERE TO LOOK

| Task                          | Location                               | Notes                                                    |
| ----------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Change engine contract        | `PromptEngine`, `ResolvedPromptConfig` | select and multiselect choices are guaranteed non-empty  |
| Change test prompts           | `createTestPrompter()`                 | queue-driven, supports malformed values and cancellation |
| Change terminal prompts       | `createTerminalPrompter()`             | line-based read/write seam, no raw mode                  |
| Change cancellation semantics | `PROMPT_CANCEL`                        | shared sentinel for test flows                           |

## CONVENTIONS

- This module imports `schema/prompt.ts` directly; the direct edge is intentional
- Prompt engines are stateless per `promptOne()` call
- Choice merging happens before the engine sees config; engines should not infer enum choices
  themselves
- `TestAnswer` stays `unknown` so downstream validation paths can be tested

## ANTI-PATTERNS

- Do not wire runtime stdin or stdout directly into callers; use injected `ReadFn` and `WriteFn`
- Do not add raw mode or terminal-specific state here unless all runtimes can support it cleanly
- Do not move non-TTY gating into the prompt engine; CLI and resolve decide when prompts are allowed

## NOTES

- EOF from `ReadFn` is treated as cancellation
- The terminal prompter is intentionally line-based for Node, Bun, and Deno portability
