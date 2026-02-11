# output — OutputChannel, spinner/progress, TTY rendering

Three files: `writer.ts` (leaf, ~30 lines), `activity.ts` (handle classes, ~581 lines), `index.ts`
(OutputChannel + factories, ~570 lines).

Dependency graph (no cycles): `writer.ts` ← `activity.ts` ← `index.ts` → `writer.ts`.

## KEY TYPES

| Symbol                  | Visibility  | Role                                             |
| ----------------------- | ----------- | ------------------------------------------------ |
| `createOutput()`        | **Public**  | Factory → `Out` interface (mode-dispatched)      |
| `createCaptureOutput()` | **Public**  | Factory → `Out` + `CapturedOutput` (for testkit) |
| `OutputChannel`         | `@internal` | Concrete class implementing `Out`                |
| `CaptureOutputChannel`  | `@internal` | Subclass capturing output + activity events      |

## OUTPUT MODES

| Mode    | `out.log`  | `out.json` | Spinner/Progress |
| ------- | ---------- | ---------- | ---------------- |
| Normal  | → stdout   | → stdout   | TTY handles      |
| JSON    | → stderr   | → stdout   | Noop handles     |
| Quiet   | suppressed | → stdout   | Noop handles     |
| Non-TTY | → stdout   | → stdout   | Static handles   |
| Capture | → array    | → array    | Capture handles  |

## ACTIVITY HANDLES

Four handle tiers per activity type (spinner + progress):

| Handle class           | When used  | Behavior                                      |
| ---------------------- | ---------- | --------------------------------------------- |
| `noopSpinnerHandle`    | JSON/quiet | Silent, all methods no-op                     |
| `StaticSpinnerHandle`  | non-TTY    | Writes start/succeed/fail as plain text lines |
| `TTYSpinnerHandle`     | TTY        | Braille animation, cursor control, erase line |
| `CaptureSpinnerHandle` | testkit    | Records `ActivityEvent[]` for assertions      |

Same pattern for `*ProgressHandle` (bar rendering, percentage, indeterminate pulse).

Active handle tracking: only one spinner/progress at a time per `OutputChannel`. Starting a new one
implicitly stops the previous. `stopActive()` public method for explicit cleanup.

All activity handle output (static and TTY) routes to **stderr** — stdout reserved for data.

## AMBIENT DECLARATIONS

`setInterval`/`clearInterval` declared as ambient functions in `activity.ts` (not from
`@types/node`) — zero-dep library targeting ES2022 without DOM or Node lib typings.

## TEST FILES (6)

| File                               | Tests | Focus                                                 |
| ---------------------------------- | ----: | ----------------------------------------------------- |
| `output.test.ts`                   |    49 | Core OutputChannel: log/warn/error, modes             |
| `output-tty.test.ts`               |    20 | TTY-specific rendering, color, formatting             |
| `output-table.test.ts`             |    16 | Table output in various modes                         |
| `output-spinner.test.ts`           |    45 | Spinner handles: noop/static/TTY/capture, fake timers |
| `output-progress.test.ts`          |    40 | Progress handles: noop/static/TTY/capture, fake timer |
| `output-activity-dispatch.test.ts` |    32 | OutputChannel wiring: mode dispatch, overlap, testkit |

## GOTCHAS

- Imports `schema/activity.ts` directly for activity types, `schema/command.ts` for `Out` — avoids
  circular dep through barrel
- `writer.ts` is a leaf: `WriteFn` type + `writeLine` helper. Shared by `index.ts` and `activity.ts`
- Terminal escape sequences (`HIDE_CURSOR`, `ERASE_LINE`, etc.) are `@internal` constants in
  `activity.ts`
- Spinner/progress tests use `vi.useFakeTimers()` inline with `try/finally`
- `ActivityEvent` has 10 variants (including `progress:increment` distinct from `progress:update`)
