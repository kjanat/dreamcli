# testkit — In-process test harness (public API)

Not just test utilities — first-class module exported from the package. Testkit symbols are
re-exported from the `dreamcli/testkit` subpath (curating barrel at `src/testkit.ts`). This internal
`core/testkit/` module is unchanged.

## CORE API

**`runCommand(cmd, argv, options?): Promise<RunResult>`**

Thin in-process wrapper over the shared executor: create capture output, forward injected execution
options, and return captured output. Shared executor code owns parse → resolve → middleware → action
semantics and calls `out.stopActive()` for cleanup.

**`RunResult`** (defined in `schema/run.ts`, re-exported here):
`{ exitCode, stdout: string[], stderr: string[], activity: ActivityEvent[], error? }`

**`RunOptions`** — the injectable testing seam:

| Option      | Purpose                                           |
| ----------- | ------------------------------------------------- |
| `env`       | `Record<string, string>` — replaces `process.env` |
| `config`    | JSON config object                                |
| `answers`   | `Record<string, TestAnswer>` — prompt responses   |
| `prompter`  | Full `PromptEngine` override                      |
| `verbosity` | `'normal' \| 'quiet'`                             |
| `jsonMode`  | boolean — enable JSON output                      |
| `isTTY`     | boolean — simulate TTY                            |
| `help`      | `HelpOptions` — help formatting (width, binName)  |

## TEST FILES (7)

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
- Type testing: `expectTypeOf(ctx).toEqualTypeOf<Readonly<...>>()` in middleware E2E

## GOTCHAS

- `mergedSchema` field on `RunOptions` is `@internal` — used by CLI dispatch layer only
- `CaptureOutputChannel` (from output/) wired here for output + activity capture
- `formatRootHelp()` (in `cli/root-help.ts`) re-exported as `@internal` for CLI-level help rendering
- Direct imports: `schema/command.ts`, `schema/flag.ts`, `schema/arg.ts` (not through barrel)
