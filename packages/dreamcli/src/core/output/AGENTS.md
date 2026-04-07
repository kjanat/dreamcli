# output — OutputChannel, spinner/progress, TTY rendering

Six source files: `writer.ts` (leaf), `contracts.ts` (type contracts), `display-value.ts` (value
formatting), `renderers.ts` (table/list rendering), `activity.ts` (handle classes, ~568 lines),
`index.ts` (OutputChannel + factories, ~669 lines).

Dependency graph (no cycles): `writer.ts` <- `contracts.ts` <- `activity.ts` <- `index.ts` ->
`writer.ts`. `renderers.ts` + `display-value.ts` consumed by `index.ts`.

## KEY TYPES

| Symbol                  | Visibility  | Role                                              |
| ----------------------- | ----------- | ------------------------------------------------- |
| `createOutput()`        | **Public**  | Factory -> `Out` interface (mode-dispatched)      |
| `createCaptureOutput()` | **Public**  | Factory -> `Out` + `CapturedOutput` (for testkit) |
| `OutputChannel`         | `@internal` | Concrete class implementing `Out`                 |
| `CaptureOutputChannel`  | `@internal` | Subclass capturing output + activity events       |

## FILES

| File               | Lines | Purpose                                                   |
| ------------------ | ----: | --------------------------------------------------------- |
| `index.ts`         |   669 | OutputChannel class + factories + mode dispatch           |
| `activity.ts`      |   568 | Spinner/progress handle classes (TTY/static/capture/noop) |
| `contracts.ts`     |   177 | Output type contracts, mode types, option interfaces      |
| `renderers.ts`     |   101 | Table + list rendering logic                              |
| `display-value.ts` |    48 | Value display formatting utilities                        |
| `writer.ts`        |    30 | `WriteFn` type + `writeLine` helper (leaf)                |

## OUTPUT MODES

| Mode    | `out.log`  | `out.json` | Spinner/Progress |
| ------- | ---------- | ---------- | ---------------- |
| Normal  | -> stdout  | -> stdout  | TTY handles      |
| JSON    | -> stderr  | -> stdout  | Noop handles     |
| Quiet   | suppressed | -> stdout  | Noop handles     |
| Non-TTY | -> stdout  | -> stdout  | Static handles   |
| Capture | -> array   | -> array   | Capture handles  |

## ACTIVITY HANDLES

Four handle tiers per activity type (spinner + progress):

| Handle class           | When used  | Behavior                                      |
| ---------------------- | ---------- | --------------------------------------------- |
| `noopSpinnerHandle`    | JSON/quiet | Silent, all methods no-op                     |
| `StaticSpinnerHandle`  | non-TTY    | Writes start/succeed/fail as plain text lines |
| `TTYSpinnerHandle`     | TTY        | Braille animation, cursor control, erase line |
| `CaptureSpinnerHandle` | testkit    | Records `ActivityEvent[]` for assertions      |

Same pattern for `*ProgressHandle`. Active handle tracking: only one spinner/progress at a time.
Starting a new one implicitly stops the previous. All activity output routes to **stderr**.

## GOTCHAS

- Imports `schema/activity.ts` directly for activity types, `schema/command.ts` for `Out` — bypasses
  barrel to avoid circular dep
- `writer.ts` is a leaf: `WriteFn` type + `writeLine` helper. Shared by `index.ts` and `activity.ts`
- Terminal escape sequences (`HIDE_CURSOR`, `ERASE_LINE`, etc.) are `@internal` constants in
  `activity.ts`
- Spinner/progress tests use `vi.useFakeTimers()` inline with `try/finally`
- `ActivityEvent` has 10 variants (including `progress:increment` distinct from `progress:update`)
- Ambient `setInterval`/`clearInterval` declared in `activity.ts` (zero-dep, no `@types/node`)

## TEST FILES (6)

| File                               | Tests | Focus                                                 |
| ---------------------------------- | ----: | ----------------------------------------------------- |
| `output.test.ts`                   |    49 | Core OutputChannel: log/warn/error, modes             |
| `output-tty.test.ts`               |    20 | TTY-specific rendering, color, formatting             |
| `output-table.test.ts`             |    16 | Table output in various modes                         |
| `output-spinner.test.ts`           |    45 | Spinner handles: noop/static/TTY/capture, fake timers |
| `output-progress.test.ts`          |    40 | Progress handles: noop/static/TTY/capture, fake timer |
| `output-activity-dispatch.test.ts` |    32 | OutputChannel wiring: mode dispatch, overlap, testkit |
| `contracts.test.ts`                |     — | Output contract verification                          |
