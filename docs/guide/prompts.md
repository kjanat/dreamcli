# Interactive Prompts

dreamcli integrates interactive prompts into the flag resolution chain.
Prompts activate only when needed and only in interactive contexts.

## Per-Flag Prompts

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag.string().prompt({ kind: 'input', message: 'Name?' });
flag
  .boolean()
  .prompt({ kind: 'confirm', message: 'Sure?' });
flag
  .enum(['a', 'b'])
  .prompt({ kind: 'select', message: 'Pick one' });
flag.array(flag.string()).prompt({
  kind: 'multiselect',
  message: 'Pick many',
  choices: [{ value: 'a' }, { value: 'b' }],
});
```

Prompts fire only if the flag wasn't resolved by CLI argv, env var, or config. Defaults apply only
after prompts are skipped or unanswered.

For the exact non-interactive rules, cancellation fallthrough, and full
precedence chain, see [CLI Semantics](/guide/semantics).

## Prompt Defaults

`confirm` and `input` prompts accept a `default` that is used when the user
submits an empty line (presses Enter):

```ts twoslash
import { flag } from '@kjanat/dreamcli';

// Enter → false; hint renders as `(y/N)` for a safe destructive default.
flag.boolean().prompt({
  kind: 'confirm',
  message: 'Delete everything?',
  default: false,
});

// Enter → 'Anonymous'; hint renders as `Name (default: Anonymous):`.
flag.string().default('Anonymous').prompt({
  kind: 'input',
  message: 'Name',
  default: 'Anonymous',
});
```

A `confirm` default of `true` (or unset) shows `(Y/n)`; `false` shows `(y/N)`.

For `input`, an empty submission resolves to the prompt-level `default` when set
(skipping `validate`). When **no** prompt-level `default` is set, an empty
submission is treated as "no answer" and resolution falls through to the flag's
`.default()` — so pressing Enter never clobbers a configured default with `""`.
Precedence among defaults is **prompt-level `default` > flag `.default()`**.

## Prompt Types

| Kind          | Input            | Output     |
| ------------- | ---------------- | ---------- |
| `input`       | Free text        | `string`   |
| `confirm`     | Yes/No           | `boolean`  |
| `select`      | Single choice    | Enum value |
| `multiselect` | Multiple choices | Array      |

## Per-Command Interactive Resolver

For conditional prompts that depend on other resolved values:

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

command('deploy')
  .flag('region', flag.enum(['us', 'eu', 'ap']))
  .flag('confirm', flag.boolean())
  .interactive(({ flags }) => ({
    region: !flags.region && {
      kind: 'select',
      message: 'Which region?',
    },
    confirm: flags.region === 'us' && {
      kind: 'confirm',
      message: 'Deploy to US prod?',
    },
  }));
```

The resolver receives partially resolved flags (after CLI/env/config)
and returns prompt configs for any remaining values.

## Non-Interactive Behavior

When stdin is not a TTY (CI, piped input), prompts are automatically skipped.
Required flags that would have prompted instead produce a structured error with an actionable message.

## Testing Prompts

```ts twoslash
import { promptCmd } from './docs/.vitepress/twoslash/testing-fixtures.ts';
// ---cut---
import {
  runCommand,
  createTestPrompter,
  PROMPT_CANCEL,
} from '@kjanat/dreamcli/testkit';

// Provide answers in order
const result = await runCommand(promptCmd, [], {
  answers: ['eu'],
});

// Simulate cancellation
const cancelled = await runCommand(promptCmd, [], {
  prompter: createTestPrompter([PROMPT_CANCEL]),
});
```

## What's Next?

- Related example: [Interactive prompts](/examples/interactive)
- [Testing](/guide/testing) — full test harness documentation
- [Flags](/guide/flags) — flag resolution chain
- [CLI Semantics](/guide/semantics) — prompt precedence and non-interactive behavior
