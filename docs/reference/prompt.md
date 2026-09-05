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

## `createTerminalPrompter(read, write)`

Create a line-based prompt engine over injected I/O. `read` returns the next line or `null` on EOF,
which the engine treats as cancellation; `write` receives prompt text. The engine has no raw-mode
dependency, so it runs the same on Node, Bun, and Deno.

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

## `resolvePromptConfig(config, enumValues)`

Prepare a `ResolvedPromptConfig` from a raw `PromptConfig`, merging a flag's enum values into
`select` and `multiselect` choices when the config omits them. The resolver calls it before an engine
sees the config; call it yourself only when feeding an engine directly.
