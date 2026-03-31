# Config Files

dreamcli discovers and loads configuration files from standard locations.
Config values participate in the flag resolution chain.

## Linking Flags to Config

```ts
flag.enum(['us', 'eu', 'ap']).config('deploy.region');
```

This resolves `deploy.region` from the config file using dot-notation.
If CLI argv and env var don't provide a value, the config file is checked next.

## Enabling Config Discovery

```ts
cli('mycli')
  .config('mycli') // app name for file discovery
  .command(deploy)
  .run();
```

This searches standard locations for config files named `.mycli.json`, `mycli.config.json`, etc.

### Search Paths

Config discovery is platform-aware:

1. `--config <path>` (explicit override)
2. `./.mycli.json`, `./mycli.config.json` (project-local)
3. Unix: `$XDG_CONFIG_HOME/mycli/config.json`
4. Unix fallback: `~/.config/mycli/config.json`
5. Windows: `%APPDATA%\\mycli\\config.json`
6. Windows fallback: `%USERPROFILE%\\AppData\\Roaming\\mycli\\config.json`

## Custom Formats

JSON is built-in.
Add YAML, TOML, or any other format via `configFormat()`:

```ts
import { configFormat } from 'dreamcli';
import { parse as parseYAML } from 'yaml';

cli('mycli')
  .config('mycli')
  .configLoader(configFormat(['yaml', 'yml'], parseYAML))
  .run();
```

The loader receives a file extension list and a parse function `(content: string) => unknown`.

## What's Next?

- [Shell Completions](/guide/completions) — generate completion scripts
- [Flags](/guide/flags) — full flag resolution chain
