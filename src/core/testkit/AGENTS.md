# testkit — In-process test harness (public API)

Not just test utilities — this is a first-class module exported from the package.

## CORE API

**`runCommand(cmd, argv, options?): Promise<RunResult>`**

Complete execution pipeline in-process: argv → parse → resolve → middleware chain → action handler →
captured output

**`RunResult`**: `{ exitCode, stdout: string[], stderr: string[], error? }`

**`RunOptions`** — the injectable testing seam:

| Option      | Purpose                                           |
| ----------- | ------------------------------------------------- |
| `env`       | `Record<string, string>` — replaces `process.env` |
| `config`    | JSON config object                                |
| `answers`   | `TestAnswer[]` — pre-configured prompt responses  |
| `prompter`  | Full `PromptEngine` override                      |
| `verbosity` | `'normal' \| 'quiet'`                             |
| `jsonMode`  | boolean — enable JSON output                      |
| `isTTY`     | boolean — simulate TTY                            |

## TEST FILES

| File                             | Tests                                         |
| -------------------------------- | --------------------------------------------- |
| `testkit.test.ts`                | Core `runCommand()` behavior                  |
| `testkit-json.test.ts`           | JSON mode output                              |
| `testkit-tty.test.ts`            | TTY detection + behavior                      |
| `testkit-prompt.test.ts`         | Prompt resolution via answers                 |
| `output-e2e.test.ts`             | Full pipeline: output modes × verbosity × CLI |
| `middleware-context-e2e.test.ts` | Middleware composition + context typing       |

## ASSERTIONS

- Output arrays include trailing `\n` — assert `['Hello\n']` not `['Hello']`
- JSON output: `JSON.parse(result.stdout[0] ?? '')` then `toEqual`
- Error checking: `result.error?.code` for structured errors
- Type testing: `expectTypeOf(ctx).toEqualTypeOf<Readonly<…>>()` in middleware E2E
