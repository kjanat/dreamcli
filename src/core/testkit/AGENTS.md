# testkit — In-process test harness (public API)

Not just test utilities — first-class module exported from the package.

## CORE API

**`runCommand(cmd, argv, options?): Promise<RunResult>`**

Complete execution pipeline in-process: argv → parse → resolve → middleware chain → action handler →
captured output

**`RunResult`**:
`{ exitCode, stdout: string[], stderr: string[], activity: ActivityEvent[], error? }`

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
| `help`      | `HelpOptions` — help formatting (width, binName)  |

## TEST FILES (8)

| File                             | Tests                                         |
| -------------------------------- | --------------------------------------------- |
| `testkit.test.ts`                | Core `runCommand()` behavior                  |
| `testkit-json.test.ts`           | JSON mode output                              |
| `testkit-tty.test.ts`            | TTY detection + behavior                      |
| `testkit-prompt.test.ts`         | Prompt resolution via answers                 |
| `testkit-nesting.test.ts`        | Nested command dispatch via testkit           |
| `output-e2e.test.ts`             | Full pipeline: output modes x verbosity x CLI |
| `middleware-context-e2e.test.ts` | Middleware composition + context typing       |

## ASSERTIONS

- Output arrays include trailing `\n` — assert `['Hello\n']` not `['Hello']`
- JSON output: `JSON.parse(result.stdout[0] ?? '')` then `toEqual`
- Error checking: `result.error?.code` for structured errors
- Activity events: `result.activity` array of `ActivityEvent` discriminated unions
- Type testing: `expectTypeOf(ctx).toEqualTypeOf<Readonly<…>>()` in middleware E2E

## GOTCHAS

- `mergedSchema` field on `RunOptions` is `@internal` — used by CLI dispatch layer only
- `CaptureOutputChannel` (from output/) wired here for output + activity capture
- `formatRootHelp()` re-exported as `@internal` for CLI-level help rendering
