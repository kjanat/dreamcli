# Planner Contract

This page records the internal planner boundary for the `dreamcli-re-foundation` workstream.
It is a stability target for tests and refactors, not a public API guarantee.

## Responsibilities

- intercept root `--help` and `--version`
- dispatch nested commands
- apply default-command fallback
- merge propagated flags while honoring child shadowing
- build the execution handoff for the matched command
- normalize invocation argv for planner-owned global concerns like root `--json`

## Non-Responsibilities

- parse flag or arg values
- read env, config, stdin, or prompt sources
- run middleware or action handlers
- decide concrete output writers or rendering mechanics

## Dispatch Outcome

The planner contract is modeled in `src/core/cli/planner.ts` as:

```ts twoslash
import type {
  CLIError,
  HelpOptions,
} from '@kjanat/dreamcli';

type CommandExecutionPlan = Record<string, unknown>;

type DispatchOutcome =
  | {
      readonly kind: 'root-help';
      readonly help: HelpOptions;
    }
  | {
      readonly kind: 'root-version';
      readonly version: string;
    }
  | {
      readonly kind: 'dispatch-error';
      readonly error: CLIError;
    }
  | {
      readonly kind: 'match';
      readonly plan: CommandExecutionPlan;
    };
```

The intent is simple:

- `root-help` and `root-version` short-circuit before command execution
- `dispatch-error` captures CLI-level failures before parse and resolve
- `match` hands one explicit execution plan to the executor seam

## Command Execution Plan

```ts twoslash
import type {
  CLIPlugin,
  CommandMeta,
  CommandSchema,
  HelpOptions,
} from '@kjanat/dreamcli';

type ErasedCommand = Record<string, unknown>;
type OutputPolicy = Record<string, unknown>;

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

- planner outcomes are named explicitly in code
- raw invocation shaping, root interception, dispatch, and default-command fallback live in `src/core/cli/planner.ts`
- `CLIBuilder.execute()` now consumes planner outcomes as a render-and-execute shell rather than owning command-routing policy
