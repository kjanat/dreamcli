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

Prompts fire only if the input wasn't resolved by CLI argv, stdin, env var, or config. Defaults apply only
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

These are the defaults for existing `{ kind: 'input', ... }` declarations.
Set `trim: false` to preserve whitespace, and `empty: 'accept'` to accept an
empty string instead of falling through. `empty: 'retry'` asks again.
Prompt-level defaults still take precedence on an empty submission.
Sensitive inputs never display their prompt-level default.

## Reusable Prompts and Handler Questions

The `prompt` factories create definitions that work with `.prompt()` and the
handler's injected `ask`. `ask` is also available in derives and middleware.
`prompt.input()` retries empty submissions by default; its other text defaults
match existing input prompts, including trimming. Validators may be async.

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';
import { prompt } from '@kjanat/dreamcli/prompt';

const emailPrompt = prompt.input({ message: 'Email address' });

command('profile')
  .flag('email', flag.string().required().prompt(emailPrompt))
  .action(async ({ ask, out }) => {
    const region = await ask(prompt.select({
      message: 'Region',
      choices: [{ value: 'eu' }, { value: 'us' }],
    }));
    // region: 'eu' | 'us'
    out.log(region);
  });
```

`ask` returns the typed answer. Cancellation throws `PromptCancelledError`
(`PROMPT_CANCELLED`, exit code 130); it never accepts a default after cancellation.
Validation failures ask again, up to ten submitted answers, and exhaustion
produces `PROMPT_INVALID`. An unavailable engine produces `PROMPT_UNAVAILABLE`
only when `ask` is called, so a command can complete a non-interactive branch.
One session presents one question at a time; concurrent calls produce `PROMPT_BUSY`.

### Authentication Branches

Keep branch-specific credentials optional and ask after selecting the operation.
Unconditional `.required().prompt(...)` declarations run before the action,
including when `--check` or another authentication mode was selected.

```ts twoslash
import { command, flag, arg } from '@kjanat/dreamcli';
import { prompt } from '@kjanat/dreamcli/prompt';

const checkAuthentication = async () => {};
const authenticateApiKey = async (id: string, secret: string) => {};
const authenticatePassword = async (email: string, password: string) => ({
  requiresOtp: true,
});
const verifyOtp = async (code: string) => {};
// ---cut---
command('login')
  .arg('email', arg.string().optional().env('EMAIL'))
  .flag('check', flag.boolean())
  .flag('apikey', flag.boolean())
  .flag('client-id', flag.string().env('CLIENT_ID'))
  .flag('client-secret', flag.string().sensitive().env('CLIENT_SECRET'))
  .flag('password', flag.string().sensitive().env('MASTER_PASSWORD'))
  .action(async ({ args, flags, ask }) => {
    if (flags.check) {
      await checkAuthentication();
      return;
    }

    if (flags.apikey) {
      const id = flags['client-id'] ?? await ask(prompt.input({ message: 'Client ID' }));
      const secret = flags['client-secret'] ?? await ask(prompt.password({ message: 'Client secret' }));
      await authenticateApiKey(id, secret);
      return;
    }

    const email = args.email ?? await ask(prompt.input({ message: 'Email' }));
    const password = flags.password ?? await ask(prompt.password({ message: 'Master password' }));
    const result = await authenticatePassword(email, password);

    if (result.requiresOtp) {
      const code = await ask(prompt.input({ message: 'Verification code' }));
      await verifyOtp(code);
    }
  });
```

The normal input precedence resolves declared credentials before the handler.
The `?? await ask(...)` fallback only requests credentials still missing in the
selected branch. Questions may depend on earlier answers or server responses.
Handler answers remain local application values; they do not rewrite `flags`,
`args`, or their source provenance.

## Password Entry

`prompt.password({ message })` requests input with terminal echo disabled and
preserves surrounding whitespace. It defaults to retrying empty input; use
`empty: 'accept'` when an empty password is meaningful. It accepts an optional
sync or async `validate` callback, but no password default or trim option.

```ts twoslash
import { flag } from '@kjanat/dreamcli';
import { prompt } from '@kjanat/dreamcli/prompt';

flag.string().required().prompt(prompt.password({ message: 'API token' }));
```

Attaching a password prompt marks the owning flag or argument sensitive, so
framework diagnostics, help, and generated schemas also protect the value.
Use `.sensitive()` explicitly for credentials resolved in a handler from
non-interactive sources. Custom messages and application output remain the
author's responsibility.

Built-in Node, Bun, and Deno adapters suppress echo through terminal raw mode
and restore the terminal after submission, EOF, Ctrl+C, Escape, or a read error.
Backspace, Ctrl+U (clear), and Ctrl+W (delete a word) are supported. No mask is
printed. A host without hidden-input support reports `PROMPT_UNSUPPORTED`
before reading; it never uses visible input as a fallback.

Cancelling a password prompt aborts execution, including schema-bound password
prompts. Existing non-password schema prompts retain their cancellation
fallback behavior for compatibility.

## Prompt Types

| Kind          | Input            | Output     |
| ------------- | ---------------- | ---------- |
| `input`       | Free text        | `string`   |
| `password`    | Hidden text      | `string`   |
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
It runs once before prompting; use handler-level `ask` when a question depends
on an earlier prompted answer or an async operation.

## Non-Interactive Behavior

When stdin is not a TTY (CI, piped input), prompts are automatically skipped.
Required flags that would have prompted instead produce a structured error with an actionable message.
An explicit handler-level `ask` fails with `PROMPT_UNAVAILABLE` unless an engine
or scripted answers were injected. It does not open another terminal device.

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

The same `answers` queue supplies schema prompts and handler-level questions,
including password prompts. A handler-level validation retry consumes the next
answer. Scripted text input uses the same trimming, empty-input, default, and
validation rules as the terminal engine. Malformed non-string answers remain
available for resolver error tests.

## What's Next?

- Related example: [Interactive prompts](/examples/interactive)
- [Testing](/guide/testing) — full test harness documentation
- [Flags](/guide/flags) — flag resolution chain
- [CLI Semantics](/guide/semantics) — prompt precedence and non-interactive behavior
