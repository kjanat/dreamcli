# Help

Help text is generated from your schemas — usage line, arguments, flags,
subcommands, and examples all render automatically for `--help`, `-h`,
`help <command>`, and root help.

Those three tokens belong to the root, so a command cannot declare a `help`
flag or an `h` alias. A CLI that needs the token for itself releases it with
`.builtins({ help: 'off' })`. See
[Taking a built-in over](/guide/output#taking-a-built-in-over).

## Source Annotations

Every source an input declares is named beside its description, on the flag table
and the argument table alike:

| Annotation              | Declared by                       |
| ----------------------- | --------------------------------- |
| `[stdin]`               | `.stdin()`                        |
| `[stdin: '-']`          | `.stdin({ when: 'dash' })`        |
| `[stdin: when omitted]` | `.stdin({ when: 'missing' })`     |
| `[env: NAME]`           | `.env('NAME')`                    |
| `[config: a.b]`         | `.config('a.b')`                  |
| `[prompt]`              | `.prompt(...)`                    |

They render in resolution order, after the description and any `[deprecated]`
marker, and before `[required]` or `(default: …)`:

```
Flags:
  --body <string>  Message body [stdin] [env: BODY] [required]
```

Shell completions carry the plain description, never these annotations.

## Configuring Help

`.help()` sets builder-level defaults; the same fields can be overridden per
call via `execute(argv, { help })`:

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

cli('mycli')
  .command(command('deploy').action(() => {}))
  .help({
    // Render the default command's args/flags inline at the root
    inlineDefault: true,
    // Also list the default command in the Commands: table
    showDefaultInCommands: false,
    // Force the "Run '<bin> <command> --help'" footer on or off
    footer: true,
    // Pin the line width (defaults to the terminal width, falling back to 80)
    width: 100,
    // OSC 8 hyperlinks in the header. Defaults to the channel's resolved
    // support: explicit --no-hyperlinks/--hyperlinks flags, then
    // NO_HYPERLINKS, FORCE_HYPERLINKS, and finally TTY detection.
    hyperlinks: true,
    // Order of the Flags: table — 'alphabetical' (default) or 'declaration'
    flagOrder: 'declaration',
  });
```

### Flag order

By default the `Flags:` table lists short-aliased flags first, then
alphabetically by name. `flagOrder: 'declaration'` instead preserves the order
you called `.flag()`, so you control the layout by ordering your builder calls:

```ts twoslash
import { cli, command, flag } from '@kjanat/dreamcli';

cli('mycli')
  .command(
    command('serve')
      .flag('port', flag.number())
      .flag('host', flag.string())
      .action(() => {}),
  )
  // 'port' then 'host', as declared — not alphabetized to 'host', 'port'
  .help({ flagOrder: 'declaration' });
```

For full control, `sortFlags` supplies a comparator over flag long names and
wins over `flagOrder`:

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

cli('mycli')
  .command(command('serve').action(() => {}))
  // Reverse-alphabetical
  .help({ sortFlags: (a, b) => b.localeCompare(a) });
```

Both are also accepted per call via `execute(argv, { help })` / `run({ help })`.

### Header hyperlinks

The root-help header can wrap the program name and version in OSC 8 terminal
hyperlinks (pointing at the repository and release tag). Explicit
`--no-hyperlinks` / `--hyperlinks` flags take precedence, followed by
`NO_HYPERLINKS`, then `FORCE_HYPERLINKS`, and finally TTY detection. When both
environment variables are set, `NO_HYPERLINKS` wins. The same resolved decision is exposed to handlers as
`out.isHyperlinkSupported`, so code rendering its own `out.color.link(...)`
output can gate on it and keep escapes out of piped or opted-out contexts.

## Theming

Help output is colored by default whenever color is enabled — the same gate as
handler output (`out.color`): stdout is a TTY, `--json` is off, and the
environment allows color (`NO_COLOR` / `FORCE_COLOR` are honored). Piped and
JSON output stays byte-clean, always.

The built-in theme follows clap/cargo conventions:

| Role            | Applies to                                             | Default style    |
| --------------- | ------------------------------------------------------ | ---------------- |
| `sectionTitle`  | `Usage:`, `Flags:`, `Commands:`, …                     | bold + underline |
| `usageBin`      | binary/command path in the usage line                  | bold             |
| `flag`          | flag forms (`-f, --force`)                             | cyan             |
| `command`       | command names in `Commands:` tables                    | cyan             |
| `arg`           | positional tokens (`<file>`)                           | cyan             |
| `placeholder`   | grammar tokens (`<string>`, `[flags]`)                 | dim              |
| `defaultValue`  | `(default: …)`                                         | dim              |
| `annotation`    | `[stdin]`, `[env: X]`, `[required]`, `(default)`       | dim              |
| `deprecated`    | `[deprecated…]`                                        | yellow           |
| `headerName`    | program name in the root header                        | bold             |
| `headerVersion` | `vX.Y.Z` in the root header                            | dim              |
| `examplePrompt` | the `$` marker in `Examples:`                          | dim              |

Literal descriptions stay unstyled for readability. Function-form flag and
argument descriptions receive the resolved theme at render time, so references
inside prose use the same semantic roles and the same color gate as the table:

```ts twoslash
import { arg, command, flag } from '@kjanat/dreamcli';

command('deploy')
  .arg('target', arg.string().describe((t) => `Deploy ${t.arg('<target>')}`))
  .flag(
    'output',
    flag.string().describe(
      (t) => `Filename relative to ${t.flag('--out-dir')}`,
    ),
  );
```

Example commands are highlighted per token with the existing roles — the
leading binary via `usageBin` (bold)
and flag tokens (`-x`, `--long`) via `flag` (cyan), values plain. Tokenizing is
quote-aware, so `--scope './a b'` stays one token, and the highlighting respects
the color gate: with color off the command is byte-identical to its plain form.

### Custom Themes

Pass a theme factory to `.help()`. It receives the **gated palette** (the same
`Colors` instance as `out.color`) and returns role overrides merged over the
built-in theme:

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

cli('mycli')
  .command(command('deploy').action(() => {}))
  .help({
    theme: (c) => ({
      sectionTitle: c.magenta,
      flag: c.hex('#ff8800'),
      command: (input) => c.bold(c.green(input)),
    }),
  });
```

Use `descriptionTheme` for a role override that applies only inside
function-form descriptions. It merges over the global theme role by role, so
unspecified roles still inherit the global choice:

```ts twoslash
import { cli, command, flag } from '@kjanat/dreamcli';

cli('mycli')
  .command(
    command('deploy').flag(
      'output',
      flag.string().describe((t) => `Relative to ${t.flag('--out-dir')}`),
    ),
  )
  .help({
    theme: (c) => ({ flag: c.cyan }),
    descriptionTheme: (c) => ({ flag: c.blue }),
  });
```

Two guarantees make themes safe to write:

- The palette's formatters are identity functions when color is off, so you can
  style unconditionally.
- The factory itself is **never invoked** when color is off — even a formatter
  that emits raw escape codes cannot leak them into piped output.

One constraint: roles used inside wrap-eligible description text (including
`flag`, `arg`, `placeholder`, `defaultValue`, `annotation`, and `deprecated`)
should stick to foreground colors
and `dim`. A styled span can cross a soft-wrap boundary — colors carry
invisibly across the continuation indent, but `underline`, `inverse`, and
background styles would visibly paint it.

## JSON Help

With `--json`, help emits the CLI's **definition document** instead of text —
the same machine-readable shape produced by `generateSchema()`, so
`mycli --help --json | jq '.commands[].name'` just works:

```sh
$ mycli --help --json          # root: { $schema, name, version, defaultCommand?, commands }
$ mycli deploy --help --json   # command: { name, description, flags, args, commands }
```

The root document includes the default command's *full* definition under
`defaultCommand` (flags and args included), and carries a `$schema` pointer to
the definition meta-schema for validation and editor tooling. Nothing is
written to stderr — the JSON is the help.

## Programmatic Rendering

`formatHelp()` renders a command's help as a plain string — useful for custom
UIs, docs generation, or tests. Pass `colors` to render a themed variant:

```ts twoslash
import { command, formatHelp } from '@kjanat/dreamcli';

const deploy = command('deploy').description('Deploy the app').action(() => {});

const plain = formatHelp(deploy.schema, { binName: 'mycli' });
```

See also [Output](/guide/output) for how `out.color` gating works at runtime.
