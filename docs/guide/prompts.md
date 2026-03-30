# Interactive Prompts

dreamcli integrates interactive prompts into the flag resolution chain. Prompts activate only when
needed and only in interactive contexts.

## Per-Flag Prompts

```ts
flag.string().prompt({ kind: 'input', message: 'Name?' });
flag.boolean().prompt({ kind: 'confirm', message: 'Sure?' });
flag.enum(['a', 'b']).prompt({ kind: 'select', message: 'Pick one' });
flag.array(flag.string()).prompt({
	kind: 'multiselect',
	message: 'Pick many',
	choices: [{ value: 'a' }, { value: 'b' }],
});
```

Prompts fire only if the flag wasn't resolved by CLI argv, env var, config, or default.

## Prompt Types

| Kind          | Input            | Output     |
| ------------- | ---------------- | ---------- |
| `input`       | Free text        | `string`   |
| `confirm`     | Yes/No           | `boolean`  |
| `select`      | Single choice    | Enum value |
| `multiselect` | Multiple choices | Array      |

## Per-Command Interactive Resolver

For conditional prompts that depend on other resolved values:

```ts
command('deploy')
	.flag('region', flag.enum(['us', 'eu', 'ap']))
	.flag('confirm', flag.boolean())
	.interactive(({ flags }) => ({
		region: !flags.region && { kind: 'select', message: 'Which region?' },
		confirm: flags.region === 'us' && { kind: 'confirm', message: 'Deploy to US prod?' },
	}));
```

The resolver receives partially resolved flags (after CLI/env/config) and returns prompt configs for
any remaining values.

## Non-Interactive Behavior

When stdin is not a TTY (CI, piped input), prompts are automatically skipped. Required flags that
would have prompted instead produce a structured error with an actionable message.

## Testing Prompts

```ts
import { runCommand, createTestPrompter, PROMPT_CANCEL } from 'dreamcli/testkit';

// Provide answers in order
const result = await runCommand(cmd, [], {
	answers: ['eu', true],
});

// Simulate cancellation
const result = await runCommand(cmd, [], {
	prompter: createTestPrompter([PROMPT_CANCEL]),
});
```

## What's Next?

- [Testing](/guide/testing) — full test harness documentation
- [Flags](/guide/flags) — flag resolution chain
