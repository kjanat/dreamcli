# PRD — DreamCLI: A Schema-First, Fully Typed TypeScript CLI Framework (Node + Bun + Deno)

> ## Intro
>
> Today’s TypeScript CLI tooling mostly treats the type system like decoration: you define
> flags/args in one place, then you *use* parsed values somewhere else as a loosely typed blob. On
> top of that, interactive prompting lives in a separate universe from parsing, config/env/CLI
> merging gets re-invented per project, testing tends to be gross (`process.argv` hacks or shelling
> out), completions are bolted on, and output/error handling is inconsistent and hard to make both
> human-friendly *and* script-friendly.
>
> The proposed fix is “Zod, but for CLIs”: a schema-first builder where the schema is the single
> source of truth and everything (types, parsing, help text, resolution from
> env/config/prompts/defaults, completions, testing, structured output/errors, middleware context)
> flows from it—while staying runtime-agnostic across Node/Bun/Deno via a thin adapter layer.

### 1) Product vision

Build the CLI framework that TypeScript developers *wish* existed: define commands/flags/args once,
get perfect inference everywhere, and have the runtime do the boring-but-hard stuff (resolution
chain, prompts, config, completions, testing, structured output, errors) reliably and portably
across Node/Bun/Deno.

The guiding mantra:

**Single source of truth → full type inference → guaranteed resolution → testable without the
process → great UX by default.**

---

### 2) Problem statement

Modern TS CLI frameworks typically fail at the exact thing TypeScript is for: keeping definitions
and usage in sync.

**Key gaps in the ecosystem:**

- **Type disconnect:** CLI schema definition doesn’t strongly type the parsed result used in
  handlers.
- **Interactive prompting is duct-tape:** prompts are separate from parsing; developers manually
  prompt based on missing flags.
- **Resolution chain is ad-hoc:** merging CLI args + env vars + config + defaults is repeated per
  project with slightly different rules.
- **Testing is second-class:** command logic is entangled with `process.argv`, IO, and process
  exits.
- **Completions are an afterthought:** added late, brittle, and rarely aligned with the true CLI
  schema.
- **Output & errors are primitive:** hard to support both “nice TTY UX” and “machine output”
  cleanly.

---

### 3) Goals & success criteria

#### Goals (what success looks like)

1. **Perfect inference in handlers** If you define `.flag("region", enum(["us","eu"]))`, then
   `flags.region` is `"us" | "eu"` in `.action()`. No manual interfaces, no generic gymnastics.

2. **Guaranteed resolution before action** By the time `.action()` runs, every declared flag has a
   final value from a documented chain: **CLI → env → config → prompt → default** (and required
   values either resolve or produce a structured error).

3. **Runtime-agnostic core** 95% portable core (parser/type engine/resolution/help/completions
   generation), plus thin adapters for Node/Bun/Deno.

4. **Test-first design** Commands run as pure-ish functions with injected runtime state:
   `command.run(argv, { env, config, stdin, stdout, cwd })`

5. **First-class UX** Beautiful help, sane errors with suggestions, consistent output behaviors,
   built-in `--json` mode, and completions aligned to schema.

#### Non-goals (explicitly not trying to be)

- A full TUI framework (we’ll support prompts/spinners/tables, but not build a terminal UI empire).
- A build tool / bundler / packaging system (we integrate nicely, we don’t replace).
- A runtime abstraction layer for everything (only the small set of genuinely divergent edges).

#### Success metrics

- **DX metrics**

  - Time-to-first-working-command (TTFWC) for a new CLI: target < 10 minutes.
  - Zero “define types twice” moments in standard usage.
  - “Help text drift” becomes impossible (help is generated from schema).
- **Quality metrics**

  - 100% of parsing/resolution behavior is covered by deterministic tests (no `process.argv`
    required).
  - Compatibility test suite passes on Node LTS, Bun stable, and Deno stable.
- **Performance metrics**

  - Minimal cold-start overhead from the framework (avoid heavy deps, keep core lean and
    tree-shakeable).

---

### 4) Target users & primary use cases

#### Target users

- TS developers building internal tools, devops CLIs, release utilities, codegen, scaffolding tools.
- OSS maintainers who want a serious CLI without inheriting a thousand dependencies and bad typing.
- Teams that need consistent config/env/CLI behaviors across multiple tools.

#### Core use cases

- Multi-command tools (`tool deploy`, `tool login`, `tool init`).
- “Hybrid” CLIs: accept flags, but fall back to interactive prompts for missing values.
- Tools that must run in CI (non-interactive) and on laptops (interactive).
- CLIs used both by humans and scripts (TTY pretty output vs JSON output).

---

### 5) Product principles

1. **Schema is the law.** Everything derives from it: parsing, types, resolution, help, completions.

2. **Progressive disclosure.** A 5-line script stays 5 lines. Complexity scales by composition, not
   boilerplate.

3. **Deterministic behavior.** Resolution rules are explicit and consistent. No surprising implicit
   overrides.

4. **Portable by default.** Core avoids runtime-specific APIs; adapters handle the weird bits.

5. **Ergonomic, not clever.** When forced to choose, pick predictable DX over type-theory stunts.

---

### 6) Proposed API (developer-facing)

#### Basic example

```ts
import { arg, cli, command, flag } from '@kjanat/dreamcli';

const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string().describe('Deploy target'))
	.flag('force', flag.boolean().default(false).alias('f'))
	.flag('region', flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION').config('deploy.region'))
	.interactive(({ flags }) => ({
		region: !flags.region && {
			type: 'select',
			message: 'Select region',
			options: ['us', 'eu', 'ap'],
		},
	}))
	.middleware(authMiddleware)
	.action(async ({ args, flags, ctx, out }) => {
		// args.target: string
		// flags.force: boolean
		// flags.region: "us" | "eu" | "ap"  (guaranteed resolved)
		out.log(`Deploying ${args.target} to ${flags.region}...`);
	});

cli('mycli').version('1.0.0').command(deploy).run(); // reads argv/env from runtime adapter by default
```

#### Middleware with typed context propagation

```ts
import { CLIError, middleware } from '@kjanat/dreamcli';

const authMiddleware = middleware(async ({ next }) => {
	const user = await getUser();
	if (!user) {
		throw new CLIError('Not authenticated', {
			code: 'AUTH_REQUIRED',
			suggest: 'Run `mycli login`',
			exitCode: 2,
		});
	}

	return next({ user }); // ctx.user becomes typed downstream
});
```

#### Testability without touching process state

```ts
const result = await deploy.run(['production', '--force'], {
	env: { DEPLOY_REGION: 'eu' },
	config: { deploy: { region: 'us' } },
	stdin: 'tty', // or a stream
	stdout: 'capture',
});

expect(result.exitCode).toBe(0);
expect(result.output.text).toContain('Deploying production to eu');
```

---

### 7) Functional requirements

#### FR1 — Command & schema builder

- Support command trees: root CLI → commands → subcommands.
- Commands can define:

  - positional args: required/optional, variadic, typed parsing
  - flags/options: boolean/string/number/enum/array/custom
  - descriptions, examples, aliases, hidden/deprecated flags
- Handlers receive typed `args`, typed `flags`, typed `ctx`, typed `out`.

**Acceptance:** no separate type declaration required for typical usage; `.action()` types derive
entirely from `.arg()`/`.flag()` definitions.

---

#### FR2 — Unified resolution chain (guaranteed final values)

Each flag may declare any of these sources:

- CLI: `--region eu`
- ENV: `.env("DEPLOY_REGION")`
- Config: `.config("deploy.region")`
- Prompt: `.interactive(...)` or per-flag prompt definition
- Default: `.default("us")`

Resolution order (default): **CLI → ENV → CONFIG → PROMPT → DEFAULT**

Rules:

- If a value is required and not resolved:

  - in interactive mode: prompt (if prompt exists) else error
  - in non-interactive mode (CI/piped): error with actionable hint
- The action handler must never see “maybe unresolved” for declared flags unless explicitly opted
  into.

**Acceptance:** with a required `region` flag that has env/config/prompt/default, `.action()` always
sees a `region` value (or fails before handler).

---

#### FR3 — Interactive prompting integrated into schema

- `.interactive(resolver)` receives partially resolved values (after CLI/env/config).
- It returns a prompt schema for any missing values.
- Prompt system must be:

  - pluggable (custom renderer allowed)
  - portable (works across runtimes)
  - safe in non-interactive contexts (auto-disable; errors instead)

**Acceptance:** developers do not write “if missing then prompt” imperative spaghetti; prompts are
declared as part of resolution.

---

#### FR4 — Structured errors & help-aware failures

Provide a base error type like `CLIError` with fields:

- `message` (human)
- `code` (stable identifier)
- `exitCode` (defaults by category)
- `suggest` (one-liner hint)
- `details` (structured payload for JSON output)
- optional `cause`

Behavior:

- All framework errors render nicely in TTY:

  - short message
  - suggestion(s)
  - relevant help excerpt when appropriate
- In `--json` mode, errors emit machine-readable JSON to stdout/stderr (configurable).

**Acceptance:** parse/validation errors include “did you mean” suggestions and point to the exact
flag/arg.

---

#### FR5 — Output channel that respects context (TTY vs pipe, human vs machine)

Handlers receive an `out` object instead of encouraging raw `console.log`. `out` supports:

- `log/info/warn/error`
- `json(value)` (for scripting)
- `table(rows, columns)` (TTY pretty; JSON when piped or `--json`)
- `spinner/progress` that auto-disables when not TTY

Defaults:

- TTY → pretty
- piped → minimal + stable
- `--json` → structured output

**Acceptance:** one code path yields correct output behavior across interactive use, piping, and CI.

---

#### FR6 — Shell completions generated from schema

- Generate completion scripts for: bash, zsh, fish, PowerShell (initially at least bash + zsh).
- Completion generation uses the command tree and flag definitions.
- Provide commands like:

  - `mycli completions generate --shell zsh`
  - `mycli completions install --shell zsh`
- Installation path logic is runtime-dependent → handled by adapter.

**Acceptance:** completions reflect the same schema as parsing/help, with no duplicate definition.

---

#### FR7 — Configuration support baked in (but optional)

- Config discovery (default):

  - explicit `--config path`
  - then standard locations (XDG-style where possible)
  - plus local project config (optional)
- Support at least JSON initially; YAML/TOML via optional peer deps or plugin hooks.

**Acceptance:** `.config("deploy.region")` resolves reliably across runtimes, with documented search
order.

---

#### FR8 — Runtime portability via adapters

Core must not import runtime-specific modules directly.

Define a minimal adapter interface:

- argv/env access
- filesystem read (config, completions)
- path/home/config-dir resolution
- TTY detection
- spawning subprocesses (for advanced features)
- stdin/stdout streams

Adapters:

- `runtime/node.ts`
- `runtime/bun.ts`
- `runtime/deno.ts`
- `runtime/detect.ts` chooses default adapter at runtime

**Acceptance:** same user-facing API works without change on Node/Bun/Deno.

---

### 8) Non-functional requirements

- **TypeScript ergonomics:** avoid type explosions that make TS slow or unreadable in editor hovers.
- **Small dependency footprint:** prefer zero-dep core; optional extras behind adapters/plugins.
- **Tree-shakeable ESM:** modern packaging with ESM-only exports and clear defaults.
- **Deterministic tests:** no reliance on wall-clock time, real filesystem, or actual TTY unless
  explicitly integrated.

---

### 9) System design overview

#### High-level architecture

```tree
dreamcli/
  core/
    schema/        # command/flag/arg builders
    parse/         # argv tokenization + parsing
    resolve/       # CLI/env/config/prompt/default pipeline
    help/          # help text generator
    completion/    # completion generator (scripts)
    output/        # out channel + formatting
    errors/        # structured errors
    testkit/       # run() harness + capture utilities
  runtime/
    adapter.ts     # interface
    detect.ts      # chooses node/bun/deno
    node.ts
    bun.ts
    deno.ts
  index.ts         # re-exports + default runtime binding
```

#### Execution pipeline (conceptual)

1. Build schema (commands/flags/args)
2. Parse argv tokens → typed-ish raw values
3. Resolve each flag:

   - cli → env → config → prompt → default

4. Run middleware chain → produce typed ctx
5. Execute action handler with fully resolved values
6. Render output/errors according to mode (TTY/pipe/--json)
7. Return structured result (even when invoked via CLI entry)

---

### 10) Packaging & distribution

- Publish to **npm** (Node/Bun) with:

  - ESM build
  - `exports` map with `types`
- Publish to **JSR** (Deno-first, also consumable elsewhere) for first-class TS consumption.
- Keep runtime adapters internal but tree-shakeable.

---

### 11) Release plan (milestones)

**MVP (v0.1):** Schema builder, parsing, inference into `.action()`, auto-help, basic errors,
`command.run()` test harness. *(done)*

**v0.2:** Resolution chain (env/config/default), required handling, non-interactive behavior rules.
*(done)*

**v0.3:** Interactive prompting integration (portable prompt engine + pluggable renderer). *(done)*

**v0.4:** Middleware + typed context, structured output channel (`--json`, TTY detection, table).
*(done)*

**v0.5:** Completions generation (bash/zsh), runtime detection, Bun adapter. *(done)*

**v0.6:** Config file discovery + loading (XDG search paths, `--config` flag, JSON loader, plugin
hook for YAML/TOML). Extend `RuntimeAdapter` with filesystem/path primitives (`readFile`, `homedir`,
`configDir`). Add `flag.custom(parseFn)` and `.deprecated()` modifier with help/parse warnings.
*(done)*

**v0.7:** Subcommand nesting (command trees: root > group > leaf, nested help, nested completion,
nested dispatch in CLIBuilder). *(done)*

**v0.8:** Spinner/progress on Out (`out.spinner()`, `out.progress()`, auto-disable on `!isTTY`,
suppress in `--json` mode, testkit capture).

**v0.9:** Deno adapter + cross-runtime CI (Deno-specific APIs, permission handling, cross-runtime
test matrix, adapter parity tests). JSR publishing.

**v1.0:** Stability guarantees, plugin lifecycle hooks (`beforeParse`, `afterResolve`,
`beforeAction`, `afterAction`), public API audit, JSDoc coverage, README, compatibility matrix
locked.

---

### 12) Risks & mitigations

- **Type inference complexity (TS performance):** Keep inference “local” (accumulate schema types
  incrementally), avoid mega-unions, provide escape hatches (`.cast<T>()` or `.unsafe()` only when
  necessary).

- **Prompt portability:** Build a minimal prompt layer on standard streams; allow swapping in a
  fancier renderer as an optional integration.

- **Deno permissions & filesystem constraints:** Make config/completions opt-in when permissions
  missing; fail with precise guidance.

- **ESM-only ecosystem friction:** Provide clean ESM exports and document migration/interop patterns.

- **Completions installation differences across shells/OS:** Treat install as “best effort”, with a
  `generate` command always available and clear manual instructions.

---

### 13) What makes this “awesome” (the differentiators)

DreamCLI wins by collapsing five separate toolchains into one coherent, typed system:

- schema-driven parsing **and** inference
- schema-driven prompts (no glue logic)
- schema-driven help **and** completions (no drift)
- schema-driven resolution chain (no bespoke config/env merging)
- test harness built in (no `process.argv` rituals)
- middleware-based composition with typed context (auth/telemetry/logging that doesn’t turn into
  spaghetti)

If you build exactly this—and keep the dependency footprint sane—you end up with the CLI equivalent
of “the framework disappears and your app code is all that remains,” which is basically the highest
compliment developer tooling can get.
