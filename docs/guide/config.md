# Config Files

dreamcli discovers and loads configuration files from standard locations. Config values participate
in the flag resolution chain.

## Linking Flags to Config

```ts
flag.enum(['us', 'eu', 'ap']).config('deploy.region');
```

This resolves `deploy.region` from the config file using dot-notation. If CLI argv and env var don't
provide a value, the config file is checked next.

## Enabling Config Discovery

```ts
cli('mycli')
  .config('mycli') // app name for file discovery
  .command(deploy)
  .run();
```

This searches standard locations for config files named `mycli.json`, `.myclirc`, etc.

### Search Paths

Config discovery follows XDG conventions:

1. `--config <path>` (explicit override)
2. `./.myclirc`, `./mycli.json` (project-local)
3. `$XDG_CONFIG_HOME/mycli/config.json`
4. `~/.config/mycli/config.json`

## Custom Formats

JSON is built-in. Add YAML, TOML, or any other format via `configFormat()`:

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
