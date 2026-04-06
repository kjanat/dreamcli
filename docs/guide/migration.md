# Migration And Adoption

This page is for serious evaluators and adopters deciding whether to move an existing CLI onto
dreamcli.

Use it after [Getting Started](/guide/getting-started) and [Why dreamcli](/guide/why): those pages
explain the shape of the framework; this page explains when switching is worth it and how to do it
without rewriting everything at once.

## Who Should Migrate

dreamcli is a strong fit when your CLI needs more than argv parsing.

Good signals:

- you want typed flags, args, and handler context without manual plumbing;
- values already come from multiple sources like env, config, prompts, or stdin;
- your CLI has several commands and shared behavior is starting to sprawl;
- you want in-process tests instead of subprocess-heavy harnesses;
- you care about generated help, completions, and structured output staying aligned with the same schema.

It is a weaker fit when you only need a tiny one-off parser script.
For that trade-off in product terms, also read [Limitations And Workarounds](/guide/limitations).

## Mental Model Shift

The main migration shift is this:

- parser-first tools usually parse argv, then the app wires env, config, prompts, output, and tests around that result;
- dreamcli expects the command schema to declare those concerns up front.

That means migration usually involves moving logic:

- out of ad hoc option-merging helpers;
- out of command handlers;
- into the schema chain for flags, args, prompts, config, middleware, and output choices.

The benefit is that the same declaration now drives parsing, resolution, help, completions, tests,
and docs-facing truth.

## Migration Path

### 1. Start With One Real Command

Do not rewrite the entire CLI first.
Pick one command with real flags and one or two value sources.

Keep the first migration boring:

- model the command with `command()`;
- move existing options into `flag.*()` and `arg.*()` definitions;
- keep the action body close to the old behavior until tests stay green.

### 2. Move Source Merging Into The Schema

If your current CLI has logic like this in handlers or helpers:

- argv overrides env;
- env overrides config;
- missing values fall back to prompts or defaults.

Move that into flag and arg declarations directly.

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag
  .enum(['us', 'eu', 'ap'])
  .env('DEPLOY_REGION')
  .config('deploy.region')
  .prompt({ kind: 'select', message: 'Which region?' })
  .default('us');
```

This is usually the highest-value migration step because it removes duplicated precedence logic from
the application layer.

### 3. Replace Glue Tests With `runCommand()`

Once one migrated command exists, move its tests to the in-process harness.

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';
import { runCommand } from '@kjanat/dreamcli/testkit';

const deploy = command('deploy')
  .flag(
    'region',
    flag
      .enum(['us', 'eu', 'ap'])
      .env('DEPLOY_REGION')
      .config('deploy.region'),
  )
  .action(() => {});

const result = await runCommand(deploy, ['production'], {
  env: { DEPLOY_REGION: 'eu' },
  config: { deploy: { region: 'us' } },
});
```

This is where dreamcli often pays off fastest for maintainers:

- no subprocess boot cost;
- no `process.argv` mutation;
- no separate test-only env/config plumbing.

### 4. Add Middleware And Output Only Where They Help

Do not front-load advanced features.

Adopt them when the current command shape actually benefits:

- middleware for shared typed setup, auth, or derived context;
- `out` helpers when you want consistent text/JSON/table activity behavior;
- completions when the command tree is stable enough to support shell install docs.

### 5. Expand Command By Command

After one migrated command is stable:

- migrate adjacent commands that share the same context or value sources;
- extract shared middleware only after duplication is real;
- leave low-value legacy commands on the old path until there is a reason to move them.

## Tool-Shape Mapping

This is the rough adoption mapping from common CLI styles to dreamcli concepts.

| Existing shape                    | Typical current home             | DreamCLI target surface                    |
| --------------------------------- | -------------------------------- | ------------------------------------------ |
| option parser declarations        | parser setup                     | `command()`, `flag.*()`, `arg.*()`         |
| env fallback helpers              | handler or config utility        | `.env()` on flags or args                  |
| config lookup glue                | app bootstrap or command helper  | `cli().config()` plus `.config()` on flags |
| prompt fallback logic             | handler branch or prompt wrapper | `.prompt()` or `.interactive()`            |
| command-level shared setup        | copied pre-handler logic         | middleware / derive                        |
| JSON mode and table formatting    | custom output utility            | `out.json()`, `out.table()`, output policy |
| subprocess command tests          | test runner shell wrapper        | `runCommand()`                             |
| shell completion hand-maintenance | shell scripts or plugin glue     | built-in completions generation            |

## Adoption Checklist

Use this checklist for a real migration.

1. Identify one command with meaningful flags and source precedence.
2. Move value-source rules into schema declarations.
3. Recreate its current behavior under `runCommand()` tests.
4. Confirm help text and examples still explain the command clearly.
5. Add completions or structured output only after the command surface settles.
6. Migrate shared setup into middleware only after at least two commands need it.

## When Not To Switch Yet

Delay migration if any of these are true:

- your CLI is intentionally tiny and unlikely to grow;
- your team only wants argv parsing and nothing else;
- you depend on broad legacy runtime coverage below DreamCLI's documented floors;
- your current CLI behavior is still unstable enough that formalizing it in schema would slow you down.

In those cases, a thinner parser may be the more honest choice for now.

## Related Pages

- [Why dreamcli](/guide/why)
- [Architecture Rationale](/guide/rationale)
- [Limitations And Workarounds](/guide/limitations)
- [Troubleshooting](/guide/troubleshooting)
- [Testing Commands](/guide/testing)
- [Support Matrix](/reference/support-matrix)
