# output: OutputChannel, activity, color

`createOutput()` and `createCaptureOutput()` are the public factories. `OutputChannel` is `@internal`.

## FILES

| File                | Role                                            |
| ------------------- | ----------------------------------------------- |
| `index.ts`          | `OutputChannel`, mode dispatch, `formatTable()` |
| `activity.ts`       | spinner and progress handles                    |
| `activity-block.ts` | one terminal block for concurrent handles       |
| `renderers.ts`      | handle factories, stream writer selection       |
| `contracts.ts`      | mode and option types                           |
| `writer.ts`         | synchronous `WriteFn`, `writeLine`              |
| `display-value.ts`  | default-value rendering shared with help        |
| `color.ts`          | `NO_COLOR` / `FORCE_COLOR` / TTY selection      |
| `json.ts`           | `ansispeck` syntax colors for JSON text         |
| `bind.ts`           | `bindMethods()`                                 |

## MODES

| Mode    | `out.log`  | `out.json` | Activity       |
| ------- | ---------- | ---------- | -------------- |
| Normal  | stdout     | stdout     | TTY handles    |
| JSON    | stderr     | stdout     | noop           |
| Quiet   | suppressed | stdout     | noop           |
| Non-TTY | stdout     | stdout     | static lines   |
| Capture | array      | array      | capture events |

Activity writes go to stderr. A new spinner or progress handle stops all active handles unless it and the most recently started handle both use `concurrent: true`. In TTY mode, concurrent handles share the channel's `ActivityBlock`.

## ANTI-PATTERNS

- Do not make `WriteFn` async. Final spinner cleanup races process exit. Deno uses `writeSync`
- Do not import `schema/activity.ts` or `schema/command.ts` through the schema barrel
- Do not list methods by hand for destructuring. Constructor ends with `bindMethods(this)`. Noop singletons are object literals and skip binding
- Do not read a table cell with a bare `row[key]`. `cellValue()` walks the prototype chain and treats `Object.prototype` as absent

## NOTES

- `out.setExitCode()` stores a code in a module-private `WeakMap`. It writes nothing
- Handle tiers: noop, static, TTY, capture, for both spinner and progress
- Spinner tests call `vi.useFakeTimers()` inside `try/finally`
