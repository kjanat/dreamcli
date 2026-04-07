# Config Files

dreamcli discovers and loads configuration files from standard locations.
Config values participate in the flag resolution chain.

## Linking Flags to Config

```ts twoslash
import { flag } from '@kjanat/dreamcli';

flag.enum(['us', 'eu', 'ap']).config('deploy.region');
```

This resolves `deploy.region` from the config file using dot-notation.
If CLI argv and env var don't provide a value, the config file is checked next.

Config never overrides a value that was explicitly provided earlier in the chain.\
For the full precedence rules and examples, see [CLI Semantics](/guide/semantics).

## Enabling Config Discovery

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const deploy = command('deploy');

cli('mycli')
  .config('mycli') // app name for file discovery
  .command(deploy)
  .run();
```

This searches standard locations for config files named `.mycli.json`, `mycli.config.json`, etc.

### Search Paths

Config discovery is platform-aware:

1. `--config <path>` or `--config=<path>` (explicit override)
2. `./.mycli.json`, `./mycli.config.json` (project-local)
3. Unix: `$XDG_CONFIG_HOME/mycli/config.json`
4. Unix fallback: `~/.config/mycli/config.json`
5. Windows: `%APPDATA%\\mycli\\config.json`
6. Windows fallback: `%USERPROFILE%\\AppData\\Roaming\\mycli\\config.json`

## Custom Formats

JSON is built-in.
Add YAML, TOML, or any other format via `configFormat()`:

::: code-group

```ts twoslash [Bun built-ins]
import { cli, configFormat } from '@kjanat/dreamcli';

cli('mycli')
  .config('mycli')
  .configLoader(
    configFormat(['yaml', 'yml'], Bun.YAML.parse),
  )
  .configLoader(configFormat(['toml'], Bun.TOML.parse))
  .run();
```

```ts twoslash [npm packages]
import { cli, configFormat } from '@kjanat/dreamcli';
import { parse as parseYaml } from 'yaml';
import { parse as parseTOML } from '@iarna/toml';

cli('mycli')
  .config('mycli')
  .configLoader(configFormat(['yaml', 'yml'], parseYaml))
  .configLoader(configFormat(['toml'], parseTOML))
  .run();
```

:::

`configFormat(exts, parser)` creates a loader config from the extension list and parse function,
and `configLoader(loader)` registers that loader with the CLI.

Each extension should only be registered once per chain — registering the same extension
with different parsers causes duplicate loading.

The parsed value still has to be a plain object, so YAML scalars,
arrays, `null`, or multi-document YAML that parses to an array will fail as `CONFIG_PARSE_ERROR`.

## What's Next?

- [Shell Completions](/guide/completions) — generate completion scripts
- [Flags](/guide/flags) — full flag resolution chain
- [CLI Semantics](/guide/semantics) — exact precedence and masking behavior
