# Standalone Flag Evaluation

`readFlags()` takes a record of flag builders, evaluates it, and returns the
resolved values. There is no command, no dispatch, no output channel, no help
text, and no process exit. The call returns typed values or throws.

## Build Scripts

A build script wants a few typed options and one direct action. Wrapping that in
a `cli()` program costs a command, an action handler, and an output channel for
behavior the script never uses, and calling `parse()` and `resolve()` by hand
returns `Record<string, unknown>` and drops the types the builders carry.
`readFlags()` is the flag layer on its own:

```ts twoslash
// build.ts
import { flag, readFlags } from '@kjanat/dreamcli';

const options = await readFlags({
  watch: flag.boolean().alias('w').env('WATCH'),
  minify: flag.boolean().env('MINIFY').default(true),
  target: flag
    .enum(['node', 'browser'])
    .env('TARGET')
    .default('node'),
});

options.target;
//        ^?
```

Each of these invocations reaches the same three values:

```bash
WATCH=true bun build.ts
bun build.ts --watch
bun build.ts -w
```

## The Record API

The object key is the `--name` spelling and the key on the returned record. The
result is typed by `InferFlags`, the operator behind `flags` inside `.action()`,
so kinds, enum literals, and presence rules carry over unchanged:

```ts twoslash
import { flag, readFlags } from '@kjanat/dreamcli';
// ---cut---
const values = await readFlags({
  out: flag.string().required(),
  tag: flag.string(),
  verbose: flag.count().alias('v'),
});

values.tag;
//      ^?
```

`out` is `string`, `tag` is `string | undefined`, and `verbose` is `number`.

Evaluation is one pass over argv. The record is the complete flag surface, which
is what makes unknown input detectable and what lets collisions between
canonical names, aliases, and negated spellings be rejected. A per-flag reader
would rescan argv and could not see either.

## Semantics Come From The Command Path

`readFlags()` compiles the record into a command schema and runs the same
parser, coercion, resolver, and validation a command runs. Aliases,
`--flag=value`, short-flag clustering, negated spellings declared with
`.negatable()`, duplicate policy, kebab and camel spelling parity, unknown-flag
rejection with suggestions, string and number constraints, Standard Schema
validators, and `flag.path()` checks all behave as they do inside `.action()`.

[CLI Semantics](/guide/semantics) is the rule set, and it applies here as
written.

## Precedence

CLI argv, then environment variable, then config, then interactive prompt, then
default. Each stage is opt-in per flag and the first source that supplies a
value wins.

Two stages need something from the caller. `config` is a plain object passed in;
nothing is read from disk. `prompter` is a prompt engine passed in; none is
built. A `.prompt()` flag with no prompter falls through to its default, on a
TTY as well as off one.

## Explicit Injection

Supplying `argv` and `env` keeps the call away from the host, which is what a
test wants:

```ts twoslash
import { flag, readFlags } from '@kjanat/dreamcli';
// ---cut---
const values = await readFlags(
  { watch: flag.boolean().alias('w').env('WATCH') },
  { argv: [], env: { WATCH: 'true' } },
);

values.watch; // true
```

`argv` is user arguments only, without the binary and script entries.

A test adapter covers the whole runtime surface in one object, including the
argv slicing a real process goes through:

```ts twoslash
import { flag, readFlags } from '@kjanat/dreamcli';
import { createTestAdapter } from '@kjanat/dreamcli/testkit';

const adapter = createTestAdapter({
  argv: ['node', 'build.ts', '--target', 'browser'],
  env: { MINIFY: 'false' },
});

const options = await readFlags(
  {
    minify: flag.boolean().env('MINIFY').default(true),
    target: flag
      .enum(['node', 'browser'])
      .env('TARGET')
      .default('node'),
  },
  { adapter },
);

expect(options).toEqual({
  minify: false,
  target: 'browser',
});
```

## Adapter Defaults

| Fact               | Source when the caller omits it                                   |
| ------------------ | ----------------------------------------------------------------- |
| `argv`             | the adapter's argv past its binary and script entries             |
| `env`              | the adapter's environment snapshot                                |
| `stat` and `mkdir` | the adapter's filesystem primitives, used by `flag.path()` checks |
| `config`           | nothing, so the config stage is skipped                           |
| `prompter`         | nothing, so the prompt stage is skipped                           |

The adapter is built the first time a fact the caller left out is needed, so a
call given `argv` and `env` builds none at all unless a `flag.path()` check
reaches for `stat` or `mkdir`. Pass `adapter` to pin the runtime instead of
detecting one. `createAdapter()` detects Node, Bun, and Deno, so the defaults
work on all three.

## Deprecation Notices

`.deprecated()` produces one notice per flag that actually sourced a value, in
resolution order. Each reaches `onDeprecation` as a `DeprecationWarning`:

```ts twoslash
import { flag, readFlags } from '@kjanat/dreamcli';
// ---cut---
await readFlags(
  { minify: flag.boolean().deprecated('use --optimize') },
  {
    argv: ['--minify'],
    env: {},
    onDeprecation: (warning) => {
      console.warn(`--${warning.name}: ${warning.message}`);
    },
  },
);
```

A command prints these on its warning stream. There is no output channel here,
so a call without `onDeprecation` drops them.

## Errors

Parse failures throw `ParseError`, resolution and constraint failures throw
`ValidationError`, and a record that collides on a name, an alias, or a negated
spelling throws `CLIError` before argv is read. Nothing is written anywhere and
`adapter.exit` is never called, so the script owns what happens next:

```ts twoslash
import { flag, isCLIError, readFlags } from '@kjanat/dreamcli';

try {
  const options = await readFlags({
    target: flag.enum(['node', 'browser']),
  });
  console.log(options.target);
} catch (error) {
  if (isCLIError(error)) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  throw error;
}
```

## Non-Goals

**No positional arguments.** A positional token throws
`UNEXPECTED_POSITIONAL`. This API covers flags.

**No config discovery.** Standalone flag reading has no application name and no
discovery policy to guess from, so `config` is whatever the caller passes.

**No root built-in flags.** `--help`, `--json`, and `--quiet` are neither
reserved nor answered, so a record may declare any of them as an ordinary flag.
Against a record that does not declare it, `--help` is an unknown flag.

**No synchronous variant.** Prompts, Standard Schema validators, and filesystem
checks are asynchronous. A synchronous variant would either carry different
semantics or reject part of the flag DSL, and either one means a second
implementation of what this reuses.

**No dispatch, actions, middleware, output, help, or completions.** Those belong
to a CLI. Reach for [`cli()`](/guide/commands) when the script grows into one.

## Related Pages

- [Flags](/guide/flags) for every flag kind and modifier
- [CLI Semantics](/guide/semantics) for the exact parser and precedence rules
- [Runtime Support](/guide/runtime) for what `createAdapter()` detects
- [Testing Commands](/guide/testing) for the testkit adapter
- [Stability Policy](/reference/stability) for the contract on `readFlags`,
  `ReadFlagsOptions`, and `FlagMap`
