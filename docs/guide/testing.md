# Testing

dreamcli's test harness runs commands in-process with full control over inputs and outputs.
No subprocesses, no `process.argv` mutation, no mocking.

## Basic Usage

```ts twoslash
import { greet } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(greet, ['Alice', '--loud']);

expect(result.exitCode).toBe(0);
expect(result.stdout).toEqual(['HELLO, ALICE!\n']);
expect(result.stderr).toEqual([]);
expect(result.error).toBeUndefined();
```

## RunOptions

Control every dimension of CLI behavior from tests:

```ts twoslash
import { deploy } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

await runCommand(deploy, ['production'], {
  // environment variables
  env: { DEPLOY_REGION: 'eu' },
});

await runCommand(deploy, ['production'], {
  // config file values
  config: { deploy: { region: 'us' } },
});

await runCommand(deploy, ['production'], {
  // prompt answers (consumed in order)
  answers: ['ap'],
});

await runCommand(deploy, ['production'], {
  // piped stdin for args configured with .stdin()
  stdinData: '<your input>',
  // simulate --json mode
  jsonMode: false,
  // verbosity level
  verbosity: 'quiet',
  // simulate TTY output
  isTTY: true,
});
```

### Available Options

| Option      | Type                                  | Description                                        |
| ----------- | ------------------------------------- | -------------------------------------------------- |
| `env`       | `Record<string, string \| undefined>` | Environment variables                              |
| `config`    | `Record<string, unknown>`             | Config file values                                 |
| `stdinData` | `string \| null`                      | Data supplied to command stdin for `.stdin()` args |
| `answers`   | `unknown[]`                           | Prompt answers in order                            |
| `prompter`  | `PromptEngine`                        | Custom prompt handler                              |
| `jsonMode`  | `boolean`                             | Simulate `--json` mode                             |
| `help`      | `HelpOptions`                         | Help formatting options                            |
| `verbosity` | `Verbosity`                           | Output verbosity level                             |
| `isTTY`     | `boolean`                             | Simulate a TTY stdout connection                   |

## Testing Prompts

```ts twoslash
import { promptCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import {
  runCommand,
  createTestPrompter,
  PROMPT_CANCEL,
} from '@kjanat/dreamcli/testkit';

// Sequential answers
await runCommand(promptCmd, [], {
  answers: ['eu'],
});

// Simulate prompt cancellation
await runCommand(promptCmd, [], {
  prompter: createTestPrompter([PROMPT_CANCEL]),
});
```

## Asserting Activity Events

Spinners and progress bars emit testable events:

```ts twoslash
import { activityCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(activityCmd, []);

expect(result.activity).toContainEqual(
  expect.objectContaining({ type: 'spinner:start' }),
);
expect(result.activity).toContainEqual(
  expect.objectContaining({ type: 'spinner:succeed' }),
);
```

## Captured Output

```ts twoslash
import type { RunResult } from '@kjanat/dreamcli/testkit';

declare const result: RunResult;

// stdout lines (each includes trailing \n)
result.stdout; // string[]

// stderr lines
result.stderr; // string[]

// Exit code
result.exitCode; // number

// Error (if command failed)
result.error; // CLIError | undefined

// Activity events (spinner/progress)
result.activity; // ActivityEvent[]
```

## Design Philosophy

- **No lifecycle hooks** — isolation comes from the testkit architecture
- **No snapshots** — all assertions are explicit
- **No mocking** — use `RunOptions` injection instead of `vi.mock()`
- **No `process.argv`** — everything is passed as parameters

## What's Next?

- Related example: [Testing](/examples/testing)
- [Commands](/guide/commands) — building commands to test
- [Output](/guide/output) — output channel behavior
