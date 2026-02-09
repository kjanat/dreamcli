# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-02-09

### Added

#### Typed Middleware

- **`middleware<Output>(handler)`** factory creating phantom-branded `Middleware<Output>` values.
  Handler receives `{ args, flags, ctx, out, next }` — call `next(additions)` to continue the chain
  with typed context, omit `next()` to short-circuit (auth guards), or await `next()` for
  wrap-around patterns (timing, try/catch).
- **`CommandBuilder.middleware(m)`** registers middleware in execution order. Each call widens the
  context type parameter `C` via `WidenContext<C, Output>` intersection — `Record<string, never>`
  (the default) is replaced entirely on the first call, preventing `never` collapse. Adding
  middleware drops the current handler (type signature changed).
- **Context type parameter `C`** on `CommandBuilder<F, A, C>`, `ActionParams<F, A, C>`, and
  `ActionHandler<F, A, C>`. `ctx` in the action handler is `Readonly<C>` — property access is a type
  error until middleware extends it.
- **Middleware chain execution** (`executeWithMiddleware`) in testkit. Builds a continuation chain
  from back to front; context accumulates via `{ ...ctx, ...additions }` at each step. Replaces the
  former `invokeHandler` bridge.

#### Structured Output

- **`out.json(value)`** emits `JSON.stringify(value)` to stdout. Always targets stdout regardless of
  JSON mode. Handlers should prefer this over `out.log(JSON.stringify(...))`.
- **`out.table(rows, columns?)`** renders tabular data. In JSON mode: emits rows as JSON array. In
  text mode: pretty-prints aligned columns with headers (auto-inferred from first row when `columns`
  omitted). `TableColumn<T>` descriptor type with `key` and optional `header`.
- **`out.jsonMode`** and **`out.isTTY`** readonly properties on `Out` interface. Handlers check
  these to skip decorative output (spinners, ANSI codes) when machine-readable output is expected or
  stdout is piped.
- **`--json` global flag** detection in `CLIBuilder.execute()`. Strips `--json` from argv before
  command dispatch. CLI-level dispatch errors (unknown command, no action) rendered as JSON when
  active.
- **`jsonMode`** and **`isTTY`** options on `RunOptions`, `CLIRunOptions`, and `OutputOptions`.
  `CLIBuilder.run()` auto-sources `isTTY` from `adapter.isTTY`.

### Changed

- `ActionParams<F, A>` → `ActionParams<F, A, C>` with `ctx: Readonly<C>` (was
  `Readonly<Record<string, unknown>>`).
- `CommandBuilder` carries third type parameter `C` (default `Record<string, never>`). All
  metadata/builder methods preserve `C` in return type.
- `CommandSchema.middleware` added as `readonly ErasedMiddlewareHandler[]`.
- `Out` interface extended with `json()`, `table()`, `jsonMode`, and `isTTY`.
- `OutputChannel` constructor accepts `isTTY` and `jsonMode` from resolved options. `log`/`info`
  redirect to stderr writer in JSON mode.
- `runCommand` and `CLIBuilder.execute` error paths render JSON when `jsonMode` active.
- `createCaptureOutput` accepts `jsonMode` and `isTTY` options.
- Test count: 1010 tests across 31 test files (up from 797 in v0.3.0).

## [0.3.0] - 2026-02-09

### Added

#### Interactive Prompting

- **Prompt type definitions** (`PromptConfig`) as a discriminated union with four kinds: `confirm`,
  `input`, `select`, `multiselect`. Each kind has specialized fields — `InputPromptConfig` supports
  `placeholder` and `validate`, select/multiselect support `SelectChoice` arrays with optional
  labels and descriptions.
- **`FlagBuilder.prompt(config)`** metadata modifier for declaring prompt configuration on flags,
  following the same immutable builder pattern as `.env()` and `.config()`.
- **Prompt engine interface** (`PromptEngine`) with `promptOne(config) → Promise<PromptResult>` as a
  pluggable renderer seam. `ResolvedPromptConfig` variant guarantees non-empty choices for
  select/multiselect after merging from `FlagSchema.enumValues`.
- **Built-in terminal prompter** (`createTerminalPrompter(read, write)`) with line-based I/O for
  confirm (y/n), input (with validation and placeholder), select (numbered list), and multiselect
  (comma-separated numbers with min/max). All prompts have a `MAX_RETRIES = 10` safety valve.
- **Test prompter** (`createTestPrompter(answers, options?)`) with queue-based answers for
  deterministic testing. `PROMPT_CANCEL` symbol sentinel for simulating cancellation.
  `onExhausted: 'throw' | 'cancel'` controls behavior when answer queue is empty.
- **Prompt resolution in the resolver**. Resolution chain expanded from CLI > env > config > default
  to CLI > env > config > **prompt** > default. Flags with prompt config and no value from prior
  sources trigger `prompter.promptOne()`. Cancelled prompts fall through to default/required.
  Non-interactive mode (no prompter) skips prompts entirely.
- **`ReadFn`** (`() => Promise<string | null>`) as the minimal stdin abstraction. `null` signals
  EOF/cancel. `RuntimeAdapter` extended with `stdin: ReadFn` and `stdinIsTTY: boolean`.
- **Node adapter stdin** wraps `process.stdin` via dynamic `import('node:readline')` with lazy
  per-call readline interfaces. Minimal `node:readline` type declarations in `node-builtins.d.ts`
  avoid `@types/node` dependency.
- **Automatic prompt gating** in `CLIBuilder.run()`: when `stdinIsTTY=true` and no explicit prompter
  provided, auto-creates `createTerminalPrompter(adapter.stdin, adapter.stderr)`. Prompt output
  routed to stderr to avoid interfering with piped stdout.
- **Command-level `.interactive(resolver)`** API on `CommandBuilder`. Resolver receives partially
  resolved flags (after CLI/env/config), returns `Record<string, PromptConfig | false | undefined>`
  controlling which flags get prompted. Truthy `PromptConfig` overrides per-flag prompt; `false`
  explicitly suppresses; absent falls back to per-flag `.prompt()` config.
- **Testkit `answers` convenience** on `RunOptions`. Accepts `Record<string, TestAnswer>` to
  auto-create a test prompter. `prompter` field also available for explicit engine injection.
  `CLIRunOptions` mirrors both fields.

### Changed

- `resolve()` is now **async** (`Promise<ResolveResult>`). All callers (`runCommand`,
  `CLIBuilder.execute`, `CLIBuilder.run`) updated to await.
- Resolution chain expanded from CLI > env > config > default to CLI > env > config > prompt >
  default.
- `ResolveOptions` extended with optional `prompter: PromptEngine` field.
- `RunOptions` extended with `prompter` and `answers` fields.
- `CLIRunOptions` extended with `prompter` and `answers` fields.
- `RuntimeAdapter` extended with `stdin: ReadFn` and `stdinIsTTY: boolean`.
- `createTestAdapter` defaults to EOF-returning stdin and `stdinIsTTY: false`.
- Test count: 797 tests across 21 test files (up from 599 in v0.2.0).

## [0.2.0] - 2026-02-09

### Added

#### Resolution Chain

- **Environment variable resolution** in the resolver. Flags with `.env('VAR')` now resolve from the
  `env` record after CLI and before default. String, number, boolean (lenient:
  `true/false/1/0/yes/no`), enum, and array (comma-separated) coercion. Invalid env values produce
  `ValidationError` with `TYPE_MISMATCH` or `INVALID_ENUM` codes.
- **Config object resolution** in the resolver. Flags with `.config('dotted.path')` resolve from a
  plain `Record<string, unknown>` after env and before default. `resolveConfigPath()` walks nested
  objects segment-by-segment. Config values may already be typed from JSON — coercion is lenient for
  matching types. Full chain: CLI > env > config > default.
- **Resolution source annotations** in help text. Flags with env or config declarations now display
  `[env: VAR]` and `[config: path]` in `formatHelp()` output, ordered between description text and
  presence indicators.
- **Actionable required-flag error hints**. When a required flag is missing after full resolution,
  `ValidationError.suggest` lists all configured sources (e.g. "Provide --region, set DEPLOY_REGION,
  or add deploy.region to config"). CI-friendly error messages with `envVar`/`configPath` in
  details.
- **Env/config wiring through testkit and CLI builder**. `RunOptions` and `CLIRunOptions` accept
  `env` and `config` fields. `runCommand()` threads them into `resolve()`. `CLIBuilder.run()`
  auto-sources `adapter.env` when no explicit env option is provided.

### Changed

- Resolution chain expanded from CLI > default (v0.1) to CLI > env > config > default.
- `resolve()` now accepts optional `ResolveOptions` parameter with `env` and `config` fields.
- `ResolveOptions` exported from public API surface.

## [0.1.0] - 2026-02-09

### Added

#### Core Framework

- **Structured errors** (`CLIError`, `ParseError`, `ValidationError`) with stable error codes,
  `toJSON()` serialization, type guard functions (`isCLIError`, `isParseError`,
  `isValidationError`), and actionable `suggest` hints.
- **Flag builder** (`flag`) with full type inference for boolean, string, number, enum, and array
  kinds. Supports `.alias()`, `.default()`, `.required()`, `.describe()`, `.hidden()`,
  `.deprecated()`, `.env()`, and `.config()` declarations.
- **Arg builder** (`arg`) with type inference for string, number, custom parse functions, and
  variadic args. Supports `.default()`, `.required()`, `.optional()`, and `.describe()`.
- **Command builder** (`command`) with `.flag()`, `.arg()`, `.description()`, `.example()`,
  `.hidden()`, `.alias()`, and `.action()`. Accumulates phantom types so handler receives fully
  inferred `flags` and `args`.
- **Argv parser** with tokenizer (`tokenize`) and schema-aware parser (`parse`). Handles long/short
  flags, `=` syntax, boolean negation (`--no-*`), flag stacking (`-abc`), `--` separator, and type
  coercion against the schema.
- **Resolution chain** (CLI parsed value → schema default). Validates all required flags/args,
  aggregates multiple errors into a single throw, and provides per-field suggestions.
- **Auto-generated help text** (`formatHelp`) from command schema, including usage line,
  description, positional args, flags with types/defaults/aliases, examples section, and subcommand
  listing.
- **Output channel** (`createOutput`) with `log`/`info`/`warn`/`error` methods, `WriteFn`
  abstraction, verbosity levels (normal/quiet), and TTY detection. Includes `createCaptureOutput()`
  test helper.
- **Test harness** (`runCommand`) for running commands as pure functions with injected argv, env,
  and captured output. Returns `RunResult` with `exitCode`, `stdout`, `stderr`, and `error`.
- **CLI builder** (`cli`) with `.command()` registration, `.version()`, subcommand dispatch,
  automatic `--help`/`--version` flag handling, and unknown-command error with suggestions.
- **RuntimeAdapter interface** defining the platform abstraction boundary (argv, env, cwd,
  stdout/stderr, isTTY, exit). Includes `createTestAdapter()` for injectable test stubs and
  `ExitError` for testable process exits.
- **Node.js adapter** (`createNodeAdapter`) wiring `process.argv`, `process.env`, `process.cwd()`,
  `process.stdout`/`stderr`, and TTY detection.
- Stub files for Bun adapter, Deno adapter, runtime auto-detection, and shell completion generation.

#### Project Infrastructure

- Project scaffold with `src/` structure, TypeScript strict config, and ESM + CJS dual build via
  tsdown.
- Vitest test framework with 464 passing tests across 12 test files.
- Biome linter and dprint formatter configuration.
- `@vitest/coverage-v8` for test coverage reporting.
- `@arethetypeswrong/cli` and `publint` for package quality checks.
- CI script (`pnpm run ci`) running typecheck, lint, test, and build in sequence.
- PRD.md with full product requirements document.
- MIT License.
- Markdownlint configuration.

[unreleased]: https://github.com/kjanat/dreamcli/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/kjanat/dreamcli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kjanat/dreamcli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kjanat/dreamcli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kjanat/dreamcli/releases/tag/v0.1.0
