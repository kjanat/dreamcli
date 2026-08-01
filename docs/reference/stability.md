# Stability Policy

This page classifies every exported type by the compatibility contract it carries.
Version numbers follow [SemVer](https://semver.org); the table below defines what
counts as breaking for each category.

## Categories

| Category                 | Examples                                                | Minor releases may                                |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------------- |
| Sealed framework values  | `Out`, `RenderContext`                                  | add readonly members                              |
| Consumer input options   | `RunOptions`, `CLIRunOptions`, `OutputOptions`, `RenderContextOptions`, `HelpOptions` | add optional fields |
| Implementer interfaces   | `RuntimeAdapter`, `PromptEngine`, `CLIPlugin`           | add optional hooks only                           |
| Closed unions            | `Verbosity`, `ActivityEvent`, `OutputStream`            | change nothing                                    |
| Internal surface         | underscore members (`_execute`, `_ctx`), `Internal*` option types | change anything, any release            |

## Sealed framework values

`Out` and `RenderContext` are framework-created, non-exhaustive values. Both
carry a private brand, so implementing or structurally constructing them
outside the framework does not type-check.

- Obtain instances from action parameters, `createOutput()`,
  `createCaptureOutput()`, or `resolveRenderContext()`.
- New readonly members may appear in minor releases. Code that only reads
  documented members keeps compiling.
- Do not enumerate their keys exhaustively (`Record<keyof Out, ...>`); a
  minor release may add a key.
- Helpers that need a subset should accept a capability type:

```ts twoslash
import type { Out } from '@kjanat/dreamcli';
// ---cut---
type InformationalOutput = Pick<Out, 'info' | 'status'>;

function renderRows(out: InformationalOutput, rows: readonly string[]) {
	for (const row of rows) out.info(row);
}
```

For test doubles, take a real channel from the testkit and spy on it:

```ts
const [out] = createCaptureOutput();
vi.spyOn(out, 'info');
```

## Consumer input options

Option objects the caller constructs and passes in. All fields are optional;
minor releases may add optional fields but never required ones, and never
change the meaning of an existing field.

## Implementer interfaces

Interfaces designed to be implemented outside the framework. Their required
surface is frozen within a major version; new capabilities arrive as optional
members. A redesign ships as a new interface, with the old one supported until
the next major.

The low-level output seam is the injected `stdout`/`stderr` writer pair on
`OutputOptions` (`WriteFn`), not a reimplementation of `Out`.

## Closed unions

String and discriminated unions are closed: consumers may switch exhaustively
over them (`satisfies never` in the `default` branch), and adding a variant is
a breaking change released in a major.

## Internal surface

Members prefixed with an underscore and types named `Internal*` exist for the
framework's own layering and for in-repo tests. They may change or disappear
in any release. The `@internal` TSDoc tag marks the same boundary on
individual members.
