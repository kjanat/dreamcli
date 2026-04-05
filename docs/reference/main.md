# @kjanat/dreamcli

The main export. Import schema builders, CLI runner, output, parsing, and errors.

Key types: [`ActivityEvent`](/reference/symbols/main/ActivityEvent), [`BeforeParseParams`](/reference/symbols/main/BeforeParseParams), [`CLIPluginHooks`](/reference/symbols/main/CLIPluginHooks), [`CommandMeta`](/reference/symbols/main/CommandMeta), [`CommandSchema`](/reference/symbols/main/CommandSchema), [`DeprecationWarning`](/reference/symbols/main/DeprecationWarning), [`DeriveHandler`](/reference/symbols/main/DeriveHandler), [`DeriveParams`](/reference/symbols/main/DeriveParams), [`Out`](/reference/symbols/main/Out), [`PluginCommandContext`](/reference/symbols/main/PluginCommandContext), [`ResolvedCommandParams`](/reference/symbols/main/ResolvedCommandParams), [`RunResult`](/reference/symbols/main/RunResult)

```ts twoslash
import {
  cli,
  command,
  group,
  flag,
  arg,
  middleware,
  plugin,
  CLIError,
  ParseError,
  ValidationError,
  isCLIError,
  isParseError,
  isValidationError,
  createOutput,
  generateSchema,
  generateInputSchema,
  generateCompletion,
  buildConfigSearchPaths,
  configFormat,
  discoverConfig,
  discoverPackageJson,
  inferCliName,
  formatHelp,
  parse,
  tokenize,
  resolve,
} from '@kjanat/dreamcli';
```

## Schema Builders

### `command(name)`

Create a command builder.

```ts twoslash
import { arg, command, flag } from '@kjanat/dreamcli';

const cmd = command('deploy')
  .description('Deploy the app')
  .arg('target', arg.string())
  .flag('force', flag.boolean())
  .action(({ args, flags, out }) => {});
```

### `group(name)`

Create a command group (container for subcommands).

```ts twoslash
import { command, group } from '@kjanat/dreamcli';

const migrate = command('migrate');
const seed = command('seed');

const db = group('db')
  .description('Database operations')
  .command(migrate)
  .command(seed);
```

### `cli(name)`

Create a multi-command CLI builder.

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const deploy = command('deploy');
const mainCmd = command('main');

cli('mycli')
  .version('1.0.0')
  .description('My tool')
  .command(deploy)
  .default(mainCmd)
  .config('mycli')
  .packageJson({ inferName: true })
  .run();
```

### `.packageJson(settings?)`

Enable automatic `package.json` discovery during `.run()`. When enabled, dreamcli walks up from
the current working directory, reads the nearest `package.json`, and uses its `version` and
`description` fields as fallback CLI metadata. Pass `{ inferName: true }` to also infer the CLI
name from the package `bin` entry or package name. This has no effect in `.execute()`.

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const deploy = command('deploy');

cli('mycli').packageJson({ inferName: true }).command(deploy).run();
```

### `.plugin(definition)`

Register a CLI plugin created with `plugin(...)`. Plugins run in registration order and can observe
execution before parse, after resolve, before action, and after action.

```ts twoslash
import { cli, command, plugin } from '@kjanat/dreamcli';

const deploy = command('deploy');
const tracePlugin = plugin({}, 'trace');

cli('mycli').plugin(tracePlugin).command(deploy);
```

### `flag`

Flag factory with typed builders:

| Factory                | Type                           | Default |
| ---------------------- | ------------------------------ | ------- |
| `flag.string()`        | `string \| undefined`          | —       |
| `flag.number()`        | `number \| undefined`          | —       |
| `flag.boolean()`       | `boolean`                      | `false` |
| `flag.enum(values)`    | Union of values \| `undefined` | —       |
| `flag.array(inner)`    | `T[]`                          | `[]`    |
| `flag.custom(parseFn)` | Return type \| `undefined`     | —       |

### `arg`

Argument factory:

| Factory               | Type                            |
| --------------------- | ------------------------------- |
| `arg.string()`        | `string`                        |
| `arg.number()`        | `number`                        |
| `arg.enum(values)`    | Union of provided string values |
| `arg.custom(parseFn)` | Return type                     |

### `middleware<Context>(handler)`

Create typed middleware that can wrap downstream execution and add context to the chain.

### `.derive(handler)`

Register a command-scoped typed pre-action handler. Derive runs after resolution, receives typed
`{ args, flags, ctx, out, meta }`, and may either return `void` for validation-only behavior or
return an object to merge additional properties into `ctx`.

```ts twoslash
import { CLIError, command, flag } from '@kjanat/dreamcli';

command('deploy')
  .flag('token', flag.string().env('AUTH_TOKEN'))
  .derive(({ flags }) => {
    if (!flags.token)
      throw new CLIError('Not authenticated', { code: 'AUTH_REQUIRED' });
    return { token: flags.token };
  })
  .action(({ ctx }) => {
    ctx.token; // string
  });
```

### `plugin(hooks, name?)`

Create a reusable CLI plugin definition from lifecycle hooks. The returned value can be attached
with `cli(...).plugin(...)` and receives stable hook payloads typed by `BeforeParseParams`,
`ResolvedCommandParams`, and `PluginCommandContext`.

```ts twoslash
import { cli, command, plugin } from '@kjanat/dreamcli';

const deploy = command('deploy');

const trace = plugin(
  {
    beforeParse: ({ argv, out }) => out.info(argv.join(' ')),
    afterResolve: ({ flags, args }) => console.log({ flags, args }),
  },
  'trace',
);

cli('mycli').plugin(trace).command(deploy);
```

## Plugin Types

### `CLIPluginHooks`

Lifecycle hook bag for `plugin(...)`. Each hook may be sync or async:

```ts twoslash
import type { CLIPluginHooks } from '@kjanat/dreamcli';

type _Show = CLIPluginHooks;
//   ^?
```

Use `beforeParse` to inspect raw argv, `afterResolve` to observe resolved args/flags,
`beforeAction` to run immediately before middleware and the action handler, and `afterAction`
to observe successful completion.

### `PluginCommandContext`

Base payload shared by all plugin hooks. It contains the current `command` schema, `meta`
(`CommandMeta`), and `out` channel, so hooks can inspect execution context without reaching into
internal CLI state.

```ts twoslash
import type { PluginCommandContext } from '@kjanat/dreamcli';

type _Show = PluginCommandContext;
//   ^?
```

### `BeforeParseParams`

Payload for `beforeParse`. Adds the leaf-command `argv` array to `PluginCommandContext` so plugins
can log, validate, or instrument the exact argument list before parsing starts.

```ts twoslash
import type { BeforeParseParams } from '@kjanat/dreamcli';

type _Show = BeforeParseParams;
//   ^?
```

### `ResolvedCommandParams`

Payload for `afterResolve`, `beforeAction`, and `afterAction`. Adds fully resolved `flags`, `args`,
and collected `deprecations` so hooks can inspect the final command inputs.

```ts twoslash
import type { ResolvedCommandParams } from '@kjanat/dreamcli';

type _Show = ResolvedCommandParams;
//   ^?
```

## Execution Types

### `CommandMeta`

Metadata about the running CLI, passed to action handlers and middleware as `meta`. It carries the
CLI `name`, display `bin`, `version`, and current leaf `command`, making it useful for logging,
telemetry, and custom output headers.

```ts twoslash
import type { CommandMeta } from '@kjanat/dreamcli';

type _Show = CommandMeta;
//   ^?
```

### `RunResult`

Structured result returned by `runCommand(...)` and `cli.execute(...)`. It includes the process
`exitCode`, captured `stdout`/`stderr`, activity lifecycle events, and an `error` field that is
`undefined` on success and a `CLIError` on failure.

```ts twoslash
import type { RunResult } from '@kjanat/dreamcli';

type _Show = RunResult;
//   ^?
```

## Output

### `createOutput(options?)`

Create an output channel.
Typically not called directly — commands receive `out` in the action handler.

## Parsing

### `tokenize(argv)`

Tokenize raw argv into a `Token[]` array.

### `parse(schema, argv)`

Parse argv against a command schema, returning `ParseResult`.

### `resolve(schema, parseResult, options)`

Resolve flag values through the resolution chain.

## Schema Export

### `generateSchema(schema, options?)`

Generate a definition metadata document describing the CLI's structure.

- `schema`: `CLISchema` from `cli.schema`
- `options.includeHidden?`: include hidden commands (default: `true`)
- `options.includePrompts?`: include prompt config on flags (default: `true`)

```ts twoslash
import { cli, command, generateSchema } from '@kjanat/dreamcli';

const myCli = cli('mycli').command(command('deploy'));

const definition = generateSchema(myCli.schema);
```

### `generateInputSchema(schema, options?)`

Generate a JSON Schema (draft 2020-12) for validating CLI input as JSON.

- `schema`: `CLISchema` or `CommandSchema`
- `options.includeHidden?`: include hidden commands (default: `true`)

Accepts a full `CLISchema` (discriminated union across commands) or a
single `CommandSchema` (flat object schema).

```ts twoslash
import { cli, command, generateInputSchema } from '@kjanat/dreamcli';

const myCli = cli('mycli').command(command('deploy'));

const inputSchema = generateInputSchema(myCli.schema);
```

## Completions

### `generateCompletion(schema, shell, options?)`

Generate a shell completion script from a command schema.

- `shell`: `'bash'` | `'zsh'`
- `options.functionPrefix?`: override the generated helper function prefix
- `options.rootMode?`: `'subcommands'` | `'surface'`

## Config

### `buildConfigSearchPaths(appName, cwd, configDir, loaders?)`

Build the default search-path list dreamcli uses for config discovery. This is mainly useful for
debugging, custom bootstrapping, or help text that wants to show the exact probed paths.

```ts twoslash
import { buildConfigSearchPaths } from '@kjanat/dreamcli';

const paths = buildConfigSearchPaths(
  'mycli',
  process.cwd(),
  '/home/me/.config',
);
```

### `configFormat(extensions, parseFn)`

Create a config format loader from a list of file extensions and a parse function. Pass the result
to `.configLoader(...)` or `discoverConfig(...)` to add YAML, TOML, or other formats on top of the
built-in JSON loader.

```ts twoslash
import { configFormat } from '@kjanat/dreamcli';

declare const parseYaml: (s: string) => unknown;
declare const parseTOML: (s: string) => unknown;
// ---cut---
configFormat(['yaml', 'yml'], parseYaml);
configFormat(['toml'], parseTOML);
```

### `discoverConfig(appName, adapter, options?)`

Low-level config discovery helper behind `cli(...).config(...)`. It searches standard paths, reads
the first matching file via the provided adapter, and returns either `{ found: true, ... }` with
parsed config data or `{ found: false }` when no config file exists.

```ts twoslash
import { configFormat, discoverConfig } from '@kjanat/dreamcli';
import { createTestAdapter } from '@kjanat/dreamcli/testkit';

declare const parseYaml: (s: string) => unknown;
declare const parseTOML: (s: string) => unknown;
const adapter = createTestAdapter();
// ---cut---
const result = await discoverConfig('mycli', adapter, {
  loaders: [
    configFormat(['yaml', 'yml'], parseYaml),
    configFormat(['toml'], parseTOML),
  ],
});
```

### `discoverPackageJson(adapter)`

Walk up from `adapter.cwd` and return the nearest parsed `package.json` metadata, or `null` when no
package file is found. This is the helper used by `.packageJson()` during `.run()`.

```ts twoslash
import { discoverPackageJson } from '@kjanat/dreamcli';
import { createTestAdapter } from '@kjanat/dreamcli/testkit';

const adapter = createTestAdapter();

const pkg = await discoverPackageJson(adapter);
if (pkg !== null) {
  console.log(pkg.version);
}
```

### `inferCliName(pkg)`

Infer a CLI display name from package metadata. It prefers the first key from a `bin` object and
otherwise falls back to the package `name` with any npm scope removed.

```ts twoslash
import { inferCliName } from '@kjanat/dreamcli';

inferCliName({ bin: { mycli: './dist/cli.js' } }); // 'mycli'
inferCliName({ name: '@scope/mycli' }); // 'mycli'
```

## Errors

### `CLIError`

Base error class with `code`, `exitCode`, `suggest`, `details`.

### `ParseError`

Extends `CLIError`. Thrown for argv parsing failures.

### `ValidationError`

Extends `CLIError`. Thrown for value validation failures.

### Type Guards

- `isCLIError(err)` — narrows to `CLIError`
- `isParseError(err)` — narrows to `ParseError`
- `isValidationError(err)` — narrows to `ValidationError`
