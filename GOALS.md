# Goals

> Today's TypeScript CLI tooling mostly treats the type system like decoration: you define flags/args
> in one place, then you _use_ parsed values somewhere else as a loosely typed blob. Interactive
> prompting lives in a separate universe from parsing, config/env/CLI merging gets re-invented per
> project, testing tends to be gross (`process.argv` hacks or shelling out), completions are bolted
> on, and output/error handling is inconsistent and hard to make both human-friendly _and_
> script-friendly.
>
> DreamCLI is "Zod, but for CLIs": a schema-first builder where the schema is the single source of
> truth and everything—types, parsing, help text, resolution from env/config/prompts/defaults,
> completions, testing, structured output/errors, middleware context—flows from it. Runtime-agnostic
> across Node, Bun, and Deno via a thin adapter layer. Zero runtime dependencies.

---

## The mantra

**Single source of truth → full type inference → guaranteed resolution → testable without the
process → great UX by default.**

---

## What we're solving

Modern TS CLI frameworks typically fail at the exact thing TypeScript is for: keeping definitions and
usage in sync.

- **Type disconnect.** CLI schema definition doesn't strongly type the parsed result used in
  handlers.
- **Interactive prompting is duct-tape.** Prompts are separate from parsing; developers manually
  prompt based on missing flags.
- **Resolution chain is ad-hoc.** Merging CLI args + env vars + config + defaults is repeated per
  project with slightly different rules.
- **Testing is second-class.** Command logic is entangled with `process.argv`, IO, and process exits.
- **Completions are an afterthought.** Added late, brittle, and rarely aligned with the true CLI
  schema.
- **Output & errors are primitive.** Hard to support both "nice TTY UX" and "machine output" cleanly.

---

## Principles

1. **Schema is the law.** Everything derives from it: parsing, types, resolution, help, completions.

2. **Progressive disclosure.** A 5-line script stays 5 lines. Complexity scales by composition, not
   boilerplate.

3. **Deterministic behavior.** Resolution rules are explicit and consistent. No surprising implicit
   overrides.

4. **Portable by default.** Core avoids runtime-specific APIs; adapters handle the weird bits.

5. **Ergonomic, not clever.** When forced to choose, pick predictable DX over type-theory stunts.

6. **Zero runtime dependencies.** The core stays lean and tree-shakeable. No transitive dependency
   supply-chain anxiety.

---

## What we promise

### Perfect inference in handlers

Define `.flag("region", enum(["us","eu"]))`, get `flags.region` typed as `"us" | "eu"` in
`.action()`. No manual interfaces, no generic gymnastics. No separate type declaration required for
typical usage—`.action()` types derive entirely from `.arg()` and `.flag()` definitions.

```ts
const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string().describe('Deploy target'))
	.flag('force', flag.boolean().default(false).alias('f'))
	.flag('region', flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION').config('deploy.region'))
	.middleware(authMiddleware)
	.action(async ({ args, flags, ctx, out }) => {
		// args.target: string
		// flags.force: boolean
		// flags.region: "us" | "eu" | "ap"  — guaranteed resolved
		// ctx.user: User                     — typed from middleware
		out.log(`Deploying ${args.target} to ${flags.region}...`);
	});

cli('mycli').version('1.0.0').command(deploy).run();
```

### Guaranteed resolution before action

By the time `.action()` runs, every declared flag has a final value from a documented chain:\
**CLI → env → config → prompt → default.**\
The handler never sees "maybe undefined."

Each flag may declare any combination of sources. Resolution follows the chain in order. If a value
is required and not resolved: in interactive mode, prompt (if a prompt exists), else error. In
non-interactive mode (CI, piped), error with an actionable hint.

### Prompting without spaghetti

Interactive prompting is declared as part of resolution, not bolted on with imperative "if missing
then prompt" logic. The prompt system receives partially resolved values (after CLI/env/config) and
returns a prompt schema for anything still missing. It's pluggable (custom renderer allowed),
portable (works across runtimes), and safe in non-interactive contexts (auto-disables; errors
instead of hanging).

### Middleware with typed context

Middleware composes cleanly and propagates typed context downstream. Auth checks, telemetry, logging,
feature flags—whatever you need before the handler runs—without turning into spaghetti:

```ts
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

### Errors that help

Parse and validation errors include "did you mean" suggestions and point to the exact flag or arg.
Every framework error renders nicely in TTY (short message, suggestion, relevant help excerpt) and
emits machine-readable JSON in `--json` mode. All errors carry a stable `code`, an `exitCode`, and
optional structured `details`.

### Output that respects context

Handlers receive an `out` object instead of encouraging raw `console.log`. One code path yields
correct output behavior across interactive use, piping, and CI:

- TTY → pretty, human-friendly
- Piped → minimal, stable
- `--json` → structured output

Tables, spinners, and progress bars auto-disable when they can't render. No "why is my CI log full
of ANSI garbage" moments.

### Completions from the schema

Shell completions are generated from the command tree and flag definitions—the same source of truth
as parsing and help. No duplicate definition, no drift. Completions reflect the real CLI because they
_are_ the real CLI.

### Config discovery baked in

Flags can declare `.config("deploy.region")` and it just works: explicit `--config path`, then
standard locations (XDG-style), plus local project config. JSON built in; YAML/TOML via plugin
hooks.

### Testable without touching process state

Commands run as pure-ish functions with injected runtime state. No `process.argv` hacks, no shelling
out, no mocking globals:

```ts
const result = await deploy.run(['production', '--force'], {
	env: { DEPLOY_REGION: 'eu' },
	config: { deploy: { region: 'us' } },
});

expect(result.exitCode).toBe(0);
expect(result.output.text).toContain('Deploying production to eu');
```

### Runtime portability

The core never imports runtime-specific modules directly. A thin adapter interface handles argv/env
access, filesystem reads, path resolution, TTY detection, subprocess spawning, and stdin/stdout
streams. Adapters for Node, Bun, and Deno. Same user-facing API, no code changes.

---

## Non-goals

- A full TUI framework. We support prompts, spinners, and tables—we don't build a terminal UI
  empire.
- A build tool, bundler, or packaging system. We integrate nicely; we don't replace.
- A runtime abstraction layer for everything. Only the small set of genuinely divergent edges.

---

## What makes this different

DreamCLI wins by collapsing five separate toolchains into one coherent, typed system:

- Schema-driven parsing **and** inference
- Schema-driven prompts (no glue logic)
- Schema-driven help **and** completions (no drift)
- Schema-driven resolution chain (no bespoke config/env merging)
- Test harness built in (no `process.argv` rituals)
- Middleware-based composition with typed context (auth/telemetry/logging that doesn't turn into
  spaghetti)

The framework disappears and your app code is all that remains.
