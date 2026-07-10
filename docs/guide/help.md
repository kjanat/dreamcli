# Help

Help text is generated from your schemas — usage line, arguments, flags,
subcommands, and examples all render automatically for `--help`, `-h`,
`help <command>`, and root help.

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
    // OSC 8 hyperlinks in the header (defaults to TTY detection)
    hyperlinks: true,
  });
```

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
| `annotation`    | `[env: X]`, `[required]`, ` (default)`                 | dim              |
| `deprecated`    | `[deprecated…]`                                        | yellow           |
| `headerName`    | program name in the root header                        | bold             |
| `headerVersion` | `vX.Y.Z` in the root header                            | dim              |
| `examplePrompt` | the `$` marker in `Examples:`                          | dim              |

Descriptions stay unstyled for readability.

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

Two guarantees make themes safe to write:

- The palette's formatters are identity functions when color is off, so you can
  style unconditionally.
- The factory itself is **never invoked** when color is off — even a formatter
  that emits raw escape codes cannot leak them into piped output.

One constraint: roles that appear inside wrap-eligible description text
(`defaultValue`, `annotation`, `deprecated`) should stick to foreground colors
and `dim`. A styled span can cross a soft-wrap boundary — colors carry
invisibly across the continuation indent, but `underline`, `inverse`, and
background styles would visibly paint it.

## Programmatic Rendering

`formatHelp()` renders a command's help as a plain string — useful for custom
UIs, docs generation, or tests. Pass `colors` to render a themed variant:

```ts twoslash
import { command, formatHelp } from '@kjanat/dreamcli';

const deploy = command('deploy').description('Deploy the app').action(() => {});

const plain = formatHelp(deploy.schema, { binName: 'mycli' });
```

See also [Output](/guide/output) for how `out.color` gating works at runtime.
