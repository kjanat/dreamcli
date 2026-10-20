# @kjanat/dreamcli/prompt

Prompt engines. When stdin is a TTY and no prompter was injected, `cli().run()` installs a thin
engine that imports the terminal prompter the first time a prompt is presented, so a run that never
prompts never loads it. Import this module to drive prompts from a custom host or to build an engine
of your own against `PromptEngine`.

```ts twoslash
import { createTerminalPrompter, resolvePromptConfig } from '@kjanat/dreamcli/prompt';
import type { PromptEngine, ReadFn, ResolvedPromptConfig } from '@kjanat/dreamcli/prompt';
```

`PromptEngine`, `ReadFn`, the resolved config types, and `resolvePromptConfig` are also exported
from the root entry. This subpath statically includes the terminal prompter, so code that only
needs `resolvePromptConfig` should take it from the root entry.

## `prompt` and `createPromptSession(options)`

`prompt.input()`, `prompt.password()`, `prompt.confirm()`, `prompt.select()`,
and `prompt.multiselect()` create reusable configs for `.prompt()` and `ask`.
Literal string choice values are preserved in the inferred answer type.
Choice lists may be omitted for schema-bound enum prompts, where the resolver
supplies them; standalone selection requires explicit non-empty choices.

Command actions, derives, and middleware receive an invocation-scoped `ask`.
For standalone scripts or a custom host, create a session explicitly:

```ts twoslash
import { createPromptSession, prompt } from '@kjanat/dreamcli/prompt';
import { createTestPrompter } from '@kjanat/dreamcli/testkit';

const { ask } = createPromptSession({
  prompter: createTestPrompter(['eu']),
  write: (text) => {},
});

const region = await ask(prompt.select({
  message: 'Region',
  choices: [{ value: 'eu' }, { value: 'us' }],
}));
```

Sessions check answer shapes and choices, apply text policies and async
validators, and retry invalid answers. Cancellation throws `PromptCancelledError`.
The session's optional `write` callback receives validation feedback, including
trailing newlines. It never selects a host or reads global stdin implicitly.
For terminal I/O, supply a terminal engine backed by your runtime adapter.

## `createTerminalPrompter(read, write, options?)`

Create a line-based prompt engine over injected I/O. `read` returns the next line or `null` on EOF,
which the engine treats as cancellation; `write` receives prompt text.
`options.readSecret` supplies a separate hidden-input reader. Without it,
password prompts fail with `PROMPT_UNSUPPORTED`. Runtime adapters implement
echo suppression and terminal restoration; the core engine owns neither.

```ts twoslash
import { createTerminalPrompter } from '@kjanat/dreamcli/prompt';
import type { ReadFn } from '@kjanat/dreamcli/prompt';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
let closed = false;
rl.once('close', () => {
  closed = true;
});
const read: ReadFn = () =>
  new Promise((resolve) => {
    if (closed) {
      resolve(null);
      return;
    }
    const onClose = (): void => resolve(null);
    rl.once('close', onClose);
    rl.question('', (answer) => {
      rl.off('close', onClose);
      resolve(answer);
    });
  });

const prompter = createTerminalPrompter(read, (text) => {
  process.stdout.write(text);
});
```

Pass the engine as `prompter` in `CLIRunOptions` or `CLIExecuteOptions` to replace the default.
For tests, `createTestPrompter()` from [`@kjanat/dreamcli/testkit`](/reference/testkit) scripts
answers instead.

For the built-in adapters, pass `adapter.stdin`, `adapter.stderr`, and
`{ readSecret: adapter.readSecret }` when the optional reader is present.
The default CLI runtime wiring does this automatically. A custom engine is
responsible for honoring the password contract and sensitive display metadata.

## `resolvePromptConfig(config, enumValues)`

Prepare a `ResolvedPromptConfig` from a raw `PromptConfig`, merging a flag's enum values into
`select` and `multiselect` choices when the config omits them. The resolver calls it before an engine
sees the config; call it yourself only when feeding an engine directly.
