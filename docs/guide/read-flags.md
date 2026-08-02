# Standalone Flag Evaluation

`readFlags()` takes a record of flag builders, evaluates it, and returns the
resolved values. There is no command and no dispatch. The call returns typed
values or throws, with one exception: `--help` prints generated help and exits,
unless the record claims the spelling or the built-in is turned off.

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

## Built-In Help

A `--help` or `-h` before the `--` separator prints generated help for the
record to the adapter's stdout and exits with code 0:

```bash
$ bun build.ts --help
Usage: build.ts [flags]

Flags:
  -w, --watch    Rebuild on change
      --minify   (default: true)
```

The usage line names the script from the adapter's argv. Help renders ahead of
parsing, so a malformed value elsewhere in argv never hides the text explaining
the flags.

The built-in yields in two ways. Declaring a flag that answers to `help` or `h`
through its name, an alias, a negated spelling, or a case-parity counterpart
takes both spellings over, and they parse as that flag's own. Passing
`help: 'off'` removes the built-in, and an undeclared `--help` is an unknown
flag again.

## Non-Strict Parsing

`strict: false` drops undeclared argv content instead of rejecting it, so a
script can read its own flags out of an argv it shares with another consumer:

```ts twoslash
import { flag, readFlags } from '@kjanat/dreamcli';
// ---cut---
const values = await readFlags(
  { watch: flag.boolean() },
  { argv: ['build', '--watch', '--unknown'], env: {}, strict: false },
);

values.watch; // true
```

Dropped are unknown long flags together with their inline `=value`, unknown
characters inside a short group, positional arguments, and the `--` separator,
which can only introduce positionals here. The filter walks the parser's own
value consumption, so `--name booga` keeps `booga` as the value of a declared
`--name` while the token after an unknown flag is dropped as a positional.

Leniency covers undeclared input only. Misuse of a declared flag throws in
either mode: a missing value, a failed coercion, a violated constraint, and a
repeat under `.duplicates('error')` all keep their diagnostics.

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

Parse failures throw `ParseError` and resolution and constraint failures throw
`ValidationError`. Two kinds of definitions record throw `CLIError` before argv
is read. A record that collides on a name, an alias, or a negated spelling
throws `FLAG_NAME_COLLISION`. A record whose keys cannot all be read throws
`INVALID_SCHEMA`: the definition key `__proto__`, or a replaced prototype, which
covers an object-literal `__proto__` key and `Object.create(base)`.
`Object.create(null)` is fine. Failure never writes output and never calls
`adapter.exit`; only the built-in help path exits, and it exits with 0. The
script owns what happens next:

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

**No output built-ins.** `--json` and `--quiet` are neither reserved nor
answered, so a record may declare either as an ordinary flag. `help` and `h`
are answered by the built-in help, and declaring either spelling takes them
over without a reservation error.

**No synchronous variant.** Prompts, Standard Schema validators, and filesystem
checks are asynchronous. A synchronous variant would either carry different
semantics or reject part of the flag DSL, and either one means a second
implementation of what this reuses.

**No dispatch, actions, middleware, output channel, or completions.** Those
belong to a CLI. Reach for [`cli()`](/guide/commands) when the script grows into
one.

## Related Pages

- [Flags](/guide/flags) for every flag kind and modifier
- [CLI Semantics](/guide/semantics) for the exact parser and precedence rules
- [Runtime Support](/guide/runtime) for what `createAdapter()` detects
- [Testing Commands](/guide/testing) for the testkit adapter
- [Stability Policy](/reference/stability) for the contract on `readFlags`,
  `ReadFlagsOptions`, and `FlagMap`
