# Testing

dreamcli's test harness runs commands in-process with full control over inputs and outputs. No
subprocesses, no `process.argv` mutation, no mocking.

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
  env: { DEPLOY_REGION: 'eu' }, // environment variables
  config: { deploy: { region: 'us' } }, // config file values
  answers: ['ap'], // prompt answers (consumed in order)
  jsonMode: true, // simulate --json mode
  verbosity: 'quiet', // verbosity level
});
```

### Available Options

| Option      | Type                      | Description             |
| ----------- | ------------------------- | ----------------------- |
| `env`       | `Record<string, string>`  | Environment variables   |
| `config`    | `Record<string, unknown>` | Config file values      |
| `answers`   | `unknown[]`               | Prompt answers in order |
| `prompter`  | `PromptEngine`            | Custom prompt handler   |
| `jsonMode`  | `boolean`                 | Simulate `--json` mode  |
| `help`      | `HelpOptions`             | Help formatting options |
| `verbosity` | `string`                  | Output verbosity level  |
| `adapter`   | `RuntimeAdapter`          | Custom runtime adapter  |

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

// Error (if action threw)
result.error; // Error | undefined

// Activity events (spinner/progress)
result.activity; // ActivityEvent[]
```

## Design Philosophy

- **No lifecycle hooks** — isolation comes from the testkit architecture
- **No snapshots** — all assertions are explicit
- **No mocking** — use `RunOptions` injection instead of `vi.mock()`
- **No `process.argv`** — everything is passed as parameters

## What's Next?

- [Commands](/guide/commands) — building commands to test
- [Output](/guide/output) — output channel behavior
