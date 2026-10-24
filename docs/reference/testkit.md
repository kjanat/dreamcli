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
import { greet } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(greet, ['Alice', '--loud']);
```

### Parameters

| Parameter | Type             | Description                      |
| --------- | ---------------- | -------------------------------- |
| `command` | `CommandBuilder` | The command to run               |
| `argv`    | `string[]`       | Simulated command-line arguments |
| `options` | `RunOptions`     | Optional configuration           |

### RunOptions

| Option      | Type                                  | Description                             |
| ----------- | ------------------------------------- | --------------------------------------- |
| `env`       | `Record<string, string \| undefined>` | Environment variables                   |
| `config`    | `Record<string, unknown>`             | Config file values                      |
| `stdinData` | `string \| null`                      | Data to pipe to process stdin for tests |
| `answers`   | `unknown[]`                           | Prompt answers in order                 |
| `prompter`  | `PromptEngine`                        | Custom prompt handler                   |
| `jsonMode`  | `boolean`                             | Simulate `--json` mode                  |
| `help`      | `HelpOptions`                         | Help formatting options                 |
| `verbosity` | `Verbosity`                           | Output verbosity                        |
| `isTTY`     | `boolean`                             | Simulate TTY connection                 |
| `stat`      | `(path) => Promise<'file' \| 'directory' \| null>` | Filesystem probe for `flag.path()` / `arg.path()` checks |
| `mkdir`     | `(path) => Promise<void>`             | Directory creation for `create` checks  |
| `pathChecks` | `'lenient' \| 'strict'`              | Fail with `PATH_CHECK_SKIPPED` when a declared check cannot run (default `'lenient'`) |

### RunResult

| Field               | Type                    | Description                                    |
| ------------------- | ----------------------- | ---------------------------------------------- |
| `exitCode`          | `number`                | Process exit code                              |
| `stdout`            | `string[]`              | Captured stdout lines                          |
| `stderr`            | `string[]`              | Captured stderr lines                          |
| `error`             | `CLIError \| undefined` | Structured error, `undefined` when none thrown |
| `activity`          | `ActivityEvent[]`       | Spinner/progress events                        |
| `skippedPathChecks` | `SkippedPathCheck[]`    | Declared path checks that did not run for lack of `stat` / `mkdir` |

`exitCode` can be non-zero while `error` is `undefined` when a handler calls
`out.setExitCode(code)` for normal-output status results.

A successful result with entries in `skippedPathChecks` ran its action without consulting the
filesystem, so it does not prove the real CLI accepts the same path. See
[Filesystem Checks](/guide/testing#filesystem-checks) for the probe and strict-mode recipes.

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

Use `terminalSize: { columns, rows }` to simulate terminal-aware help wrapping in `cli().run({ adapter })` tests.

## `PROMPT_CANCEL`

Sentinel value to simulate prompt cancellation.

```ts twoslash
import { promptCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import {
  createTestPrompter,
  PROMPT_CANCEL,
  runCommand,
} from '@kjanat/dreamcli/testkit';

const result = await runCommand(promptCmd, [], {
  prompter: createTestPrompter([PROMPT_CANCEL]),
});
```
