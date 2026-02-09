# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[unreleased]: https://github.com/kjanat/dreamcli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kjanat/dreamcli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kjanat/dreamcli/releases/tag/v0.1.0
