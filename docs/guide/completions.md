# Shell Completions

dreamcli generates completion scripts from the command schema — always in sync with your CLI
definition.

## Generating Scripts

```ts
import { generateCompletion } from 'dreamcli';

generateCompletion(myCli.schema, 'bash');
generateCompletion(myCli.schema, 'zsh');
```

## Supported Shells

| Shell | Status    |
| ----- | --------- |
| bash  | Supported |
| zsh   | Supported |

## Adding a Completion Command

A common pattern is to add a `completions` subcommand:

```ts
import { arg, command, generateCompletion } from 'dreamcli';

const completions = command('completions')
	.description('Generate shell completion script')
	.arg(
		'shell',
		arg
			.custom((raw): 'bash' | 'zsh' => {
				if (raw !== 'bash' && raw !== 'zsh') {
					throw new Error('Expected bash or zsh');
				}
				return raw;
			})
			.describe('Target shell'),
	)
	.action(({ args, out }) => {
		const script = generateCompletion(myCli.schema, args.shell);
		out.log(script);
	});
```

Users install completions by sourcing the output:

```bash
# bash
mycli completions bash >> ~/.bashrc

# zsh
mycli completions zsh >> ~/.zshrc
```

## What Completes

Completion scripts generated from schema include:

- Command and subcommand names
- Flag names and aliases
- Enum flag values (choices)
- Argument descriptions

## What's Next?

- [Interactive Prompts](/guide/prompts) — prompt integration
- [Runtime Support](/guide/runtime) — cross-runtime behavior
