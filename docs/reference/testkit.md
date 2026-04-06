# @kjanat/dreamcli/testkit

Test utilities for running commands in-process.

```ts twoslash
import {
  runCommand,
  createCaptureOutput,
  createTestPrompter,
  createTestAdapter,
  PROMPT_CANCEL,
} from '@kjanat/dreamcli/testkit';
```

## `runCommand(command, argv, options?)`

Run a command in-process and return a `RunResult`.

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { greet } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(greet, ['Alice', '--loud']);
```

### Parameters

| Parameter | Type             | Description                      |
| --------- | ---------------- | -------------------------------- |
| `command` | `CommandBuilder` | The command to run               |
| `argv`    | `string[]`       | Simulated command-line arguments |
| `options` | `RunOptions`     | Optional configuration           |

### RunOptions

| Option      | Type                      | Description                             |
| ----------- | ------------------------- | --------------------------------------- |
| `env`       | `Record<string, string>`  | Environment variables                   |
| `config`    | `Record<string, unknown>` | Config file values                      |
| `stdinData` | `string \| null`          | Data to pipe to process stdin for tests |
| `answers`   | `unknown[]`               | Prompt answers in order                 |
| `prompter`  | `PromptEngine`            | Custom prompt handler                   |
| `jsonMode`  | `boolean`                 | Simulate `--json` mode                  |
| `help`      | `HelpOptions`             | Help formatting options                 |
| `verbosity` | `Verbosity`               | Output verbosity                        |
| `isTTY`     | `boolean`                 | Simulate TTY connection                 |

### RunResult

| Field      | Type                    | Description                              |
| ---------- | ----------------------- | ---------------------------------------- |
| `exitCode` | `number`                | Process exit code                        |
| `stdout`   | `string[]`              | Captured stdout lines                    |
| `stderr`   | `string[]`              | Captured stderr lines                    |
| `error`    | `CLIError \| undefined` | Structured error, `undefined` on success |
| `activity` | `ActivityEvent[]`       | Spinner/progress events                  |

## `createCaptureOutput()`

Create an output channel that captures all writes for assertions.

## `createTestPrompter(answers)`

Create a prompt engine that returns pre-defined answers.

```ts twoslash
import { createTestPrompter } from '@kjanat/dreamcli/testkit';

const prompter = createTestPrompter([
  'eu',
  true,
  'my-name',
]);
```

## `createTestAdapter(options?)`

Returns a runtime adapter for testing (no real process access).

## `PROMPT_CANCEL`

Sentinel value to simulate prompt cancellation.

```ts twoslash
import {
  createTestPrompter,
  PROMPT_CANCEL,
  runCommand,
} from '@kjanat/dreamcli/testkit';
import { cmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(cmd, [], {
  prompter: createTestPrompter([PROMPT_CANCEL]),
});
```
