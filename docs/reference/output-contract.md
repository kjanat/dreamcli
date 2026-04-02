# Output Contract

This page records the internal output-policy boundary for the `dreamcli-re-foundation` workstream.
It is a stability target for tests and refactors, not a public API guarantee.

## Responsibilities

- choose semantic text-routing facts from `jsonMode`, `isTTY`, and `verbosity`
- choose spinner and progress activity modes before rendering starts
- define which activity handles require tracked cleanup after execution
- keep stdout reserved for structured data when JSON mode is active

## Non-Responsibilities

- render ANSI frames, tables, or concrete text lines
- own stdout or stderr writer functions
- capture activity events for testkit
- decide command dispatch, parsing, or resolution behavior

## Output Policy

The output contract is modeled in `src/core/output/contracts.ts` as:

```ts
interface OutputPolicy {
  readonly jsonMode: boolean;
  readonly isTTY: boolean;
  readonly verbosity: Verbosity;
}
```

The intent is simple:

- `jsonMode` reserves stdout for `json()` and JSON-form table output
- `isTTY` enables decorative activity rendering only when JSON mode is off
- `verbosity` affects informational text, not warnings, errors, or structured output

## Activity Policy

```ts
interface ActivityPolicy {
  readonly mode: 'noop' | 'static' | 'tty';
  readonly stream: 'stderr';
  readonly cleanup: 'none' | 'stop' | 'done';
}
```

Field meaning:

| Field     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `mode`    | semantic activity choice before handle construction                          |
| `stream`  | output stream reserved for non-capture activity rendering                    |
| `cleanup` | terminal method the framework must call if a handler leaks the active handle |

Current cleanup facts:

- spinners use `stop`
- progress handles use `done`
- noop activity requires no cleanup registration

## Contract Facts

The frozen facts in `outputContract` are:

- JSON mode reserves stdout for structured data
- quiet mode suppresses `info()` only
- non-capture activity uses stderr
- TTY activity requires both `isTTY` and `!jsonMode`
- spinner and progress cleanup semantics are explicit and distinct

## Evidence

- Contract module: `src/core/output/contracts.ts`
- Current output implementation: `src/core/output/index.ts`
- Activity handles: `src/core/output/activity.ts`
- Contract tests: `src/core/output/contracts.test.ts`
- RFC / PRD source: `specs/dreamcli-re-foundation.md`, `specs/dreamcli-re-foundation-prd.md`

## Current Status

- output policy facts are now named in one internal contract module
- `OutputChannel` now keeps an explicit `policy` snapshot and delegates concrete writer and activity-handle selection through internal renderer helpers
- capture behavior still stays in `src/core/output/index.ts`; a full output-layer split remains future work
