# API Reference

dreamcli exposes three subpath exports, each with a focused API surface.
Use this page to choose the right import, then jump into the detailed reference page for that
subpath.

## Choose an Import

| Import             | Use it for                                                                             | Start here                               |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `dreamcli`         | schema builders, CLI assembly, parsing, resolution, errors, completions, schema export | [`dreamcli`](/reference/main)            |
| `dreamcli/testkit` | command tests, output capture, scripted prompts, test adapters                         | [`dreamcli/testkit`](/reference/testkit) |
| `dreamcli/runtime` | runtime detection, explicit adapters, runtime-only helpers                             | [`dreamcli/runtime`](/reference/runtime) |

## Main Package Highlights

Most applications start from `dreamcli`.

| API                                          | Purpose                                                    |
| -------------------------------------------- | ---------------------------------------------------------- |
| `cli()`                                      | build a multi-command CLI                                  |
| `command()` / `group()`                      | define commands and nested groups                          |
| `flag` / `arg`                               | declare typed inputs                                       |
| `middleware()` / `plugin()`                  | extend execution with typed middleware and lifecycle hooks |
| `generateSchema()` / `generateInputSchema()` | export CLI structure and JSON Schema                       |
| `generateCompletion()`                       | generate bash or zsh completion scripts                    |
| `parse()` / `resolve()` / `formatHelp()`     | lower-level parser and help utilities                      |

## Testkit Highlights

| API                     | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `runCommand()`          | execute commands in-process and capture results  |
| `createCaptureOutput()` | capture stdout, stderr, and activity events      |
| `createTestPrompter()`  | script prompt answers for tests                  |
| `createTestAdapter()`   | inject argv, env, stdin, and filesystem behavior |

## Runtime Highlights

| API                                                                  | Purpose                                 |
| -------------------------------------------------------------------- | --------------------------------------- |
| `createAdapter()`                                                    | auto-detect the active runtime          |
| `createNodeAdapter()` / `createBunAdapter()` / `createDenoAdapter()` | opt into a specific runtime             |
| `detectRuntime()`                                                    | inspect runtime selection directly      |
| `RuntimeAdapter`                                                     | type for process abstraction boundaries |

## Related Guides

- [CLI Semantics](/guide/semantics) — exact parser, resolver, and root-surface behavior
- [Planner Contract](/reference/planner-contract) — internal dispatch outcomes and matched-command handoff
- [Resolver Contract](/reference/resolver-contract) — internal precedence, diagnostics, and resolved-value handoff
- [Testing Commands](/guide/testing) — higher-level testkit usage patterns
- [Runtime Support](/guide/runtime) — runtime packages and adapter expectations
- [Support Matrix](/reference/support-matrix) — audited support status, evidence, and deferred work

## Detailed Reference

- [`dreamcli`](/reference/main) — main package API
- [`dreamcli/testkit`](/reference/testkit) — testing utilities
- [`dreamcli/runtime`](/reference/runtime) — runtime adapters
