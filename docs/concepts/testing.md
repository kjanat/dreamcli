# Testing CLIs

Testing a CLI is harder than testing a library.
Libraries are functions — you call them and check the return value.
CLIs are processes — they read from argv, env vars, config files, and stdin, then
write to stdout, stderr, and the filesystem. Lots of moving parts.

## Why It's Hard

The naive way to test a CLI:

```bash
# run the command
output=$(mycli greet Alice --loud)
# check the output
[ "$output" = "HELLO, ALICE!" ] || echo "FAIL"
```

This works, technically.
But it's slow (spawns a new process each time), fragile (depends on exact
output formatting), and limited (how do you test env vars? config files?
interactive prompts? error messages?).

Real-world CLIs have tests like:

- "If `--region` is missing but `DEPLOY_REGION` is set, use the env var"
- "If both flag and config file provide a value, the flag wins"
- "If the prompt is cancelled, exit with code 1"
- "In JSON mode, framework errors should be structured JSON on stdout"

Good luck doing that with shell scripts.

## Two Approaches

### 1. Subprocess Testing (Black-Box)

Run the actual compiled binary as a child process:

```ts twoslash
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

try {
  const { stdout, stderr } = await execFileAsync(
    './mycli',
    ['greet', 'Alice'],
  );
  expect(stdout).toBe('Hello, Alice!\n');
  expect(stderr).toBe('');
} catch (error) {
  // execFileAsync throws on non-zero exit; read error.code if you need the exit code
  throw error;
}
```

**Pros:** Tests the real thing. Catches packaging issues.\
**Cons:** Slow. Hard to mock env/config.
Can't test prompts easily. Platform-dependent.

### 2. In-Process Testing (White-Box)

Run the command handler as a function, injecting all inputs:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { greet } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(greet, ['Alice', '--loud']);
expect(result.stdout).toEqual(['HELLO, ALICE!\n']);
expect(result.exitCode).toBe(0);
```

**Pros:** Fast. Full control. Can inject env, config, prompt answers, output capture.\
**Cons:** Doesn't test the actual binary entry point.

Most CLI frameworks don't give you option 2.
You're stuck shelling out and parsing text.
This is a solved problem — the test harness just needs to exist as a first-class feature.

The examples below use dreamcli's test harness, but the patterns apply to any framework that offers in-process testing.

## What to Test

### Happy Paths

The command works with valid input:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { greet } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(greet, ['Alice']);
expect(result.stdout).toEqual(['Hello, Alice!\n']);
expect(result.exitCode).toBe(0);
```

### Flag Resolution

Flags resolve from the right source:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { regionCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

// env var provides the value
const result = await runCommand(regionCmd, [], {
  env: { MY_REGION: 'eu' },
});
expect(result.stdout).toContain('eu');
```

### Error Cases

Bad input produces helpful errors:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { regionCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(regionCmd, ['--unknown']);
expect(result.exitCode).toBe(2);
expect(result.stderr.join('')).toContain('Unknown flag');
```

### Missing Required Values

Required flags that aren't provided, fail clearly:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { promptCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(promptCmd, []);
expect(result.exitCode).not.toBe(0);
expect(result.stderr.join('')).toContain(
  'Missing required',
);
```

### JSON Mode

Structured output is valid JSON:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { jsonListCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(jsonListCmd, [], {
  jsonMode: true,
});
const data = JSON.parse(result.stdout.join(''));
expect(data).toBeInstanceOf(Array);
```

### Interactive Prompts

Prompt answers resolve correctly:

```ts twoslash
import { runCommand } from '@kjanat/dreamcli/testkit';
import { promptCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(promptCmd, [], {
  answers: ['eu'],
});
expect(result.exitCode).toBe(0);
```

### Prompt Cancellation

Ctrl+C during a prompt exits gracefully:

```ts twoslash
import {
  PROMPT_CANCEL,
  runCommand,
} from '@kjanat/dreamcli/testkit';
import { promptCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';

const result = await runCommand(promptCmd, [], {
  answers: [PROMPT_CANCEL],
});
expect(result.exitCode).not.toBe(0);
```

## Isolation

Good CLI tests don't touch real state:

- **No `process.argv` mutation** — pass argv as a parameter
- **No real env vars** — inject env as an object
- **No real filesystem** — inject config as an object
- **No real TTY** — capture output to arrays
- **No real prompts** — provide answers programmatically

Each test runs in isolation. No `beforeEach` cleanup, no shared state, no order dependencies.

## What's Next?

- [Getting Started](/guide/getting-started) — build your first dreamcli command
- [Testing Commands guide](/guide/testing) — dreamcli's in-process test harness
