# Contributing

Issues and pull requests: [kjanat/dreamcli](https://github.com/kjanat/dreamcli).

## Setup

Use the Bun pin in [`package.json`](./package.json) (`packageManager`, currently Bun 1.4.5), Node.js 22.22.2 or newer ([`.node-version`](./.node-version) pins 26.13.1), and Deno 2.6.0 or newer.

```sh
bun install --frozen-lockfile
```

In this repository Bun and Deno load `src/*.ts`. Node loads `dist/*.mjs`. Run `bun run bd` when a Node example or a Node test has to see a source change.

## Checks

```sh
bun run typecheck          # tsrs --noEmit
bun run lint               # biome
bun run format:check       # kprint
bun run fmt                # biome --fix, then kprint
bun run test               # vitest
bun run test src/core/resolve/resolve-arg-env.test.ts
bun run meta-descriptions:check
bun run docs:build
bun run ci
```

`bun run ci` is the local gate: typecheck, lint, format, meta descriptions, tests, docs build, and `bd`.

CI also runs `bun run test:bun`, `bun run test:node`, `bun run test:gh`, coverage, Deno `check` / `smoke` / `vitest:deno`, and `bun run bd` on the pinned Bun. The `examples/gh` workspace has its own typecheck: `bun run typecheck:gh`.

## Where to edit

| Change                                        | Path                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Commands, flags, args, middleware             | [`src/core/schema/`](./src/core/schema/)                             |
| Argv parsing                                  | [`src/core/parse/`](./src/core/parse/)                               |
| Argv, env, config, prompt, default precedence | [`src/core/resolve/`](./src/core/resolve/)                           |
| Help text                                     | [`src/core/help/`](./src/core/help/)                                 |
| Config discovery and `manifest()`             | [`src/core/config/`](./src/core/config/)                             |
| Prompts                                       | [`src/core/prompt/`](./src/core/prompt/)                             |
| JSON Schema                                   | [`src/core/json-schema/`](./src/core/json-schema/)                   |
| Stdout, stderr, spinners, progress            | [`src/core/output/`](./src/core/output/)                             |
| Shell completions                             | [`src/core/completion/`](./src/core/completion/)                     |
| Dispatch and plugins                          | [`src/core/cli/`](./src/core/cli/)                                   |
| Node, Bun, and Deno adapters                  | [`src/runtime/`](./src/runtime/)                                     |
| Guide and concept prose                       | [`docs/guide/`](./docs/guide/), [`docs/concepts/`](./docs/concepts/) |
| Runnable examples and the `gh` canary         | [`examples/`](./examples/)                                           |
| Build and release scripts                     | [`scripts/`](./scripts/)                                             |

Public API is factory-first: `cli()`, `command()`, `flag.*()`, `createOutput()`, `createAdapter()`.

Platform I/O lives in [`src/runtime/`](./src/runtime/). Core goes through `RuntimeAdapter`, `WriteFn`, and `ReadFn`.

Tests are co-located `*.test.ts`. Stdout and stderr assertions include the trailing newline.

## Style

Tabs, single quotes, semicolons, LF. Type-only imports use `import type`. Relative imports keep the `.ts` extension. Re-exports are named. With `exactOptionalPropertyTypes`, an omitted optional field is a conditional spread.

## Generated files

Regenerate these with the scripts and commit the result in the same change:

- [`dreamcli.schema.json`](./dreamcli.schema.json) via `bun run schema:emit`
- [`src/core/json-schema/meta-descriptions.generated.ts`](./src/core/json-schema/meta-descriptions.generated.ts) via `bun run meta-descriptions`

`docs/.vitepress/dist/` and `docs/.vitepress/cache/` are build output. Docs CI fails when the build leaves the worktree dirty.

## Documentation

Guides are hand-written. The API reference is generated from source declarations and JSDoc. `bun run meta-descriptions:check` and the docs build need Deno.

```sh
bun run docs:dev      # VitePress, port 5173 unless PORT is set
bun run docs:build
```

## Pull requests

Target `master`. One change per pull request. Each new branch, callback, and runtime path has a test in the same change. Run `bun run ci` on the full tree before review.
