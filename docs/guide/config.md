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

Config discovery is platform-aware. The first match wins; files are never
merged across locations.

1. `--config <path>` or `--config=<path>` (explicit override, skips discovery)
2. Project scope — for the working directory and each ancestor up to the
   filesystem root, nearest first:
   1. `.mycli.json`
   2. `mycli.config.json`
   3. `.config/mycli.json`
3. User scope, in order:
   - Unix: `$XDG_CONFIG_HOME/mycli/config.json`, falling back to
     `~/.config/mycli/config.json`
   - macOS: the Unix locations, then
     `~/Library/Application Support/mycli/config.json`
   - Windows: `%APPDATA%\\mycli\\config.json`, falling back to
     `%USERPROFILE%\\AppData\\Roaming\\mycli\\config.json`
4. System scope — `/etc/mycli/config.json` on Linux and macOS

When calling `discoverConfig()` directly, `baseDir` anchors the project-scope
walk to a directory other than `cwd` (useful for editor integrations operating
on a specific file), and custom `searchPaths` replace the whole default list.

## Custom Formats

JSON is built-in.
Add YAML, TOML, or any other format via `configFormat()`:

::: code-group

```ts twoslash [Bun built-ins]
import { cli } from '@kjanat/dreamcli';
import { configFormat } from '@kjanat/dreamcli/config';

cli('mycli')
  .config('mycli')
  .configLoader(
    configFormat(['yaml', 'yml'], Bun.YAML.parse),
  )
  .configLoader(configFormat(['toml'], Bun.TOML.parse))
  .run();
```

```ts twoslash [npm packages]
import { cli } from '@kjanat/dreamcli';
import { configFormat } from '@kjanat/dreamcli/config';
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
