# dreamcli

The main export. Import schema builders, CLI runner, output, parsing, and errors.

```ts
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
} from 'dreamcli';
import type {
  ActivityEvent,
  BeforeParseParams,
  CLIPluginHooks,
  CommandSchema,
  CommandMeta,
  DeprecationWarning,
  DeriveHandler,
  DeriveParams,
  Out,
  PluginCommandContext,
  ResolvedCommandParams,
  RunResult,
} from 'dreamcli';
```

## Schema Builders

### `command(name)`

Create a command builder.

```ts
const cmd = command('deploy')
  .description('Deploy the app')
  .arg('target', arg.string())
  .flag('force', flag.boolean())
  .action(({ args, flags, out }) => { ... });
```

### `group(name)`

Create a command group (container for subcommands).

```ts
const db = group('db')
  .description('Database operations')
  .command(migrate)
  .command(seed);
```

### `cli(name)`

Create a multi-command CLI builder.

```ts
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

```ts
cli('mycli').packageJson({ inferName: true }).command(deploy).run();
```

### `.plugin(definition)`

Register a CLI plugin created with `plugin(...)`. Plugins run in registration order and can observe
execution before parse, after resolve, before action, and after action.

```ts
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

```ts
command('deploy')
  .flag('token', flag.string().env('AUTH_TOKEN'))
  .derive(({ flags }) => {
    if (!flags.token) throw new CLIError('Not authenticated');
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

```ts
const trace = plugin(
  {
    beforeParse: ({ argv, out }) => out.info(argv.join(' ')),
    afterResolve: ({ flags, args }) => console.log({ flags, args }),
  },
  'trace',
);
```

## Plugin Types

### `CLIPluginHooks`

Lifecycle hook bag for `plugin(...)`. Each hook may be sync or async:

```ts
type CLIPluginHooks = {
  beforeParse?: (params: BeforeParseParams) => void | Promise<void>;
  afterResolve?: (params: ResolvedCommandParams) => void | Promise<void>;
  beforeAction?: (params: ResolvedCommandParams) => void | Promise<void>;
  afterAction?: (params: ResolvedCommandParams) => void | Promise<void>;
};
```

Use `beforeParse` to inspect raw argv, `afterResolve` to observe resolved args/flags,
`beforeAction` to run immediately before middleware and the action handler, and `afterAction`
to observe successful completion.

### `PluginCommandContext`

Base payload shared by all plugin hooks. It contains the current `command` schema, `meta`
(`CommandMeta`), and `out` channel, so hooks can inspect execution context without reaching into
internal CLI state.

```ts
type PluginCommandContext = {
  command: CommandSchema;
  meta: CommandMeta;
  out: Out;
};
```

### `BeforeParseParams`

Payload for `beforeParse`. Adds the leaf-command `argv` array to `PluginCommandContext` so plugins
can log, validate, or instrument the exact argument list before parsing starts.

```ts
type BeforeParseParams = PluginCommandContext & {
  argv: readonly string[];
};
```

### `ResolvedCommandParams`

Payload for `afterResolve`, `beforeAction`, and `afterAction`. Adds fully resolved `flags`, `args`,
and collected `deprecations` so hooks can inspect the final command inputs.

```ts
type ResolvedCommandParams = PluginCommandContext & {
  flags: Readonly<Record<string, unknown>>;
  args: Readonly<Record<string, unknown>>;
  deprecations: readonly DeprecationWarning[];
};
```

## Execution Types

### `CommandMeta`

Metadata about the running CLI, passed to action handlers and middleware as `meta`. It carries the
CLI `name`, display `bin`, `version`, and current leaf `command`, making it useful for logging,
telemetry, and custom output headers.

```ts
type CommandMeta = {
  name: string;
  bin: string;
  version: string | undefined;
  command: string;
};
```

### `RunResult`

Structured result returned by `runCommand(...)` and `cli.execute(...)`. It includes the process
`exitCode`, captured `stdout`/`stderr`, activity lifecycle events, and an `error` field that is
`undefined` on success and a `CLIError` on failure.

```ts
type RunResult = {
  exitCode: number;
  stdout: readonly string[];
  stderr: readonly string[];
  activity: readonly ActivityEvent[];
  error: CLIError | undefined;
};
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

```ts
const definition = generateSchema(myCli.schema);
```

### `generateInputSchema(schema, options?)`

Generate a JSON Schema (draft 2020-12) for validating CLI input as JSON.

- `schema`: `CLISchema` or `CommandSchema`
- `options.includeHidden?`: include hidden commands (default: `true`)

Accepts a full `CLISchema` (discriminated union across commands) or a
single `CommandSchema` (flat object schema).

```ts
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

```ts
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

```ts
configFormat(['yaml', 'yml'], Bun.YAML.parse);
configFormat(['toml'], Bun.TOML.parse);

import { parse as parseYaml } from 'yaml';
import { parse as parseTOML } from '@iarna/toml';

configFormat(['yaml', 'yml'], parseYaml);
configFormat(['toml'], parseTOML);
```

### `discoverConfig(appName, adapter, options?)`

Low-level config discovery helper behind `cli(...).config(...)`. It searches standard paths, reads
the first matching file via the provided adapter, and returns either `{ found: true, ... }` with
parsed config data or `{ found: false }` when no config file exists.

```ts
const result = await discoverConfig('mycli', adapter, {
  loaders: [
    configFormat(['yaml', 'yml'], Bun.YAML.parse),
    configFormat(['toml'], Bun.TOML.parse),
    configFormat(['yaml', 'yml'], parseYaml),
    configFormat(['toml'], parseTOML),
  ],
});
```

### `discoverPackageJson(adapter)`

Walk up from `adapter.cwd` and return the nearest parsed `package.json` metadata, or `null` when no
package file is found. This is the helper used by `.packageJson()` during `.run()`.

```ts
const pkg = await discoverPackageJson(adapter);
if (pkg !== null) {
  console.log(pkg.version);
}
```

### `inferCliName(pkg)`

Infer a CLI display name from package metadata. It prefers the first key from a `bin` object and
otherwise falls back to the package `name` with any npm scope removed.

```ts
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
