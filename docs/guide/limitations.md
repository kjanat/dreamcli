# Limitations And Workarounds

This page consolidates the most important current edges in DreamCLI's shipped surface.

Use it with the [Support Matrix](/reference/support-matrix): the matrix says what is supported, deferred, or experimental; this page explains where the supported surface still has important constraints.

## Non-Interactive Prompting Is Intentionally Off

Automatic prompts run only when a prompter is available and `stdinIsTTY` is `true`.
Pipes, CI, and redirected stdin do not trigger interactive fallbacks.

Why:

- non-interactive execution should stay deterministic;
- a pipeline should not hang because a prompt suddenly appeared.

Workarounds:

- provide the value through CLI flags, env vars, config, stdin-backed inputs, or defaults;
- in tests, inject prompt answers explicitly through the testkit instead of relying on TTY behavior.

References: [Interactive Prompts](/guide/prompts), [CLI Semantics](/guide/semantics)

## Built-In Config Loading Is JSON-Only

DreamCLI ships JSON config discovery by default.
YAML, TOML, and other formats require explicit parser wiring through the config-format extension surface.

Why:

- the project keeps a single runtime dependency, `ansispeck`, in core;
- built-in multi-format parsing would expand maintenance and dependency surface quickly.

Workarounds:

- stay on JSON for the boring path;
- add your own config loader when a different format is required.

References: [Config Files](/guide/config), [Support Matrix](/reference/support-matrix)

## Runtime Support Is Real, But Platform Coverage Is Narrower Than The Claim Surface

Node, Bun, and Deno adapters are shipped.
That does not mean every OS, shell, and CI permutation is exhaustively covered today.

Why:

- runtime support is part of the product;
- broad cross-platform coverage takes longer to verify honestly than adapter support takes to implement.

Workarounds:

- treat the documented minimum runtimes as the supported baseline;
- verify your exact platform/shell combination before relying on it as production truth;
- watch `harden-ci-coverage` for broader CI proof.

References: [Runtime Support](/guide/runtime), [Support Matrix](/reference/support-matrix)

## Generated Hover Is Intentionally Narrow

Hover is only shipped on generated example source blocks.
Guides, shell transcripts, and the wider reference surface stay plain markdown.

Why:

- examples are the highest-value place for code inspection;
- site-wide interactive rendering would add complexity faster than it would add clarity.

Workarounds:

- use generated example pages when you want hoverable code;
- use symbol pages and guide links when you want stable reference reading instead of inline inspection.

References: [Examples](/examples/), [Example Hover](/reference/example-hover-prototype)

## Negated Booleans Are Opt-In Per Flag

DreamCLI accepts boolean flags such as `--verbose`, `--verbose=true`, and `--verbose=false`.
`.negatable()` synthesizes the `--no-verbose` form for a flag that asks for it.
No boolean gets a `--no-` spelling automatically; see [Negatable Booleans](/guide/flags#negatable-booleans).

Why:

- implicit alternate spellings on every boolean make parsing and docs less explicit;
- the library prefers schema-declared behavior over convention-heavy magic.

Workarounds:

- add `.negatable()` to each boolean that wants the pair;
- pass `.negatable({ alias: 'plain' })` when the negated spelling should be something other than `--no-<name>`.

References: [CLI Semantics](/guide/semantics), [Flags](/guide/flags)

## Relationships between inputs

Use `.constrain()` after registering the command's flags and arguments.
For example, require exactly one transport:

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('lsp-server')
  .flag('stdio', flag.boolean())
  .flag('node-ipc', flag.boolean())
  .flag('socket', flag.number().default(6009))
  .constrain((c) => [
    c.exactlyOne('stdio', 'node-ipc', 'socket'),
  ])
  .action(({ out }) => out.log('starting'));
```

The builder also supports `conflicts`, `requires`, `atMostOne`, and `allOrNone`.
Use `c.arg(name)` to select a positional when a flag has the same name.
Rules run after resolution. A value supplied by CLI, stdin, env, config, or
prompt counts. Defaults and disabled boolean flags are excluded.

Text help and the definition document include the rules. Completion uses
exclusion rules to suppress options that conflict with inputs already supplied
on the command line.

For custom rules, `.validate(standardSchema)` validates the resolved flags
object before derive and middleware. Pass `{ input: 'resolved' }` as the
second argument to validate `{ flags, args, sources }`. Validation reports
issues with their input paths and preserves the resolved values for handlers.

## The Framework Is Overkill For Tiny One-Off Scripts

dreamcli is optimized for typed multi-source resolution, middleware, structured output, completions, and in-process testing.
That is a lot of machinery if you only want a few flags and one direct action.

Why:

- the product is designed around coherence across the full command lifecycle, not minimum abstraction count.

Workarounds:

- use dreamcli when you expect the CLI to grow or when typed multi-source behavior matters;
- call `readFlags()` when a script wants typed flags and nothing else: no command, no handler, no output channel;
- use a thinner parser when you only need a tiny wrapper script.

References: [Why dreamcli](/guide/why), [Architecture Rationale](/guide/rationale), [Standalone Flag Evaluation](/guide/read-flags)

## Adoption Guidance Lives Elsewhere On Purpose

This page is about current constraints, not the whole adoption story.

Use these companion pages when you need the rest of that picture:

- [Migration And Adoption](/guide/migration) for when to switch and how to phase the move;
- [Troubleshooting](/guide/troubleshooting) for likely real failure modes and diagnosis steps.

## Related Pages

- [Architecture Rationale](/guide/rationale)
- [Migration And Adoption](/guide/migration)
- [Troubleshooting](/guide/troubleshooting)
- [Support Matrix](/reference/support-matrix)
- [CLI Semantics](/guide/semantics)
- [Runtime Support](/guide/runtime)
- [Testing Commands](/guide/testing)
