# Shell Completions

DreamCLI generates completion scripts from the command schema. Flags and arguments can also
compute their value candidates when the user presses Tab.

## Generating Scripts

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';
import { generateCompletion } from '@kjanat/dreamcli/completion';

const serve = command('serve');
const myCli = cli('mycli').default(serve);

generateCompletion(myCli.schema, 'bash');
generateCompletion(myCli.schema, 'zsh');
generateCompletion(myCli.schema, 'fish');
generateCompletion(myCli.schema, 'powershell');
generateCompletion(myCli.schema, 'bash', {
  rootMode: 'surface',
});
```

## Supported Shells

| Shell      | Status    |
| ---------- | --------- |
| bash       | Supported |
| zsh        | Supported |
| fish       | Supported |
| powershell | Supported |

`generateCompletion()` currently supports `bash`, `zsh`, `fish`, and `powershell`. It lives on the
`@kjanat/dreamcli/completion` subpath; the built-in `.completions()` loads it on demand, so a program
that never renders a script does not pay for the generators.

The public `Shell` union and exported `SHELLS` tuple match this shipped set exactly.

See the [Support Matrix](/reference/support-matrix) for the current audited shell surface and the
tracked follow-up work.

## Adding a Completion Command

A common pattern is to add a `completions` subcommand:

```ts twoslash
import { arg, cli, command } from '@kjanat/dreamcli';
import { generateCompletion } from '@kjanat/dreamcli/completion';

const myCli = cli('mycli');

const completions = command('completions')
  .description('Generate shell completion script')
  .arg(
    'shell',
    arg
      .custom(
        (raw): 'bash' | 'zsh' | 'fish' | 'powershell' => {
          if (
            raw !== 'bash' &&
            raw !== 'zsh' &&
            raw !== 'fish' &&
            raw !== 'powershell'
          ) {
            throw new Error(
              'Expected bash, zsh, fish, or powershell',
            );
          }
          return raw;
        },
      )
      .describe('Target shell'),
  )
  .action(({ args, out }) => {
    const script = generateCompletion(
      myCli.schema,
      args.shell,
    );
    out.log(script);
  });

myCli.command(completions);
```

dreamcli also includes a built-in `.completions()` helper on `cli()`:

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const serve = command('serve');
const status = command('status');

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
mycli completions powershell | Out-String | Invoke-Expression
```

## What Completes

Completion scripts generated from schema include:

- Command and subcommand names
- Flag names and aliases
- Enum flag values (choices)
- Argument descriptions

## Dynamic values

Use `.complete()` on a flag or positional argument when its candidates depend on data that changes
while the CLI is installed.

```ts twoslash
import { arg, cli, command, flag } from '@kjanat/dreamcli';

declare function listPackages(): Promise<readonly string[]>;
declare function listBinaries(packageName?: string): Promise<readonly string[]>;

const adopt = command('adopt')
  .flag('package', flag.string().complete(() => listPackages()))
  .arg('binary', arg.string().complete(({ env }) => listBinaries(env.PACKAGE)))
  .action(({ flags, args, out }) => {
    out.log(`${flags.package}: ${args.binary}`);
  });

cli('mycli').command(adopt).completions();
```

The callback receives `prefix`, `commandPath`, `input`, `argv`, and `env`. `commandPath` contains
canonical command names. `input` identifies the flag or positional argument by its declared name.
`argv` contains the arguments before the cursor, including the current partial token. `env` is the
environment supplied to the execution.

Return complete values, either directly or through a promise. DreamCLI keeps candidates that start
with `prefix`, removes duplicates, and omits empty values and values containing control characters.
Spaces, quotes, and shell metacharacters remain part of the value. A callback that throws produces
no candidates.

Generated scripts call the reserved `__complete` command. For example,
`mycli __complete adopt --package wid` prints matching candidates, one per line. This path runs no
command action, middleware, prompt, stdin reader, or config discovery. Load any data the callback
needs inside the callback or close over it when constructing the command.

Reinstall the generated completion script after adding callbacks. All four supported shells use
the runtime callback for flag values and positional arguments.

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
