# Planner Contract

This page records the internal planner boundary for the `dreamcli-re-foundation` workstream.
It is a stability target for tests and refactors, not a public API guarantee.

## Responsibilities

- intercept root `--help` and `--version`
- dispatch nested commands
- apply default-command fallback
- merge propagated flags while honoring child shadowing
- build the execution handoff for the matched command

## Non-Responsibilities

- parse flag or arg values
- read env, config, stdin, or prompt sources
- run middleware or action handlers
- decide concrete output writers or rendering mechanics

## Dispatch Outcome

The planner contract is modeled in `src/core/cli/planner.ts` as:

```ts
type DispatchOutcome =
  | { readonly kind: 'root-help'; readonly help: HelpOptions }
  | { readonly kind: 'root-version'; readonly version: string }
  | { readonly kind: 'dispatch-error'; readonly error: CLIError }
  | { readonly kind: 'match'; readonly plan: CommandExecutionPlan };
```

The intent is simple:

- `root-help` and `root-version` short-circuit before command execution
- `dispatch-error` captures CLI-level failures before parse and resolve
- `match` hands one explicit execution plan to the executor seam

## Command Execution Plan

```ts
interface CommandExecutionPlan {
  readonly command: ErasedCommand;
  readonly mergedSchema: CommandSchema;
  readonly argv: readonly string[];
  readonly meta: CommandMeta;
  readonly plugins: readonly CLIPlugin[];
  readonly output: OutputPolicy;
  readonly help: HelpOptions | undefined;
}
```

Field meaning:

| Field          | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `command`      | matched leaf command to execute                                     |
| `mergedSchema` | leaf schema after propagated ancestor flags are merged and shadowed |
| `argv`         | remaining argv after command-name dispatch                          |
| `meta`         | CLI metadata passed into middleware and actions                     |
| `plugins`      | CLI plugin list observed by the execution path                      |
| `output`       | semantic output facts: `jsonMode`, `isTTY`, `verbosity`             |
| `help`         | help formatting context carried through command execution           |

## Evidence

- Contract module: `src/core/cli/planner.ts`
- Current dispatcher: `src/core/cli/dispatch.ts`
- Current CLI orchestration: `src/core/cli/index.ts`
- RFC / PRD source: `specs/dreamcli-re-foundation.md`, `specs/dreamcli-re-foundation-prd.md`

## Current Status

- planner outcomes are now named explicitly in code
- matched-command handoff is built through one plan shape
- full planner extraction is still future work; current CLI orchestration remains in `CLIBuilder.execute()`
