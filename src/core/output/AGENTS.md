# output — OutputChannel, spinner/progress, TTY rendering

Seven source files: `writer.ts` (leaf), `contracts.ts` (type contracts), `display-value.ts` (value
formatting), `renderers.ts` (activity-handle construction), `bind.ts` (method-binding helper),
`activity.ts` (handle classes, ~575 lines), `index.ts` (OutputChannel + factories, ~830 lines).

Dependency graph (no cycles): `writer.ts` <- `contracts.ts` <- `activity.ts` <- `index.ts` ->
`writer.ts`. `renderers.ts` + `display-value.ts` consumed by `index.ts`.

## KEY TYPES

| Symbol                  | Visibility  | Role                                              |
| ----------------------- | ----------- | ------------------------------------------------- |
| `createOutput()`        | **Public**  | Factory -> `Out` interface (mode-dispatched)      |
| `createCaptureOutput()` | **Public**  | Factory -> `Out` + `CapturedOutput` (for testkit) |
| `out.setExitCode()`     | **Public**  | Request success-path exit code without output     |
| `OutputChannel`         | `@internal` | Concrete class implementing `Out`                 |
| `CaptureOutputChannel`  | `@internal` | Subclass capturing output + activity events       |

## FILES

| File               | Lines | Purpose                                                           |
| ------------------ | ----: | ----------------------------------------------------------------- |
| `index.ts`         |   830 | OutputChannel class + factories + mode dispatch + `formatTable()` |
| `activity.ts`      |   575 | Spinner/progress handle classes (TTY/static/capture/noop)         |
| `contracts.ts`     |   197 | Output type contracts, mode types, option interfaces              |
| `renderers.ts`     |   125 | Spinner/progress handle factories + `resolveWriterForStream()`    |
| `bind.ts`          |    59 | `bindMethods()` — binds instance methods (see GOTCHAS)            |
| `display-value.ts` |    48 | Value display formatting utilities                                |
| `writer.ts`        |    46 | `WriteFn` type + `writeLine` helper (leaf)                        |

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
- Exit-code requests live in a module-private `WeakMap<Out, number>`; executor reads and clears it.
  `out.setExitCode()` does not short-circuit and writes no output.
- Terminal escape sequences (`HIDE_CURSOR`, `ERASE_LINE`, etc.) are `@internal` constants in
  `activity.ts`
- Spinner/progress tests use `vi.useFakeTimers()` inline with `try/finally`
- `ActivityEvent` has 10 variants (including `progress:increment` distinct from `progress:update`)
- Ambient `setInterval`/`clearInterval` declared in `activity.ts` (zero-dep, no `@types/node`)
- `TableColumn.key` is caller data, so `cellValue()` in `index.ts` locates the key's holder along
  the row's prototype chain and treats `Object.prototype` as absent. `formatTable()` and
  `projectTableRows()` both go through it. A bare `row[c.key]` returns the inherited method for a
  column keyed `toString` or `constructor` on a row that has no such key, and the text table printed
  `[Function: toString]` where the cell belongs. An `Object.hasOwn()` check alone is too strict.
  Rows are arbitrary caller objects, so a class getter and an `Object.create(defaults)` fallback are
  ordinary data and must still render.
- **Consumer-facing value objects (`OutputChannel` + all spinner/progress handle classes) call
  `bindMethods(this)` as the last constructor statement.** This makes methods safe to destructure
  (`const { log } = out`, `const { succeed } = spinner`) or pass as detached callbacks
  (`promise.finally(spinner.stop)`) — unbound, they would lose `this` and crash. Any new method on
  these classes is bound automatically (the helper reads the prototype chain), so don't hand-list
  methods. The noop handle singletons are plain object literals that use no `this`, so they need no
  binding.

## TEST FILES (7)

| File                               | Tests | Focus                                                 |
| ---------------------------------- | ----: | ----------------------------------------------------- |
| `output.test.ts`                   |    81 | Core OutputChannel: log/warn/error, modes, exit codes |
| `output-spinner.test.ts`           |    50 | Spinner handles: noop/static/TTY/capture, fake timers |
| `output-progress.test.ts`          |    47 | Progress handles: noop/static/TTY/capture, fake timer |
| `output-activity-dispatch.test.ts` |    39 | OutputChannel wiring: mode dispatch, overlap, testkit |
| `output-table.test.ts`             |    29 | Table output in various modes                         |
| `output-tty.test.ts`               |    20 | TTY-specific rendering, color, formatting             |
| `contracts.test.ts`                |    15 | Output contract verification                          |
