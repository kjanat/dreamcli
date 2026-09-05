# @kjanat/dreamcli

The main export. Import schema builders, CLI runner, output, parsing, and errors.

Optional features live on their own subpaths and the builder loads them on demand:
[`@kjanat/dreamcli/completion`](/reference/completion), [`@kjanat/dreamcli/json-schema`](/reference/json-schema),
[`@kjanat/dreamcli/config`](/reference/config), and [`@kjanat/dreamcli/prompt`](/reference/prompt).

Key types: [`ActivityEvent`](/reference/symbols/main/ActivityEvent), [`BeforeParseParams`](/reference/symbols/main/BeforeParseParams), [`CLIPluginHooks`](/reference/symbols/main/CLIPluginHooks), [`CommandMeta`](/reference/symbols/main/CommandMeta), [`CommandSchema`](/reference/symbols/main/CommandSchema), [`DeprecationWarning`](/reference/symbols/main/DeprecationWarning), [`DeriveHandler`](/reference/symbols/main/DeriveHandler), [`DeriveParams`](/reference/symbols/main/DeriveParams), [`Out`](/reference/symbols/main/Out), [`PluginCommandContext`](/reference/symbols/main/PluginCommandContext), [`ResolvedCommandParams`](/reference/symbols/main/ResolvedCommandParams), [`RunResult`](/reference/symbols/main/RunResult)

```ts twoslash
import {
  cli,
  isMainModule,
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
  formatHelp,
  parse,
  tokenize,
  resolve,
  readFlags,
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
  .manifest({ inferName: true })
  .run();
```

### `.manifest(settings?)` / `.manifest(data)`

Source the CLI's `version` and `description` (and optionally its name) from a manifest file —
`package.json`, `deno.json`, or `jsr.json`. There are two complementary forms.

> `.packageJson()` and `.denoJson()` were **removed in v4**. Use `.manifest()`: it defaults to
> `files: ['package.json']`, and `.denoJson()` becomes
> `.manifest({ files: ['deno.json', 'deno.jsonc', 'jsr.json'] })`.

**Discovery (`settings`) form.** During `.run()`, dreamcli walks up from the current working
directory and reads the nearest manifest among `files` (default `['package.json']`); the nearest
directory wins, and `files` order only tiebreaks within a single directory. Files are parsed as JSON
with a JSONC fallback, so `package.json`, `deno.json`, `jsr.json`, and `deno.jsonc` all work —
including files with `//` / block comments or trailing commas (common in `deno.json`). A
config-only manifest carrying no recognised metadata (e.g. a `deno.json` with only `tasks`/`imports`)
is skipped so discovery keeps probing. Pass `{ inferName: true }` to also infer the CLI name from the
package `bin` entry or `name`; `deno.json`/`jsr.json` have no `bin`, so the name comes from `name` —
pass `inferName: { scope: 'keep' }` to retain a leading `@scope/` (stripped by default). Discovery
has no effect in `.execute()`.

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const deploy = command('deploy');

// Deno / JSR CLI: discover deno.json then jsr.json, keep the scoped name:
cli('mycli')
  .manifest({
    files: ['deno.json', 'deno.jsonc', 'jsr.json'],
    inferName: { scope: 'keep' },
  })
  .command(deploy)
  .run();
```

**Anchored discovery (`from`).** Discovery defaults to the consumer's cwd, which is wrong for an
**installable** CLI (`npm i -g`, `bunx`, `npx`, `deno install`) — its version should reflect its OWN
package, not wherever it happens to be invoked. In a conventional Node, Bun, or Deno project, pass
`{ from: import.meta.url }` to anchor the walk-up to the CLI's own module. Path strings, `file:` URL
strings, and `URL` instances are also accepted.

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const deploy = command('deploy');

// Report THIS CLI's version from any working directory:
cli('mycli')
  .manifest({ from: import.meta.url })
  .command(deploy)
  .run();
```

If the project's ambient `ImportMeta` interface omits the runtime-specific `url` property, pass the
whole object instead: `.manifest({ from: import.meta })`. DreamCLI extracts the URL internally. This
compatibility form is useful for cross-runtime packages that cannot augment `ImportMeta` globally.
JSR does not accept global augmentation. Projects whose runtime typings already provide
`import.meta.url` do not need it.

**Pre-loaded (`data`) form.** Pass an already-imported manifest to skip the filesystem entirely.
Bundlers can statically resolve it, locking the reported version at build time. Unlike the discovery
forms, the data form **also works in `.execute()`** — `version`/`description` are merged into the CLI
schema at builder time. Explicit `.version()`/`.description()` still win, and the data form does not
infer the name.

```ts
import { cli, command } from '@kjanat/dreamcli';
import denoCfg from './deno.json' with { type: 'json' };

const deploy = command('deploy');

cli('mycli').manifest(denoCfg).command(deploy).run();
```

### `isMainModule(meta)`

Node, Bun, and Deno expose the conventional entrypoint guard directly. Use it when the runtime's
ambient types are available:

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const deploy = command('deploy');
const app = cli('mycli').command(deploy);

if (import.meta.main) {
  app.run();
}
```

`isMainModule(import.meta)` is the compatibility form for projects whose ambient `ImportMeta`
interface omits `main`. It performs the same check without direct property access or global
augmentation, keeping cross-runtime JSR packages type-checkable and publishable:

```ts twoslash
import {
  cli,
  command,
  isMainModule,
} from '@kjanat/dreamcli';

const deploy = command('deploy');
const app = cli('mycli').command(deploy);

if (isMainModule(import.meta)) {
  app.run();
}
```

### `.links(links?)`

Make the root-help header clickable with [OSC 8
hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda). The program name and
version on the first line of root `--help` output become links in supporting terminals. The
`help.hyperlinks` run option is the direct programmatic override. Otherwise explicit
`--no-hyperlinks` / `--hyperlinks` flags take precedence, followed by `NO_HYPERLINKS`, then
`FORCE_HYPERLINKS`, and finally TTY detection. Escapes remain confined to the header line — usage
lines, the `--help` hint, the commands table, and completion scripts stay plain.

URLs not provided are derived from manifest metadata when `.manifest()` is active (both the
discovery and pre-loaded data forms): the name links to the normalized `repository` URL (falling back
to `homepage`), and the version links to the forge release tag (`{repo}/releases/tag/v{version}` on
GitHub, `{repo}/-/releases/v{version}` on GitLab).

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';

const deploy = command('deploy');

// Derive both links from the manifest repository/homepage:
cli('mycli').manifest().links().command(deploy).run();

// Explicit URLs (no package.json required):
cli('mycli')
  .version('1.0.0')
  .links({
    name: 'https://github.com/me/mycli',
    version:
      'https://github.com/me/mycli/releases/tag/v1.0.0',
  })
  .command(deploy)
  .run();
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

| Factory                | Type                            | Default |
| ---------------------- | ------------------------------- | ------- |
| `flag.string()`        | `string \| undefined`           | none    |
| `flag.number()`        | `number \| undefined`           | none    |
| `flag.boolean()`       | `boolean`                       | `false` |
| `flag.enum(values)`    | Union of values \| `undefined`  | none    |
| `flag.array(inner)`    | `T[]`                           | `[]`    |
| `flag.custom(parseFn)` | Return type \| `undefined`      | none    |
| `flag.url()`           | `URL \| undefined`              | none    |
| `flag.path()`          | `string \| undefined`           | none    |
| `flag.date()`          | `Date \| undefined`             | none    |
| `flag.duration()`      | `number \| undefined` (ms)      | none    |
| `flag.bytes()`         | `number \| undefined`           | none    |
| `flag.count()`         | `number`                        | `0`     |
| `flag.keyValue()`      | `Record<string, string>`        | `{}`    |

See [Flags](/guide/flags#flag-types) for the option objects and constraints each
kind accepts.

### `arg`

Argument factory. Every kind is required unless `.optional()` or `.default()`
says otherwise:

| Factory               | Type                            |
| --------------------- | ------------------------------- |
| `arg.string()`        | `string`                        |
| `arg.number()`        | `number`                        |
| `arg.boolean()`       | `boolean`                       |
| `arg.enum(values)`    | Union of provided string values |
| `arg.custom(parseFn)` | Return type                     |
| `arg.keyValue()`      | `Record<string, string>`        |
| `arg.url()`           | `URL`                           |
| `arg.path()`          | `string`                        |
| `arg.date()`          | `Date`                          |
| `arg.duration()`      | `number` (ms)                   |
| `arg.bytes()`         | `number`                        |

`array` and `count` are flag-only. `.variadic()` is the arg form of
`flag.array()`, and a count has no positional meaning. See
[What the arg factory does not have](/guide/arguments#flag-only-surface).

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
      throw new CLIError('Not authenticated', {
        code: 'AUTH_REQUIRED',
      });
    return { token: flags.token };
  })
  .action(({ ctx }) => {
    ctx.token;
    //     ^?
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
    beforeParse: ({ argv, out }) =>
      out.info(argv.join(' ')),
    afterResolve: ({ flags, args }) =>
      console.log({ flags, args }),
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
//                   ^?
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
//                       ^?
```

### `BeforeParseParams`

Payload for `beforeParse`. Adds the leaf-command `argv` array to `PluginCommandContext` so plugins
can log, validate, or instrument the exact argument list before parsing starts.

```ts twoslash
import type { BeforeParseParams } from '@kjanat/dreamcli';
//                  ^?
```

### `ResolvedCommandParams`

Payload for `afterResolve`, `beforeAction`, and `afterAction`. Adds fully resolved `flags`, `args`,
and collected `deprecations` so hooks can inspect the final command inputs.

```ts twoslash
import type { ResolvedCommandParams } from '@kjanat/dreamcli';
//                       ^?
```

## Execution Types

### `CommandMeta`

Metadata about the running CLI, passed to action handlers and middleware as `meta`. It carries the
CLI `name`, display `bin`, `version`, and current leaf `command`, making it useful for logging,
telemetry, and custom output headers.

```ts twoslash
import type { CommandMeta } from '@kjanat/dreamcli';
//                 ^?
```

### `RunResult`

Structured result returned by `runCommand(...)` and `cli.execute(...)`. It includes the process
`exitCode`, captured `stdout`/`stderr`, activity lifecycle events, and an `error` field that is
`undefined` on success and a `CLIError` on failure.

```ts twoslash
import type { RunResult } from '@kjanat/dreamcli';
//               ^?
```

## Output

### `createOutput(options?)`

Create an output channel.
Typically not called directly — commands receive `out` in the action handler.

Handlers can call `out.setExitCode(code)` to request a process exit code without
printing error output. The command still completes normally and `RunResult.error`
stays `undefined` unless an error is thrown.

## Parsing

### `tokenize(argv)`

Tokenize raw argv into a `Token[]` array.

### `parse(schema, argv)`

Parse argv against a command schema, returning `ParseResult`.

### `resolve(schema, parseResult, options)`

Resolve flag values through the resolution chain.

### `readFlags(definitions, options?)`

Evaluate a record of flag builders outside a CLI and return a
`Promise<InferFlags<F>>` of the resolved values. It runs the same schema, parser, coercion,
resolver, and validation a command runs, with no dispatch, output channel, help, or process exit. See
[Standalone Flag Evaluation](/guide/read-flags).

- `definitions`: `FlagMap`, a record of `FlagBuilder` values keyed by canonical flag name
- `options`: `ReadFlagsOptions`, which extends `ResolveOptions` with `argv`, `adapter`, `parse`, and
  `onDeprecation`

```ts twoslash
import { flag, readFlags } from '@kjanat/dreamcli';

const options = await readFlags(
  {
    watch: flag.boolean().alias('w').env('WATCH'),
    target: flag
      .enum(['node', 'browser'])
      .default('node'),
  },
  { argv: ['-w'], env: {} },
);
```

## Help

### `osc8(url, text)`

Wrap `text` in an [OSC 8
hyperlink](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) pointing at `url`
(string or `URL`). Supporting terminals render clickable text; others ignore the escapes. Useful for
linking arbitrary help strings, e.g. `.version(osc8(releaseUrl, '1.0.0'))`.

### `visibleWidth(text)`

Measure the visible column width of `text`, ignoring ANSI CSI (colors) and OSC (hyperlink) escape
sequences. Help formatting uses this internally for padding and wrapping, so colored or linked text
no longer breaks table alignment.

```ts twoslash
import { osc8, visibleWidth } from '@kjanat/dreamcli';

const link = osc8('https://github.com/me/mycli', 'mycli');
visibleWidth(link); // 5
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
