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

Use `.config('mycli', { noConfigFlag: true })` to let users skip file discovery
with `--no-config` when running the CLI. The flag is available before or after
the command name. It conflicts with `--config <path>` and `--config=<path>`.
After `--`, both spellings are passed through as positional arguments.

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

When multiple loaders register the same extension, the last registration wins.

The parsed value still has to be a plain object, so YAML scalars,
arrays, `null`, or multi-document YAML that parses to an array will fail as `CONFIG_PARSE_ERROR`.

## Executable Config Files

Register `configModule()` to discover executable JavaScript files such as `mycli.config.mjs`
or to accept them via `--config`. Register it only if you trust the files in the discovery paths.
The runtime executes the selected file and its imports with the CLI's permissions.

```ts twoslash
import { cli } from '@kjanat/dreamcli';
import { configModule } from '@kjanat/dreamcli/config';

cli('mycli')
  .config('mycli', [configModule()])
  .run();
```

An ES module must default-export a plain object. A CommonJS module uses `module.exports`.

```js
// mycli.config.mjs
export default { deploy: { region: 'eu' } };
```

`configModule()` registers `.mjs`, `.cjs`, and `.js`. Pass `configModule({ typescript: true })`
to also register `.mts`, `.cts`, and `.ts`. Node, Bun, and Deno use their native import rules,
including package settings for ambiguous extensions. On Node, use TypeScript syntax that can
be stripped without transformation. On Deno, grant read access to the config files you want to
discover. Module dependencies follow the runtime's usual loading and permission rules.

By default, the runtime caches the imported module. Two discoveries of the same file in one
process return its exported object, including any functions or class instances inside it.
Treat that object and its children as borrowed, read-only values. Restart the process to pick
up edits or retry a module that threw during evaluation.

For a watcher or editor integration that needs to see edits between runs, opt into fresh loads:

```ts twoslash
import { configModule, discoverConfig } from '@kjanat/dreamcli/config';
import { createAdapter } from '@kjanat/dreamcli/runtime';

const adapter = createAdapter();
const loaders = [configModule({ fresh: true, typescript: true })];
const reload = () => discoverConfig('mycli', adapter, { loaders });

await reload();
// After saving mycli.config.ts or a module it imports:
await reload();
```

Each fresh load runs in a new worker and returns the exported data through structured cloning.
Edits to local dependencies take effect on the next load, including after an evaluation error.
Use plain records, arrays, and data values in this mode. Functions cause `CONFIG_PARSE_ERROR`;
class prototypes and property descriptors do not survive cloning. The worker terminates after
loading. If evaluation stalls, the native adapter terminates the worker after 30 seconds
and discovery reports `CONFIG_PARSE_ERROR`. Set a shorter deadline for an editor reload with
`configModule({ fresh: true, timeoutMs: 2_000 })`. On Deno the worker inherits the parent's permissions.

JSON retains its existing search precedence. For a `PathConfigLoader`, native adapters check
the candidate's existence before passing its path to `load`. Custom adapters can supply
`configFileExists` for the same behavior. Adapters that supply only `readFile` use that to
probe candidates. On Deno, automatic discovery skips inaccessible paths and an explicitly
selected executable config that cannot be probed reports `CONFIG_READ_ERROR`.

## What's Next?

- [Shell Completions](/guide/completions) — generate completion scripts
- [Flags](/guide/flags) — full flag resolution chain
- [CLI Semantics](/guide/semantics) — exact precedence and masking behavior
