# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-09 **Commit:** 70e8044 **Branch:** v0.4-middleware-output

## OVERVIEW

Schema-first, fully typed TypeScript CLI framework. Zero runtime deps. Single entry `src/index.ts`
re-exports 31 values + 74 types from 10 internal modules. Dual ESM/CJS via tsdown.

## STRUCTURE

```tree
src/
├── index.ts                # Public API barrel (explicit named re-exports, no wildcards)
├── core/
│   ├── cli/                # CLIBuilder — multi-command dispatch, --json, middleware wiring
│   ├── errors/             # CLIError/ParseError/ValidationError hierarchy + type guards
│   ├── help/               # formatHelp() — text formatter for command help
│   ├── output/             # OutputChannel — stdout/stderr abstraction, json/table/TTY
│   ├── parse/              # Tokenizer + parser (argv → Token[] → ParseResult)
│   ├── prompt/             # PromptEngine — terminal/test prompters, interactive resolution
│   ├── resolve/            # Flag/arg resolution chain: CLI → env → config → prompt → default
│   ├── schema/             # CommandBuilder/FlagBuilder/ArgBuilder + middleware + prompt schemas
│   ├── testkit/            # runCommand() — in-process test harness (public API)
│   ├── completion/         # STUB — shell completion (empty, planned)
│   └── infer/              # STUB — type inference (empty, planned)
└── runtime/
    ├── adapter.ts          # RuntimeAdapter interface (process abstraction)
    ├── node.ts             # Node.js adapter implementation
    ├── bun.ts              # STUB
    ├── deno.ts             # STUB
    └── detect.ts           # STUB
```

**Ghost dirs at `src/` top-level** (`src/completion/`, `src/errors/`, etc.) mirror `core/` modules
but are empty. Leftover scaffolding — ignore them.

## WHERE TO LOOK

| Task                           | Location                        | Notes                                         |
| ------------------------------ | ------------------------------- | --------------------------------------------- |
| Add a new command feature      | `src/core/schema/`              | CommandBuilder, then wire through cli/testkit |
| Add a new flag type            | `src/core/schema/flag.ts`       | FlagBuilder + FlagKind union                  |
| Fix argument parsing           | `src/core/parse/`               | Tokenizer + parser, single `index.ts`         |
| Fix value resolution           | `src/core/resolve/`             | Resolution chain (~1k lines)                  |
| Add output format              | `src/core/output/`              | OutputChannel, Out interface in schema        |
| Test a command                 | `src/core/testkit/`             | `runCommand()` with `RunOptions`              |
| Add middleware                 | `src/core/schema/middleware.ts` | `middleware()` factory                        |
| Multi-command CLI behavior     | `src/core/cli/`                 | CLIBuilder dispatch + error rendering         |
| Runtime adapter (new platform) | `src/runtime/`                  | Implement RuntimeAdapter interface            |
| Interactive prompts            | `src/core/prompt/`              | PromptEngine + resolver integration           |

## CONVENTIONS

- **Tabs**, width 2, line width 100, single quotes, semicolons always, LF
- **`verbatimModuleSyntax`** — use `import type` for type-only imports
- **`.js` extensions** in all relative imports (NodeNext resolution)
- **Maximum TS strictness** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **No `any`** (biome warns), **no `!` non-null assertion** (biome info)
- **Barrel-per-module** — each module has `index.ts` re-exporting public symbols
- **`@internal` JSDoc** marks symbols excluded from public API (26 usages)
- **Tests co-located** — `*.test.ts` next to source, aspect-split: `cli-json.test.ts`
- **Em-dash in describes** — `describe('thing — behavior', ...)`
- **Section separators** — `// ===` major, `// ---` minor, in all test files
- **Zero lifecycle hooks** in tests — isolation via testkit architecture
- **Zero snapshots** — all assertions explicit
- **`biome-ignore noBannedTypes`** — 40 occurrences, all justified (38 test, 2 production for `{}`
  generic accumulator)
- Formatter: **dprint** (delegates JS/TS to biome plugin). Linter: **biome**
- Type checker: **tsgo** (native preview) primary, `tsc` fallback
- Bundler: **tsdown** with built-in `publint` + `attw --strict`
- VCS: `git`

## ANTI-PATTERNS (THIS PROJECT)

- Do NOT use `export *` — all re-exports are explicit named
- Do NOT add runtime dependencies — library is zero-dep by design
- Do NOT use `beforeEach`/`afterEach` — tests get isolation from testkit's capture output
- Do NOT mock modules/dependencies — use `RunOptions` injection seam instead
- Do NOT use `process.*` or runtime-specific APIs in core — use RuntimeAdapter
- Do NOT put types in `@ts-ignore` — only `@ts-expect-error` for negative type tests

## COMMANDS

```bash
pnpm run check       # tsgo --noEmit (native TS type check)
pnpm run check:tsc   # tsc --noEmit (standard fallback)
pnpm run lint        # biome check .
pnpm run format      # dprint fmt
pnpm run test        # vitest run
pnpm run test:watch  # vitest (watch mode)
pnpm run build       # tsdown (bundle + dts + publint + attw)
pnpm run ci          # check → lint → test → build (sequential)
```

## NOTES

- **No CI automation** — `pnpm run ci` is local-only, no GitHub Actions
- **No publish automation** — manual `pnpm publish`, quality gates in build step
- `src/core/resolve/index.ts` is the largest file (~1k lines) — resolution chain complexity
- `src/core/cli/index.ts` (~700 lines) approaching split threshold
- Prompt types defined in `schema/prompt.ts` but consumed by `core/prompt/` directly (bypasses
  barrel to avoid circular dep)
- `stdinIsTTY` gates interactive prompt auto-creation in `cli/index.ts` — prompts only activate when
  stdin is a TTY
- Output assertions in tests include trailing `\n` — `['Hello\n']` not `['Hello']`
