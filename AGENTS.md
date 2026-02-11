# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-11 **Commit:** 1c8e6ba **Branch:** v0.8-spinner-progress

## OVERVIEW

Schema-first, fully typed TypeScript CLI framework. Zero runtime deps. Three subpath exports (`"."`,
`"./testkit"`, `"./runtime"`) curated by `src/index.ts`, `src/testkit.ts`, and `src/runtime.ts`.
Dual ESM/CJS via tsdown.

### Goals

Our goals are described in @GOALS.md

## STRUCTURE

```tree
src/
├── index.ts                # Public API barrel (explicit named re-exports, no wildcards)
├── core/
│   ├── cli/                # CLIBuilder — multi-command dispatch, --json, middleware wiring
│   │   └── root-help.ts    # Root help formatter for multi-command CLIs
│   ├── completion/         # Shell completion generation (bash/zsh, nested commands)
│   ├── config/             # Config file discovery + loading (XDG paths, JSON, plugin hook)
│   ├── errors/             # CLIError/ParseError/ValidationError hierarchy + type guards
│   ├── help/               # formatHelp() — text formatter for command help
│   ├── output/             # OutputChannel — stdout/stderr, json/table/TTY, spinner/progress
│   ├── parse/              # Tokenizer + parser (argv → Token[] → ParseResult)
│   ├── prompt/             # PromptEngine — terminal/test prompters, interactive resolution
│   ├── resolve/            # Flag/arg resolution chain: CLI → env → config → prompt → default
│   ├── schema/             # CommandBuilder/FlagBuilder/ArgBuilder + middleware + prompt schemas
│   │   └── activity.ts     # ActivityConfig/ActivityEvent types for spinner/progress
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
| Fix value resolution           | `src/core/resolve/`             | Resolution chain (~1.1k lines)                |
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
`schema/command.ts` directly. `output/` imports `schema/activity.ts` directly (not through barrel).
`runtime/adapter.ts` imports `WriteFn` from `core/output/` and `ReadFn` from `core/prompt/` —
runtime depends on core types (not truly independent layer).

`schema/command.ts` has a type-only `import type` from `testkit/index.ts` for `RunOptions`/
`RunResult` — inverts stated dependency direction but is compile-time only (`verbatimModuleSyntax`
guarantees erasure).

## CONVENTIONS

- **Tabs**, width 2, line width 100, single quotes, semicolons always, LF
- **`verbatimModuleSyntax`** — use `import type` for type-only imports
- **`.js` extensions** in all relative imports (NodeNext resolution)
- **Maximum TS strictness** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **No `any`** (biome warns), **no `!` non-null assertion** (biome info)
- **Barrel-per-module** — each module has `index.ts` re-exporting public symbols
- **`@internal` JSDoc** marks symbols excluded from public API (86 usages across 14 files)
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
- **Factory functions as public API** — `cli()`, `command()`, `flag.string()`, `middleware()`,
  `createOutput()`, `createAdapter()` etc. Classes exported but not for direct construction
- **Discriminated unions everywhere** — `Token.kind`, `DispatchResult.kind`, `PromptConfig.kind`,
  `FlagSchema.kind`, `ActivityEvent.type`, `CoerceResult.ok`, etc.
- **`exactOptionalPropertyTypes`** forces conditional spread: `...(x !== undefined ? { x } : {})`
- **Output assertions include trailing `\n`** — `['Hello\n']` not `['Hello']`
- `as` casts exist only at type-erasure boundaries (phantom brands, heterogeneous storage) and
  runtime detection boundaries — all guarded (9 in production, all documented)

## ANTI-PATTERNS (THIS PROJECT)

- Do NOT use `export *` — all re-exports are explicit named
- Do NOT add runtime dependencies — library is zero-dep by design
- Do NOT use `beforeEach`/`afterEach` — tests get isolation from testkit's capture output
- Do NOT mock modules/dependencies — use `RunOptions` injection seam instead
- Do NOT use `process.*` or runtime-specific APIs in core — use RuntimeAdapter
- Do NOT put types in `@ts-ignore` — only `@ts-expect-error` for negative type tests
- Do NOT use `vi.mock()` / `vi.spyOn()` on modules — `vi.fn()` only for handler spies
- Do NOT import through barrel when it would create circular deps — import the specific file
- Do NOT use `test()` — always `describe()` + `it()` from vitest (never bare `test()`)

## COMMANDS

```bash
bun run check        # tsgo --noEmit (native TS type check)
bun run check:tsc    # tsc --noEmit (standard fallback)
bun run lint         # biome check .
bun run lint:fix     # biome check --fix .
bun run format       # dprint fmt
bun run format:check # dprint check
bun run test         # vitest run
bun run test:watch   # vitest (watch mode)
bun run build        # tsdown (bundle + dts + publint + attw)
bun run ci           # check → lint → test → build (sequential)
```

## NOTES

- **No CI automation** — `bun run ci` is local-only, no GitHub Actions
- **No publish automation** — manual `bun publish`, quality gates in build step
- **~31 source files, 46 test files, ~9.9k source lines** — 1658 tests
- **5 files >500 lines** — `resolve/index.ts` (940), `cli/index.ts` (793), `schema/command.ts`
  (784), `completion/index.ts` (786), `output/activity.ts` (581)
- `cli/index.ts` partially split: `dispatch.ts` + `propagate.ts` extracted as `@internal`
- Prompt types defined in `schema/prompt.ts` but consumed by `core/prompt/` directly (bypasses
  barrel to avoid circular dep)
- `stdinIsTTY` gates interactive prompt auto-creation in `cli/index.ts` — prompts only activate when
  stdin is a TTY
- Three subpath exports: `"."`, `"./testkit"`, `"./runtime"`
- `deno.ts` is an empty stub (planned, not yet implemented)
- `src/` included in `files` (published source)
- `node-builtins.d.ts` — handwritten ambient module declarations for `node:readline` and
  `node:fs/promises` to avoid `@types/node` dependency
- Fake timers in tests: inline `vi.useFakeTimers()` with `try/finally`, never lifecycle hooks
- No `README.md` — pre-publish
