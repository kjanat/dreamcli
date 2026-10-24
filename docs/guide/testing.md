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
  // piped stdin for flags and args configured with .stdin()
  stdinData: '<your input>',
  // simulate --json mode
  jsonMode: true,
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
| `stdinData` | `string \| null`                      | Data supplied to command stdin for `.stdin()` inputs |
| `answers`   | `unknown[]`                           | Prompt answers in order                            |
| `prompter`  | `PromptEngine`                        | Custom prompt handler                              |
| `jsonMode`  | `boolean`                             | Simulate `--json` mode                             |
| `help`      | `HelpOptions`                         | Help formatting options                            |
| `verbosity` | `Verbosity`                           | Output verbosity level                             |
| `isTTY`     | `boolean`                             | Simulate a TTY stdout connection                   |
| `stat`      | `(path) => Promise<'file' \| 'directory' \| null>` | Filesystem probe for `flag.path()` / `arg.path()` checks |
| `mkdir`     | `(path) => Promise<void>`             | Directory creation for `create` checks             |
| `pathChecks` | `'lenient' \| 'strict'`              | Fail when a declared path check cannot run (default `'lenient'`) |

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

## Filesystem Checks

`flag.path()` and `arg.path()` checks (`mustExist`, `type`, `create`) run through an injected
filesystem, never the host's. `cli().run()` supplies the runtime adapter's; `runCommand()` and
`.execute()` only have what you pass. Without a `stat` probe the checks are **skipped**, the action
still runs, and the result lists every input whose check never ran in `skippedPathChecks`:

```ts twoslash
import { convertCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(convertCmd, ['in.wasm', 'out.wasm']);

expect(result.exitCode).toBe(0); // the action ran…
expect(result.skippedPathChecks).toEqual([
  // …but neither path was ever checked
  expect.objectContaining({ kind: 'arg', name: 'input', missing: 'stat' }),
  expect.objectContaining({ kind: 'arg', name: 'output', missing: 'stat' }),
]);
```

A green test with entries here proves nothing about the real CLI's path handling: `demo in.wasm
out.wasm` may still exit `2` because `in.wasm` is missing. Pick one of two postures.

### Isolated: leave the filesystem out

Parser and action tests that never care about paths keep the default, `pathChecks: 'lenient'`.
Nothing touches the host filesystem and nothing is created. Assert `skippedPathChecks` only where
it matters.

### Exercised: inject a probe and go strict

Tests that must exercise every declared check pass a `stat` probe (plus `mkdir` for `create`) and
opt into `pathChecks: 'strict'`. A check that still cannot run then fails the test with
`PATH_CHECK_SKIPPED` (exit code `1`) instead of passing silently, and names the input and the
missing capability.

```ts twoslash
import { convertCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

// A probe is a plain function: no temp files, no mocks.
const files = new Set(['in.wasm']);
const stat = async (path: string) => (files.has(path) ? 'file' : null);

const ok = await runCommand(convertCmd, ['in.wasm', 'out.wasm'], {
  stat,
  pathChecks: 'strict',
});
expect(ok.exitCode).toBe(0);
expect(ok.skippedPathChecks).toEqual([]);

// The probe reports what the real CLI would see: a missing input fails.
const missing = await runCommand(convertCmd, ['nope.wasm', 'out.wasm'], {
  stat,
  pathChecks: 'strict',
});
expect(missing.exitCode).toBe(2);
expect(missing.error?.code).toBe('CONSTRAINT_VIOLATED');

// Forgetting the probe is now a failure, not a false pass.
const unchecked = await runCommand(convertCmd, ['in.wasm', 'out.wasm'], {
  pathChecks: 'strict',
});
expect(unchecked.exitCode).toBe(1);
expect(unchecked.error?.code).toBe('PATH_CHECK_SKIPPED');
```

### Input and output paths

`type: 'file'` implies existence, which is right for an input and wrong for a file the command is
about to write. Declare the intent and the test above covers both:

```ts twoslash
import { arg, flag } from '@kjanat/dreamcli';
// ---cut---
arg.path({ type: 'file' }); // existing input: must exist and be a file
arg.path({ type: 'file', mustExist: false }); // new output is allowed; an existing one must be a file
flag.path({ type: 'directory', create: true }); // output directory, created when missing
```

### Directory creation

`create` needs `mkdir` as well as `stat`. Without it the existence rules decide and the input is
recorded with `missing: 'mkdir'`; in strict mode that fails too. Record what would be created
instead of creating it:

```ts twoslash
import { buildCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

const created: string[] = [];

const result = await runCommand(buildCmd, ['--out', 'dist'], {
  stat: async () => null, // nothing exists yet
  mkdir: async (path) => {
    created.push(path);
  },
  pathChecks: 'strict',
});

expect(result.exitCode).toBe(0);
expect(created).toEqual(['dist']);
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

type CapturedOutput = Pick<
  RunResult,
  'stdout' | 'stderr' | 'exitCode' | 'error'
>;

declare const captured: CapturedOutput;
//                          ^?
```

`activity` is tracked separately from captured output and is covered in the section above.

## Design Philosophy

- **No lifecycle hooks** — isolation comes from the testkit architecture
- **No snapshots** — all assertions are explicit
- **No mocking** — use `RunOptions` injection instead of `vi.mock()`
- **No `process.argv`** — everything is passed as parameters

## What's Next?

- Related example: [Testing](/examples/testing)
- [Commands](/guide/commands) — building commands to test
- [Arguments](/guide/arguments#filesystem-checks) and [Flags](/guide/flags#filesystem-checks) —
  what `arg.path()` / `flag.path()` check
- [Output](/guide/output) — output channel behavior
