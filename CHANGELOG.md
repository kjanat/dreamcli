# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Core Framework (MVP v0.1)

- **Structured errors** (`CLIError`, `ParseError`, `ValidationError`) with stable error codes, `toJSON()`
  serialization, type guard functions (`isCLIError`, `isParseError`, `isValidationError`), and
  actionable `suggest` hints.
- **Flag builder** (`flag`) with full type inference for boolean, string, number, enum, and array
  kinds. Supports `.alias()`, `.default()`, `.required()`, `.describe()`, `.hidden()`,
  `.deprecated()`, `.env()`, and `.config()` declarations.
- **Arg builder** (`arg`) with type inference for string, number, custom parse functions, and variadic
  args. Supports `.default()`, `.required()`, `.optional()`, and `.describe()`.
- **Command builder** (`command`) with `.flag()`, `.arg()`, `.description()`, `.example()`,
  `.hidden()`, `.alias()`, and `.action()`. Accumulates phantom types so handler receives fully
  inferred `flags` and `args`.
- **Argv parser** with tokenizer (`tokenize`) and schema-aware parser (`parse`). Handles long/short
  flags, `=` syntax, boolean negation (`--no-*`), flag stacking (`-abc`), `--` separator, and type
  coercion against the schema.
- **Resolution chain** (MVP scope: CLI parsed value → schema default). Validates all required
  flags/args, aggregates multiple errors into a single throw, and provides per-field suggestions.
- **Auto-generated help text** (`formatHelp`) from command schema, including usage line, description,
  positional args, flags with types/defaults/aliases, examples section, and subcommand listing.
- **Output channel** (`createOutput`) with `log`/`info`/`warn`/`error` methods, `WriteFn`
  abstraction, verbosity levels (normal/quiet), and TTY detection. Includes `createCaptureOutput()`
  test helper.
- **Test harness** (`runCommand`) for running commands as pure functions with injected argv, env, and
  captured output. Returns `RunResult` with `exitCode`, `stdout`, `stderr`, and `error`.
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
- Changelog file.
- Markdownlint configuration.
- Zed code editor configuration.
- An agent skill for writing CHANGELOG.
