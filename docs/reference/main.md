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
  CLIError,
  ParseError,
  ValidationError,
  createOutput,
  generateCompletion,
  configFormat,
  formatHelp,
  parse,
  tokenize,
  resolve,
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
  .run();
```

### `flag`

Flag factory with typed builders:

| Factory                | Type                           | Default |
| ---------------------- | ------------------------------ | ------- |
| `flag.string()`        | `string \| undefined`          | —       |
| `flag.number()`        | `number \| undefined`          | —       |
| `flag.boolean()`       | `boolean`                      | `false` |
| `flag.enum(values)`    | Union of values \| `undefined` | —       |
| `flag.array(inner)`    | `T[] \| undefined`             | —       |
| `flag.custom(parseFn)` | Return type \| `undefined`     | —       |

### `arg`

Argument factory:

| Factory               | Type        |
| --------------------- | ----------- |
| `arg.string()`        | `string`    |
| `arg.number()`        | `number`    |
| `arg.custom(parseFn)` | Return type |

### `middleware<Context>(handler)`

Create typed middleware that adds context to the chain.

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

## Completions

### `generateCompletion(schema, shell, options?)`

Generate a shell completion script from a command schema.

- `shell`: `'bash'` | `'zsh'`
- `options.functionPrefix?`: override the generated helper function prefix
- `options.rootMode?`: `'subcommands'` | `'surface'`

## Config

### `configFormat(extensions, parseFn)`

Create a config format loader.

```ts
configFormat(['yaml', 'yml'], parseYAML);
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
