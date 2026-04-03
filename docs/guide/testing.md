# Testing

dreamcli's test harness runs commands in-process with full control over inputs and outputs.
No subprocesses, no `process.argv` mutation, no mocking.

## Basic Usage

```ts
import { runCommand } from 'dreamcli/testkit';

const result = await runCommand(greet, ['Alice', '--loud']);

expect(result.exitCode).toBe(0);
expect(result.stdout).toEqual(['HELLO, ALICE!\n']);
expect(result.stderr).toEqual([]);
expect(result.error).toBeUndefined();
```

## RunOptions

Control every dimension of CLI behavior from tests:

```ts
const result = await runCommand(deploy, ['production'], {
  // environment variables
  env: { DEPLOY_REGION: 'eu' },
  // config file values
  config: { deploy: { region: 'us' } },
  // piped stdin for args configured with .stdin()
  stdinData: '<your input>',
  // prompt answers (consumed in order)
  answers: ['ap'],
  // simulate --json mode
  jsonMode: true,
  // verbosity level
  verbosity: 'quiet',
});
```

### Available Options

| Option      | Type                      | Description                                        |
| ----------- | ------------------------- | -------------------------------------------------- |
| `env`       | `Record<string, string>`  | Environment variables                              |
| `config`    | `Record<string, unknown>` | Config file values                                 |
| `stdinData` | `string \| null`          | Data supplied to command stdin for `.stdin()` args |
| `answers`   | `unknown[]`               | Prompt answers in order                            |
| `prompter`  | `PromptEngine`            | Custom prompt handler                              |
| `jsonMode`  | `boolean`                 | Simulate `--json` mode                             |
| `help`      | `HelpOptions`             | Help formatting options                            |
| `verbosity` | `Verbosity`               | Output verbosity level                             |
| `isTTY`     | `boolean`                 | Simulate a TTY stdout connection                   |

## Testing Prompts

```ts
import {
  runCommand,
  createTestPrompter,
  PROMPT_CANCEL,
} from 'dreamcli/testkit';

// Sequential answers
const result = await runCommand(cmd, [], {
  answers: ['eu', true, 'my-name'],
});

// Simulate prompt cancellation
const cancelResult = await runCommand(cmd, [], {
  prompter: createTestPrompter([PROMPT_CANCEL]),
});
```

## Asserting Activity Events

Spinners and progress bars emit testable events:

```ts
const result = await runCommand(cmd, ['deploy']);

expect(result.activity).toContainEqual(
  expect.objectContaining({ type: 'spinner:start' }),
);
expect(result.activity).toContainEqual(
  expect.objectContaining({ type: 'spinner:stop' }),
);
```

## Captured Output

```ts
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
