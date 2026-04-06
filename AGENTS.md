# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-04 **Commit:** 227385a **Branch:** dreamcli-re-foundation

## OVERVIEW

Schema-first, fully typed TypeScript CLI framework. Zero runtime deps. Three subpath exports (`"."`,
`"./testkit"`, `"./runtime"`) curated by `src/index.ts`, `src/testkit.ts`, and `src/runtime.ts`.
ESM-only via tsdown.

### Goals

Our goals are described in @GOALS.md

Read @DISCOVERIES.md at the start of every session before planning, editing, or running task workflows.
Agent memory for non-obvious repo gotchas lives there.

## STRUCTURE

```text
src/
├── index.ts                # Public API barrel (explicit named re-exports, no wildcards)
├── core/
│   ├── cli/                # CLIBuilder — multi-command dispatch, plugins, runtime preflight
│   ├── completion/         # Shell completion generation (bash/zsh + fish/powershell stubs)
│   │   └── shells/         # Per-shell generators + shared tree walker
│   ├── config/             # Config file discovery + loading (XDG paths, JSON, plugin hook)
│   ├── errors/             # CLIError/ParseError/ValidationError hierarchy + type guards
│   ├── execution/          # Shared parse → resolve → plugin → handler pipeline (@internal)
│   ├── help/               # formatHelp() — text formatter for command help
│   ├── json-schema/        # Schema → JSON Schema generation + definition metadata
│   ├── output/             # OutputChannel — stdout/stderr, json/table/TTY, spinner/progress
│   ├── parse/              # Tokenizer + parser (argv → Token[] → ParseResult)
│   ├── prompt/             # PromptEngine — terminal/test prompters, interactive resolution
│   ├── resolve/            # Flag/arg resolution chain: CLI → env → config → prompt → default
│   ├── schema/             # CommandBuilder/FlagBuilder/ArgBuilder + middleware + prompt schemas
│   ├── schema-dsl/         # String-literal schema definitions with compile-time type inference
│   └── testkit/            # runCommand() — in-process test harness (public API)
└── runtime/
    ├── adapter.ts          # RuntimeAdapter interface (process abstraction)
    ├── auto.ts             # Auto-detecting adapter factory
    ├── node.ts             # Node.js adapter implementation
    ├── bun.ts              # Bun adapter (delegates to Node adapter)
    ├── deno.ts             # Deno adapter (permission-safe Deno namespace)
    ├── detect.ts           # Runtime auto-detection (Bun/Deno/Node feature detection)
    ├── paths.ts            # @internal — XDG/platform path resolution
    └── support.ts          # @internal — runtime feature support detection
```

## WHERE TO LOOK

| Task                           | Location                        | Notes                                           |
| ------------------------------ | ------------------------------- | ----------------------------------------------- |
| Add a new command feature      | `src/core/schema/`              | CommandBuilder, then wire through cli/testkit   |
| Add a new flag type            | `src/core/schema/flag.ts`       | FlagBuilder + FlagKind union                    |
| Fix argument parsing           | `src/core/parse/`               | Tokenizer + parser, single `index.ts`           |
| Fix value resolution           | `src/core/resolve/`             | Split into args/flags/coerce/config/errors      |
| Add output format              | `src/core/output/`              | OutputChannel, Out interface in schema          |
| Add spinner/progress behavior  | `src/core/output/`              | Activity handles (TTY/static/capture/noop)      |
| Test a command                 | `src/core/testkit/`             | `runCommand()` with `RunOptions`                |
| Add middleware                 | `src/core/schema/middleware.ts` | `middleware()` factory                          |
| Multi-command CLI behavior     | `src/core/cli/`                 | CLIBuilder dispatch + plugins + error rendering |
| Shell completions              | `src/core/completion/`          | Bash/zsh generators from command tree           |
| Config file discovery          | `src/core/config/`              | XDG search paths, format loaders                |
| Runtime adapter (new platform) | `src/runtime/`                  | Implement RuntimeAdapter interface              |
| Interactive prompts            | `src/core/prompt/`              | PromptEngine + resolver integration             |
| Generate JSON Schema           | `src/core/json-schema/`         | Schema → JSON Schema + meta-descriptions        |
| String-literal schema DSL      | `src/core/schema-dsl/`          | Compile-time parsing + runtime builder          |
| Shared execution pipeline      | `src/core/execution/`           | @internal parse → resolve → handler flow        |
| CLI plugins                    | `src/core/cli/plugin.ts`        | Plugin system + lifecycle hooks                 |

## DEPENDENCY GRAPH

```text
errors, schema          <- LEAF (zero internal deps)
  ^
parse, help, output     <- depend on schema/errors
  ^
prompt, config          <- depend on output/schema
  ^
resolve                 <- depends on parse/prompt/schema/errors
  ^
execution               <- depends on resolve/output/schema/errors (@internal shared pipeline)
  ^
completion, testkit     <- depend on many lower modules
  ^
cli                     <- TOP — depends on nearly everything (incl. execution, plugins)
```

Circular dependency avoidance: `prompt/` and `resolve/` import `schema/prompt.ts` directly
(bypassing barrel). `completion/` imports `cli/propagate.ts` directly. `output/` imports
`schema/command.ts` and `schema/activity.ts` directly. `runtime/adapter.ts` imports `WriteFn` from
`core/output/` and `ReadFn` from `core/prompt/` — runtime depends on core types.

`RunResult` lives in `schema/run.ts` (not testkit) — schema is its natural home since
`ErasedCommand._execute` returns it. `testkit/index.ts` re-exports `RunResult` from schema.

## CONVENTIONS

- **Tabs**, width 2, line width 100, single quotes, semicolons always, LF
- **`verbatimModuleSyntax`** — use `import type` for type-only imports
- **`.ts` extensions** in all relative imports (`allowImportingTsExtensions` + `noEmit`)
- **Maximum TS strictness** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **No `any`** (biome warns), **no `!` non-null assertion** (biome info)
- **Barrel-per-module** — each module has `index.ts` re-exporting public symbols
- **`@internal` JSDoc** marks symbols excluded from public API
- **Tests co-located** — `*.test.ts` next to source, aspect-split: `cli-json.test.ts`
- **Em-dash in describes** — `describe('thing — behavior', ...)`
- **Section separators** — `// ===` major, `// ---` minor, in all test files
- **Zero lifecycle hooks** in tests — isolation via testkit architecture
- **Zero snapshots** — all assertions explicit
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
  runtime detection boundaries — all guarded

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
bun run typecheck     # tsgo --noEmit (native TS type check)
bun run typecheck:tsc # tsc --noEmit (standard fallback)
bun run lint         # biome check .
bun run lint:fix     # biome check --fix .
bun run format       # dprint fmt
bun run format:check # dprint check
bun run test         # vitest run
bun run test:watch   # vitest (watch mode)
bun run bd           # tsdown (bundle + dts + publint + attw)
bun run ci           # check -> lint -> test -> build (sequential)
```

## NOTES

- **CI**: GitHub Actions — lint+typecheck (Bun), test matrix (Node LTS + Bun), Deno smoke test,
  build, coverage (Node only, v8 provider)
- **JSR publishing** — `deno.json` (`@kjanat/dreamcli`), GitHub Actions publish workflow with OIDC
- **npm publishing** — manual `bun publish`, quality gates in build step
- **~62 source files, 66 test files, ~17.5k source lines** — ~2200 tests
- **13 files >500 lines** — `schema/command.ts` (1466), `cli/index.ts` (1015), `json-schema/index.ts` (891),
  `schema/flag.ts` (753), `schema/arg.ts` (713), `output/index.ts` (669), `parse/index.ts` (661),
  `schema-dsl/runtime.ts` (574), `output/activity.ts` (568), `prompt/index.ts` (566),
  `help/index.ts` (557), `resolve/coerce.ts` (429), `deno.ts` (355)
- `cli/index.ts` split: `dispatch.ts` + `propagate.ts` + `planner.ts` + `plugin.ts` +
  `root-help.ts` + `root-surface.ts` + `runtime-preflight.ts` extracted as `@internal`
- `resolve/` split: `coerce.ts` + `flags.ts` + `args.ts` + `config.ts` + `errors.ts` +
  `property.ts` + `contracts.ts` extracted from monolithic index
- Prompt types defined in `schema/prompt.ts` but consumed by `core/prompt/` directly (bypasses
  barrel to avoid circular dep)
- `stdinIsTTY` gates interactive prompt auto-creation in `cli/index.ts` — prompts only activate when
  stdin is a TTY
- Three subpath exports: `"."`, `"./testkit"`, `"./runtime"` + `"./schema"` (JSON Schema)
- `src/` included in `files` (published source)
- `node-builtins.d.ts` — handwritten ambient module declarations for `node:readline` and
  `node:fs/promises` to avoid `@types/node` dependency
- Fake timers in tests: inline `vi.useFakeTimers()` with `try/finally`, never lifecycle hooks
- Version sync enforced: `scripts/check-version-sync.ts` validates package.json == deno.json
- Engine requirements: Node >=22.22.2, Bun >=1.3.11, Deno >=2.6.0
