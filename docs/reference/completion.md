# @kjanat/dreamcli/completion

Shell completion script generation. `cli().completions()` loads this module on demand; import it
directly to write scripts yourself or to drive completion from custom tooling.

```ts twoslash
import {
  generateCompletion,
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  generatePowerShellCompletion,
  SHELLS,
} from '@kjanat/dreamcli/completion';
import type { CompletionOptions, Shell } from '@kjanat/dreamcli/completion';
```

`Shell`, `CompletionOptions`, and `SHELLS` are also exported from the root entry. Importing
`SHELLS` from this subpath also evaluates the generators, so take the root copy when the shell
list is all you need.

`CompletionOptions` is the generator half of what `.completions()` accepts; the builder's own
`CompletionRegistrationOptions` adds `as: 'command' | 'flag'`, which the generators have no use
for.


## `generateCompletion(schema, shell, options?)`

Generate a shell completion script from a command schema.

- `shell`: `'bash'` | `'zsh'` | `'fish'` | `'powershell'`
- `options.functionPrefix?`: override the generated helper function prefix
- `options.rootMode?`: `'subcommands'` | `'surface'`

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';
import { generateCompletion } from '@kjanat/dreamcli/completion';

const myCli = cli('mycli').command(command('deploy'));

generateCompletion(myCli.schema, 'zsh');
```

## Per-shell generators

`generateBashCompletion`, `generateZshCompletion`, `generateFishCompletion`, and
`generatePowerShellCompletion` take the same `(schema, options?)` arguments and back
`generateCompletion()`.

## `SHELLS`

The frozen tuple `['bash', 'zsh', 'fish', 'powershell']`, matching the `Shell` union.
