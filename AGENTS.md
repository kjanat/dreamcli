# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-11 **Commit:** 77c0e03 **Branch:** v0.8-spinner-progress

## OVERVIEW

Schema-first, fully typed TypeScript CLI framework. Zero runtime deps. Single entry `src/index.ts`
re-exports 34 values + 74 types from 12 internal modules. Dual ESM/CJS via tsdown.

### Goals

Our goals are described in @GOALS.md

## STRUCTURE

```tree
src/
├── index.ts                # Public API barrel (explicit named re-exports, no wildcards)
├── core/
│   ├── cli/                # CLIBuilder — multi-command dispatch, --json, middleware wiring
│   ├── completion/         # Shell completion generation (bash/zsh, nested commands)
│   ├── config/             # Config file discovery + loading (XDG paths, JSON, plugin hook)
│   ├── errors/             # CLIError/ParseError/ValidationError hierarchy + type guards
│   ├── help/               # formatHelp() — text formatter for command help
│   ├── infer/              # STUB — type inference (empty, planned)
│   ├── output/             # OutputChannel — stdout/stderr, json/table/TTY, spinner/progress
│   ├── parse/              # Tokenizer + parser (argv → Token[] → ParseResult)
│   ├── prompt/             # PromptEngine — terminal/test prompters, interactive resolution
│   ├── resolve/            # Flag/arg resolution chain: CLI → env → config → prompt → default
│   ├── schema/             # CommandBuilder/FlagBuilder/ArgBuilder + middleware + prompt schemas
│   └── testkit/            # runCommand() — in-process test harness (public API)
└── runtime/
    ├── adapter.ts          # RuntimeAdapter interface (process abstraction)
    ├── auto.ts             # Auto-detecting adapter factory
    ├── node.ts             # Node.js adapter implementation
    ├── bun.ts              # Bun adapter (delegates to Node adapter)
    ├── deno.ts             # STUB
    └── detect.ts           # Runtime auto-detection (Bun/Deno/Node feature detection)
```

## WHERE TO LOOK

| Task                           | Location                        | Notes                                         |
| ------------------------------ | ------------------------------- | --------------------------------------------- |
| Add a new command feature      | `src/core/schema/`              | CommandBuilder, then wire through cli/testkit |
| Add a new flag type            | `src/core/schema/flag.ts`       | FlagBuilder + FlagKind union                  |
| Fix argument parsing           | `src/core/parse/`               | Tokenizer + parser, single `index.ts`         |
| Fix value resolution           | `src/core/resolve/`             | Resolution chain (~1k lines)                  |
| Add output format              | `src/core/output/`              | OutputChannel, Out interface in schema        |
| Add spinner/progress behavior  | `src/core/output/`              | Activity handles (TTY/static/capture/noop)    |
| Test a command                 | `src/core/testkit/`             | `runCommand()` with `RunOptions`              |
| Add middleware                 | `src/core/schema/middleware.ts` | `middleware()` factory                        |
| Multi-command CLI behavior     | `src/core/cli/`                 | CLIBuilder dispatch + error rendering         |
| Shell completions              | `src/core/completion/`          | Bash/zsh script generation from command tree  |
| Config file discovery          | `src/core/config/`              | XDG search paths, format loaders              |
| Runtime adapter (new platform) | `src/runtime/`                  | Implement RuntimeAdapter interface            |
| Interactive prompts            | `src/core/prompt/`              | PromptEngine + resolver integration           |

## DEPENDENCY GRAPH

```
errors, schema          ← LEAF (zero internal deps)
  ↑
parse, help, output     ← depend on schema/errors
  ↑
prompt, config          ← depend on output/schema
  ↑
resolve                 ← depends on parse/prompt/schema/errors
  ↑
completion, testkit     ← depend on many lower modules
  ↑
cli                     ← TOP — depends on nearly everything
```

Circular dependency avoidance: `prompt/` and `resolve/` import `schema/prompt.ts` directly
(bypassing barrel). `completion/` imports `cli/propagate.ts` directly. `output/` imports
`schema/command.ts` directly.

## CONVENTIONS

- **Tabs**, width 2, line width 100, single quotes, semicolons always, LF
- **`verbatimModuleSyntax`** — use `import type` for type-only imports
- **`.js` extensions** in all relative imports (NodeNext resolution)
- **Maximum TS strictness** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **No `any`** (biome warns), **no `!` non-null assertion** (biome info)
- **Barrel-per-module** — each module has `index.ts` re-exporting public symbols
- **`@internal` JSDoc** marks symbols excluded from public API (87 usages)
- **Tests co-located** — `*.test.ts` next to source, aspect-split: `cli-json.test.ts`
- **Em-dash in describes** — `describe('thing — behavior', ...)`
- **Section separators** — `// ===` major, `// ---` minor, in all test files
- **Zero lifecycle hooks** in tests — isolation via testkit architecture
- **Zero snapshots** — all assertions explicit
- **`biome-ignore noBannedTypes`** — 42 occurrences, all justified (40 test, 2 production for `{}`
  generic accumulator)
- Formatter: **dprint** (delegates JS/TS to biome plugin). Linter: **biome**
- Type checker: **tsgo** (native preview) primary, `tsc` fallback
- Bundler: **tsdown** with built-in `publint` + `attw --strict`
- VCS: `git`
- `@module` JSDoc at top of every source file

## ANTI-PATTERNS (THIS PROJECT)

- Do NOT use `export *` — all re-exports are explicit named
- Do NOT add runtime dependencies — library is zero-dep by design
- Do NOT use `beforeEach`/`afterEach` — tests get isolation from testkit's capture output
- Do NOT mock modules/dependencies — use `RunOptions` injection seam instead
- Do NOT use `process.*` or runtime-specific APIs in core — use RuntimeAdapter
- Do NOT put types in `@ts-ignore` — only `@ts-expect-error` for negative type tests
- Do NOT use `vi.mock()` / `vi.spyOn()` on modules — `vi.fn()` only for handler spies

## COMMANDS

```bash
pnpm run check       # tsgo --noEmit (native TS type check)
pnpm run check:tsc   # tsc --noEmit (standard fallback)
pnpm run lint        # biome check .
pnpm run lint:fix    # biome check --fix .
pnpm run format      # dprint fmt
pnpm run format:check # dprint check
pnpm run test        # vitest run
pnpm run test:watch  # vitest (watch mode)
pnpm run build       # tsdown (bundle + dts + publint + attw)
pnpm run ci          # check → lint → test → build (sequential)
```

## NOTES

- **No CI automation** — `pnpm run ci` is local-only, no GitHub Actions
- **No publish automation** — manual `pnpm publish`, quality gates in build step
- **110 files, ~33k lines TS** — 70 `.ts` files (33 source, 37 test), 1622 test cases
- **27 files >500 lines** — `output/index.ts` (1155), `resolve/index.ts` (1115), `cli/index.ts`
  (900), `schema/command.ts` (869) are the largest
- `cli/index.ts` partially split: `dispatch.ts` + `propagate.ts` extracted as `@internal`
- Prompt types defined in `schema/prompt.ts` but consumed by `core/prompt/` directly (bypasses
  barrel to avoid circular dep)
- `stdinIsTTY` gates interactive prompt auto-creation in `cli/index.ts` — prompts only activate when
  stdin is a TTY
- Output assertions in tests include trailing `\n` — `['Hello\n']` not `['Hello']`
- `as` casts exist only at type-erasure boundaries (phantom brands, heterogeneous storage) and
  runtime detection boundaries — all guarded
- Single public entry point (`"."` export only) — no subpath exports
