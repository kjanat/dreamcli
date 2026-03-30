# Shell Completions

dreamcli generates completion scripts from the command schema — always in sync with your CLI
definition.

## Generating Scripts

```ts
import { generateCompletion } from 'dreamcli';

generateCompletion(myCli, 'bash');
generateCompletion(myCli, 'zsh');
```

## Supported Shells

| Shell | Status    |
| ----- | --------- |
| bash  | Supported |
| zsh   | Supported |

## Adding a Completion Command

A common pattern is to add a `completions` subcommand:

```ts
import { command, flag, generateCompletion } from 'dreamcli';

const completions = command('completions')
	.description('Generate shell completion script')
	.flag('shell', flag.enum(['bash', 'zsh']).required().describe('Target shell'))
	.action(({ flags, out }) => {
		const script = generateCompletion(myCli, flags.shell);
		out.log(script);
	});
```

Users install completions by sourcing the output:

```bash
# bash
mycli completions --shell bash >> ~/.bashrc

# zsh
mycli completions --shell zsh >> ~/.zshrc
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
