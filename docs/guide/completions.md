# Shell Completions

dreamcli generates completion scripts from the command schema —
always in sync with your CLI definition.

## Generating Scripts

```ts
import { generateCompletion } from 'dreamcli';

generateCompletion(myCli.schema, 'bash');
generateCompletion(myCli.schema, 'zsh');
generateCompletion(myCli.schema, 'fish');
generateCompletion(myCli.schema, 'powershell');
generateCompletion(myCli.schema, 'bash', { rootMode: 'surface' });
```

## Supported Shells

| Shell      | Status    |
| ---------- | --------- |
| bash       | Supported |
| zsh        | Supported |
| fish       | Supported |
| powershell | Supported |

`generateCompletion()` currently supports `bash`, `zsh`, `fish`, and `powershell`.

See the [Support Matrix](/reference/support-matrix) for the current audited shell surface and the
tracked follow-up work.

## Adding a Completion Command

A common pattern is to add a `completions` subcommand:

```ts
import { arg, command, generateCompletion } from 'dreamcli';

const completions = command('completions')
  .description('Generate shell completion script')
  .arg(
    'shell',
    arg
      .custom((raw): 'bash' | 'zsh' | 'fish' | 'powershell' => {
        if (
          raw !== 'bash' &&
          raw !== 'zsh' &&
          raw !== 'fish' &&
          raw !== 'powershell'
        ) {
          throw new Error('Expected bash, zsh, fish, or powershell');
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

dreamcli also includes a built-in `.completions()` helper on `cli()`:

```ts
cli('mycli')
  .default(serve)
  .command(status)
  .completions({ rootMode: 'surface' });
```

Users install completions by sourcing the output:

```bash
# bash
mycli completions bash >> ~/.bashrc

# zsh
mycli completions zsh >> ~/.zshrc

# fish
mycli completions fish > ~/.config/fish/completions/mycli.fish

# powershell
mycli completions powershell | Invoke-Expression
```

## What Completes

Completion scripts generated from schema include:

- Command and subcommand names
- Flag names and aliases
- Enum flag values (choices)
- Argument descriptions

## Root Completion Modes

When your CLI has a default command, root completion can expose different surfaces:

- `'subcommands'` (default) keeps hybrid CLIs command-centric at the root
- `'surface'` also exposes the default command's root-usable flags at the root

For a single visible default command, default mode still exposes that command's flags at the root.

Hidden defaults stay executable but are omitted from root completions.
For the exact root-surface rules and examples, see [CLI Semantics](/guide/semantics).

## What's Next?

- [Interactive Prompts](/guide/prompts) — prompt integration
- [Runtime Support](/guide/runtime) — cross-runtime behavior
- [CLI Semantics](/guide/semantics) — exact root help and completion surface rules
- [Support Matrix](/reference/support-matrix) — current support truth
