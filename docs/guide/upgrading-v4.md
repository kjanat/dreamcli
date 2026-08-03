# Upgrading From 3.x To 4.0

This page covers moving an existing dreamcli 3.0 CLI to 4.0.0. Coming from 2.x,
read [Upgrading From 2.x To 3.0](/guide/upgrading-v3) first. For adopting
dreamcli from another framework, see
[Migration And Adoption](/guide/migration).

A CLI built entirely from the fluent builders (`cli()`, `command()`, `flag`,
`arg`) mostly runs on 4.0 unchanged. Two things changed on that path. A command
flag spelled like a root-owned flag is now rejected when you register the
command, and `.flag('__proto__')` or `.arg('__proto__')` now throws
`INVALID_SCHEMA`. The rest of the breaking changes land on code that assembles
schema objects by hand, hand-rolls an `Out`, reaches into `CLISchema.commands`,
or passes framework-populated fields into execution options. Every category and
its compatibility rules are listed on the
[Stability Policy](/reference/stability) page.

## Breaking Changes

### A command flag cannot spell a root-owned flag

The root owns `--json`, `--quiet` / `-q`, and `--help` / `-h`, and
`--version` / `-V` joins them once the CLI declares a version. It strips the
two output tokens from argv before dispatch, intercepts `--version` / `-V`, and
renders help before a command's flags are parsed. In 3.x a command could
declare one of those spellings anyway. It built, it ran, it showed up in help,
and its flag sat at the default value on every invocation:

```ts
// 3.x
const build = command('build')
  .flag('quiet', flag.boolean().describe('Suppress build logs'))
  .action(({ flags, out }) => {
    out.log(`quiet=${flags.quiet}`);
  });

await cli('mycli').command(build).run();

// $ mycli build --quiet
// quiet=false
```

4.0 rejects the registration with a `CLIError` carrying code `RESERVED_FLAG`:

```
Command 'build' defines a '--quiet' flag, which is reserved by the root
'--quiet' flag. The root strips that token before dispatch, so the command
can never receive it
```

The error's suggestion names the remedies, `Rename the flag, use out.status()
for output that root --quiet suppresses, or release the built-in with
.builtins({ quiet: 'off' }) before registering the command`.

Renaming and `out.status()` cover a command that never wanted the token:

```ts
// 4.0
const build = command('build').action(({ out }) => {
  out.status('Building'); // stderr, suppressed by root --quiet
  out.log('dist/app.js');
});
```

A command that really does own the token keeps its flag and takes the built-in
over instead. `--json` naming a document and `-q` meaning something
domain-specific are the usual cases:

```ts
// 4.0
cli('mycli')
  .builtins({ quiet: 'off' })
  .command(build);
```

`.builtins()` has to come first, since `.command()` checks against the state it
has. See [Taking a built-in over](/guide/output#taking-a-built-in-over) for
what `'off'` releases.

The check reads each flag's canonical name, every alias including hidden ones,
and a custom negated spelling from `.negatable({ alias: 'quiet' })`, through
the whole subcommand tree. `.command()`, `.default()`, `.version()`,
`.manifest(data)`, and `createCLISchema()` all run it, so a `version` flag
throws whether the command is registered before or after `.version()`. A
version that `.manifest()` reads off the filesystem arrives past every one of
those, so `.run()` runs the same guard again once discovery supplies it. The
startup fails with the identical error, reported like any other `.run()`
startup failure: message and suggestion on stderr, the serialized error on
stdout under `--json`, and the error's exit code. `--completions` is reserved
on the same terms once `.completions({ as: 'flag' })` or
`CLIDefinition.completionsFlag` is set.

Near misses stay legal: `quietMode` and `jsonOutput` as names, `-Q` and `-j` as
aliases, the default `--no-<name>` negated spelling, and a `version` flag on a
CLI that declares no version.

### `Out` gained a required `verbosity` member

An object literal typed as `Out` stops compiling until it declares `verbosity`.
Handlers read `out.verbosity` for the active level, and
`resolveRenderContext()` exposes the same decision for content built before
`.run()`, including `--`-aware `--quiet` / `-q` detection.

Hand-rolled test doubles are the common casualty. Take a real channel from the
testkit and spy on it:

```ts
import { createCaptureOutput } from '@kjanat/dreamcli/testkit';

const [out] = createCaptureOutput();
vi.spyOn(out, 'info');
```

Do not spread a channel. Its methods are installed as non-enumerable bound own
properties, so `{ ...out, info: vi.fn() }` carries none of them.

### `Out` and `RenderContext` are sealed

Both interfaces carry a private brand, so implementing or structurally
constructing them outside the framework no longer type-checks. Obtain instances
from action parameters, `createOutput()`, `createCaptureOutput()`, or
`resolveRenderContext()`.

Helpers that only need part of the channel take a capability type:

```ts twoslash
import type { Out } from '@kjanat/dreamcli';
// ---cut---
function renderRows(out: Pick<Out, 'info' | 'status'>, rows: readonly string[]) {
  for (const row of rows) out.info(row);
}
```

Both are non-exhaustive values, so minor releases may add readonly members.
Exhaustive mappings over their keys (`Record<keyof Out, unknown>`) will break on
a minor.

### Schemas are sealed and built by factories

`FlagSchema`, `ArgSchema`, `CommandSchema`, `CLISchema`, and `ConfigSettings`
carry the same type-only brand. An object literal assembled by hand is no longer
assignable where a schema is expected. Four factories build them:
`createFlagSchema()`, `createArgSchema()`, `createCommandSchema()`, and
`createCLISchema()`. Each takes a plain definition object listing only the
fields you care about, and fills in the rest:

```ts
// 3.x
const schema: CommandSchema = {
  name: 'deploy',
  description: undefined,
  flags: { force: createSchema('boolean') },
  args: [],
  commands: [],
  hidden: false,
  // ...every remaining field
};

// 4.0
const schema = createCommandSchema({
  name: 'deploy',
  flags: { force: { kind: 'boolean' } },
});
```

The brand has no runtime value, so nothing about the objects themselves changed.
Spreading a built schema keeps the brand (`{ ...schema, hidden: true }` stays
assignable), `structuredClone()` and JSON round-trips are unaffected, and
feeding a built schema back through its factory returns a deep-equal schema.

Nested fields accept either rung, so a code generator can hand
`createCommandSchema()` or `createCLISchema()` one complete tree of plain
objects:

```ts twoslash
import { createCLISchema } from '@kjanat/dreamcli';
// ---cut---
const schema = createCLISchema({
  name: 'mycli',
  version: '1.0.0',
  commands: [
    {
      name: 'deploy',
      flags: { region: { kind: 'enum', enumValues: ['us', 'eu', 'ap'] } },
      args: [{ name: 'target', schema: { kind: 'string' } }],
    },
  ],
});
```

The definition types are exported from the package root: `FlagDefinition`,
`ArgDefinition`, `CommandDefinition`, `CLIDefinition`,
`ConfigSettingsDefinition`, the per-kind members (`EnumFlagDefinition`,
`ArrayFlagDefinition`, and the rest), and the `*DefinitionOverrides` helpers.

### `createSchema()` is now `createFlagSchema()`

The positional form is a rename. Both factories additionally accept a single
definition object, and both validate fields against the kind:

```ts twoslash
import { createFlagSchema } from '@kjanat/dreamcli';
// ---cut---
const region = createFlagSchema('enum', { enumValues: ['us', 'eu', 'ap'] });

const tags = createFlagSchema({
  kind: 'array',
  elementSchema: { kind: 'string' },
  separator: ',',
});
```

A field belonging to another kind, such as `enumValues` on a `boolean` flag,
fails to compile and throws `INVALID_SCHEMA` at runtime.

`createArgSchema()` picked up the same rule: its second parameter changed from
`Partial<ArgSchema>` to `ArgDefinitionOverrides<K>`, and `enumValues` is
required on an `enum` arg.

### `createCommandSchema()` validates what the builder validates

A definition whose flags share a name, an alias, or a negated spelling on one
command throws `FLAG_NAME_COLLISION`, and a flag spelled the same way as one
propagated from an ancestor command throws `PROPAGATED_FLAG_COLLISION`.

```ts
// 3.x: built fine; help listed -v on both flags and -v set only --version
createCommandSchema({
  name: 'run',
  flags: {
    verbose: { kind: 'boolean', aliases: ['v'] },
    version: { kind: 'boolean', aliases: ['v'] },
  },
});

// 4.0: throws FLAG_NAME_COLLISION
```

In 3.x both flags still parsed under their canonical names, so what the
collision cost was the shared spelling. Help advertised `-v` on both flags and
the parser answered it with `--version`.

The arg invariants moved with them. A second stdin-backed input on the same
command throws `DUPLICATE_STDIN_INPUT`, and a positional declared after a
variadic one throws `INVALID_BUILDER_STATE`, on both construction paths. In 3.x
a hand-assembled `CommandSchema` could declare either, and two stdin-backed args
each resolved to the whole of stdin while a positional behind a variadic one
silently never filled. The placement rule is new to `.arg()` as well, and
[its own section](#a-positional-after-a-variadic-one-is-a-build-error) covers
what to change.

A flag or arg named `__proto__` throws `INVALID_SCHEMA`. Both land in a record
keyed by name, where that key sets a prototype rather than an entry, so the flag
or the value the user typed used to disappear.

```ts
// 3.x: built fine, then the positional value never reached the handler
createCommandSchema({
  name: 'run',
  args: [{ name: '__proto__', schema: { kind: 'string' } }],
});

// 4.0: throws INVALID_SCHEMA
```

A `flags` record whose prototype is replaced throws `INVALID_SCHEMA` as well.
Only its own keys are read, so an object-literal `__proto__` key and a record
built with `Object.create(base)` both hide a flag the caller meant to declare,
and 3.x built the command without either one:

```ts
// 3.x: built fine, then --shared was an unknown flag
createCommandSchema({
  name: 'run',
  flags: Object.create({ shared: { kind: 'boolean' } }),
});

// 4.0: throws INVALID_SCHEMA
```

`Object.create(null)` stays legal. Its prototype carries nothing, so a flag put
on such a record is an own key and is read.

The whole tree is checked, nested subcommands included, and `createCLISchema()`
inherits the checks through it. `command()` already refused the collisions at
`.flag()` and `.command()`, and refused a second stdin-backed arg at `.arg()`
under the old code `DUPLICATE_STDIN_ARG`. For those, only definitions composed
as data change: one that used to build and then misbehave at parse time now
fails at construction. Argument placement is the exception, since `.arg()`
accepted a positional after a variadic one in 3.x.

`__proto__` changes on the builder too. `.arg('__proto__')` used to build and
then swallow the positional value; it now throws `INVALID_SCHEMA`.
`.flag('__proto__')` already threw, with code `FLAG_NAME_COLLISION` naming a flag
the command never declared, and now throws `INVALID_SCHEMA` like the factory.

Names such as `constructor`, `toString`, and `valueOf` are unaffected and always
were legal as data. `.flag()` used to reject them as duplicates of a flag the
command never declared; it now accepts them, so a schema `command()` produces
and a schema `createCommandSchema()` produces agree on every name.

### `CommandSchema.middleware` is removed

The executor builds the handler chain from the builder's ordered execution
steps, so registration order, handler identity, and runtime behavior are
unchanged. `.middleware()` on `CommandBuilder` works exactly as before.

Code that read `schema.middleware` has no replacement field. Assert on behavior
instead, by running the command and checking what the middleware did.
`CommandDefinition` has no `middleware` key and `createCommandSchema()` emits
none.

### `CLISchema` describes the program without the execution graph

`CLISchema.commands` and `CLISchema.defaultCommand` used to hold `ErasedCommand`
wrappers carrying the action handler and an `_execute` function. Both now hold
`CommandSchema`, and the compiled execution graph lives beside the schema:

```ts
// 3.x
app.schema.commands[0].schema.name;
// 4.0
app.schema.commands[0].name;
```

`ErasedCommand` is gone. `CLISchema.plugins` is gone as well, since plugins are
execution state; `.plugin()` registration, order, and hook behavior are
unchanged.

### `CLIBuilder` is factory-only

`CLIBuilder`'s constructor is private, so `new CLIBuilder(schema)` no longer
compiles. Call `cli(name)` or `cli({ ... })` for an executable program, and
`createCLISchema()` when you want a description with no handlers attached. Every
builder method still returns a new builder.

`createCLISchema()` throws `INVALID_SCHEMA` on an empty name, and `cli('')`
does the same instead of building a nameless program.

### `.execute()` and `.run()` take different option types

`.execute()` takes the new `CLIExecuteOptions`, which carries the process-free
option surface and has no `adapter` member. `CLIRunOptions` extends it with
`adapter`, and `.run()` is the only method that accepts one.

```ts
// 3.x
await app.execute(argv, { adapter, env });
// 4.0
await app.execute(argv, { env });
await app.run({ adapter });
```

### Internal execution fields left `RunOptions`

`out`, `captured`, `mergedSchema`, `meta`, and `plugins` were framework-populated
fields marked `@internal` that shipped on the public option types. They now live
on unexported internal execution options, so passing them to `runCommand()`,
`.execute()`, or `.run()` stops compiling.

`runCommand()` captures stdout, stderr, and activity events itself and returns
them on `RunResult`, so tests assert on the result rather than on an injected
channel:

```ts
const result = await runCommand(deploy, ['production']);

expect(result.stdout).toEqual(['Deploying production\n']);
expect(result.activity).toEqual([{ type: 'spinner:start', text: 'Deploying' }]);
```

Code that genuinely needs its own writers builds a channel with
`createOutput({ stdout, stderr })` and drives it directly. `OutputOptions.stdout`
and `OutputOptions.stderr` are the supported injection seam.

### The 2.5-era manifest API is removed

Deprecated since 2.5, removed here. Every removal has a direct replacement:

| Removed                                  | Replacement                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `.packageJson(settings)`                 | `.manifest(settings)`, which defaults to `files: ['package.json']`          |
| `.packageJson(data)`                     | `.manifest(data)`, taking the same pre-loaded data object                   |
| `.denoJson(settings)`                    | `.manifest({ files: ['deno.json', 'deno.jsonc', 'jsr.json'], ...settings })` |
| `ManifestPresetSettings`                 | `ManifestSettings`, which adds `files`                                     |
| `PackageJsonSettings`                    | `ResolvedManifestSettings`                                                 |
| `discoverPackageJson(adapter, startDir)` | `discoverManifest(adapter, { startDir, files: ['package.json'] })`         |

```ts
// 3.x
cli('mycli').denoJson({ inferName: true });
// 4.0
cli('mycli').manifest({
  files: ['deno.json', 'deno.jsonc', 'jsr.json'],
  inferName: true,
});
```

`files` already defaults to `['package.json']` on both `.manifest()` and
`discoverManifest()`, so the `package.json` migrations are a rename. The
`CLISchema.packageJsonSettings` field keeps its name and shape. See
[`.manifest()`](/reference/main) for the full settings surface.

### `CommandConfig` and the root `AnyCommandBuilder` export are removed

`CommandConfig` described the builder's type-level accumulator shape and no
signature referenced it. `AnyCommandBuilder` is erasure machinery that appears
only on `CommandBuilder`'s underscore members, so the package root no longer
exports the name. Neither has a replacement; code naming them was reaching into
internals.

### Definition documents are versioned

`generateSchema()` and `generateCommandSchema()` emit `schemaVersion: 1`, so a
consumer can tell which format it is reading before parsing the rest. Both
return typed documents (`DefinitionDocumentV1` and
`CommandDefinitionDocumentV1`, aliased as `DefinitionDocument` and
`CommandDefinitionDocument`) in place of `Record<string, unknown>`. The returned
documents stay assignable to `Record<string, unknown>`, so existing consumer
signatures keep compiling.

Fragments nested inside a document (`CommandDefinitionFragmentV1`,
`FlagDefinitionFragmentV1`, `ArgDefinitionFragmentV1`, and the rest) carry no
`schemaVersion` of their own and take the version of the document they sit in.
`generateInputSchema()` is standard JSON Schema and stays outside the family,
typed as `InputSchemaDocument`.

The canonical `$schema` and `$id` moved to
`https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json`, replacing
`https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/dreamcli.schema.json`. The `v1`
segment tracks the definition format, so it stays valid for every package
release that emits `schemaVersion: 1`. The `@kjanat/dreamcli/schema` subpath and
the jsDelivr URL keep serving the same bytes as mirrors. Documents pinned to the
old URL still validate against a local copy, but they no longer match the
meta-schema's `$schema` constant. For offline validation, map the canonical URL
to the local copy in your tooling; [Schema Export](/guide/schema-export) shows
the VS Code form.

`--help --json` output changed accordingly. Command-level help serializes
through `generateCommandSchema()`, so `schemaVersion` is now its first key. Root
help serializes through `generateSchema()`, so `$schema` still leads, carries
the new URL, and `schemaVersion` follows it. Snapshot tests over that output
need re-recording.

### `ArgSchema.stdinMode` is now `ArgSchema.stdin`

The boolean carried no room for the trigger and sharing modes the unified source
model needs, so it is replaced by `stdin: StdinBinding | undefined`. `.stdin()`
is unchanged for callers who pass no options, and keeps its exact resolution
behavior.

```ts
// 3.x — reading a built schema
if (schema.stdinMode) { /* … */ }

// 4.0
if (schema.stdin !== undefined) { /* … */ }
```

```ts
// 3.x — a definition passed to createArgSchema() or createCommandSchema()
createArgSchema('string', { stdinMode: true });

// 4.0
createArgSchema('string', { stdin: {} });
createArgSchema('string', { stdin: { when: 'dash', consume: 'broadcast' } });
```

The definition document changes to match. An arg fragment emits
`stdin: { when, consume, trim }` where `stdinMode: true` used to appear, at
`schemaVersion: 1`, which has not shipped. All three fields are always written,
so a reader never has to know the builder's defaults. Tooling reading the
fragment reads the object; tooling that only asked whether stdin was enabled
checks for the key's presence.

### `DUPLICATE_STDIN_ARG` is now `DUPLICATE_STDIN_INPUT`

The one-exclusive-consumer rule now covers flags as well as args, so the code
names an input rather than an argument. Error handling matching the old code
matches the new one; the message reads `Only one input may consume stdin
exclusively; <name> already consumes stdin`, naming the input that was declared
first. `details` names the offending input under `flag` or `arg` and the
existing one under `existingFlag` or `existingArg`.

### An explicit `-` with nothing piped fails inside a collection

A `-` the user typed beside other occurrences used to be dropped when nothing
was piped, so `--tag a --tag - --tag b` with an empty pipe resolved to
`['a', 'b']` and the caller never learned the pipe had been empty. It now fails:

```
No piped stdin for the '-' occurrence of flag --tag
Suggestion: Pipe a value to stdin, or drop the '-' occurrence of --tag
```

The code is `MISSING_STDIN` on both surfaces, and the positional tail words it
`for the '-' occurrence of argument <files>`. `details` carries `flag` or `arg`
plus `source: 'stdin'`. Code matching `REQUIRED_FLAG` or `REQUIRED_ARG` to catch
this case matches the dedicated code instead; those two keep their own meaning,
a required input no source filled.

Two shapes are unchanged. Occurrences of nothing but `-` are the whole value, so
with nothing piped they still fall through to env, config, prompt, and the
default. So does a scalar `-`, since dropping it loses nothing. Only a
collection could be silently shortened, so only a collection errors.

A script that relied on the old drop has two ways forward: pipe a value, or stop
passing `-` when there is nothing to read. A `{ when: 'missing' }` binding never
enters this path, since it leaves a typed `-` literal.

### `.stdin()` and `.variadic()` compose

The pairing threw `INVALID_BUILDER_STATE` with the message `Argument <files>
cannot be both variadic and stdin-backed`. It is now legal, and a `-` among the
tail tokens splices what the buffer decodes to into that position:

```ts
command('build').arg('files', arg.string().variadic().stdin());
```

```bash
$ printf 'x\ny\n' | mycli build a - b
# args.files === ['a', 'x', 'y', 'b']

$ printf 'x\ny\n' | mycli build
# args.files === ['x', 'y']
```

An empty tail counts as an absent input, so a binding that covers a missing one
takes the whole buffer. Code that caught the throw has nothing left to catch;
delete the `try`. Nothing that built in 3.x resolves differently, since the
pairing could not be built.

### Stdin values reach non-string codecs without their trailing terminator

The stdin source hands the whole buffer over byte for byte, so a `string` input
still receives `'hi\n'` from `echo hi | mycli`. Every other codec interprets the
text, where a terminator a pipe appended is framing rather than value, so one
trailing `\n`, `\r\n`, or `\r` is dropped before decoding.

That makes three cases work which used to fail: `echo true | mycli` resolves a
boolean input to `true`, `echo 1h30m` reaches `arg.duration()`, and `echo eu`
reaches an enum input. A number input is unaffected, since `Number()` already
ignored the terminator. Code that piped a value with a terminator to a custom
parse function now sees it trimmed; pipe through a `string` input and split it
yourself where the terminator was load-bearing.

Stdin also stops borrowing the prompt widening table. It accepts exactly what an
env value accepts, so the prompt-only `y` and `n` boolean spellings are
rejected; write `true` / `false`, `1` / `0`, or `yes` / `no`.

### Declared defaults are validated

A `.default()` value is the typed value, so it is validated rather than decoded.
String and number constraints, element and aggregate Standard Schema validators,
the shape the cardinality requires, and the collection rules all apply to it.
Purely synchronous violations throw `INVALID_DEFAULT` where the chain declares
them:

```ts
flag.string({ minLength: 3 }).default('ab'); // throws INVALID_DEFAULT
flag.number().default(Number.POSITIVE_INFINITY); // throws INVALID_DEFAULT
arg.string().default('ab').minLength(3); // throws, whichever order you write
```

Fix the default, or widen the declaration where the value was intended:
`flag.number({ finite: false }).default(Number.POSITIVE_INFINITY)` still holds.
Asynchronous validators and `flag.path()` filesystem checks stay at resolution
time, where defaults already went through them.

Building a schema from a definition object skips the compiler, so the same pass
also checks the value against the codec itself:

```ts
createFlagSchema({ kind: 'enum', enumValues: ['us', 'eu'], defaultValue: 'ap' });
// throws INVALID_DEFAULT: expected one of: us, eu
```

### `.default()` on a variadic arg takes the array

The type parameter followed the element type, so the only value that compiled
was a single element. It now follows what the arg resolves to:

```ts
// 3.x: compiled, then resolved to the bare string
arg.string().variadic().default('a');

// 4.0: the array the arg produces
arg.string().variadic().default(['a', 'b']);
```

### A positional after a variadic one is a build error

A variadic argument takes every remaining positional token, so anything
registered behind it could never be filled and a second variadic one had nothing
left to collect. Both used to build and then produce an argument that stayed
empty. `.arg()` and `createCommandSchema()` now share one check:

```ts
// 3.x: built fine, then <target> never filled
command('copy').arg('files', arg.string().variadic()).arg('target', arg.string());

// 4.0: throws INVALID_BUILDER_STATE
```

```
Argument <target> comes after variadic argument <files>, which consumes every remaining positional
Suggestion: Declare <target> before <files>, or drop .variadic() from <files>
```

`details` carries the command in `command`, the argument that could never fill
in `arg`, and the greedy one in `variadicArg`, so a definition tree names the
nested command that declared the pair.

Move the variadic argument last. Required, optional, and variadic in that order
still builds, as does a scalar followed by an `arg.keyValue().variadic()` tail.
A command that genuinely needs a trailing value after a list has to take it as a
flag instead, since positional order alone cannot express it.

### The arg collection modifiers require a collection

`.unique()`, `.separator()`, `.split()`, and `.duplicateKeys()` state the shape
they need. `.separator()` and `.split()` want a variadic argument or
`arg.keyValue()`, `.unique()` a variadic argument of a list kind, and
`.duplicateKeys()` `arg.keyValue()`. The compiler refuses each one elsewhere,
and `createArgSchema()` throws `INVALID_SCHEMA`:

```ts
// 3.x: built fine, and the field was stored and never read
createArgSchema('string', { unique: true });
createArgSchema('string', { separator: ',' });

// 4.0: throws INVALID_SCHEMA
```

```
Arg schema field 'unique' requires a variadic arg of a list kind
Suggestion: Add 'variadic: true' on a list kind, or drop 'unique'
```

Add `variadic: true`, declare the argument as `keyValue`, or drop the field,
which changed nothing on a single-value argument anyway. The values a schema
already stores as its own default, `unique: false` and `duplicateKeys: 'last'`,
stay accepted on any kind, so feeding a built `ArgSchema` back through
`createArgSchema()` round-trips. That exemption is why `.duplicateKeys('last')`
on a scalar builder is a compile-time error rather than a runtime one: at run
time the call is indistinguishable from a round-tripped default. The same holds
for `createFlagSchema()` and `.unique(false)`.

The four builder methods are new in 4.0, so only definitions composed as data
change. This mirrors the `array | keyValue` restriction the flag surface already
had.

### `.separator()` sets the CLI delimiter alone

Env and config string values used to inherit the CLI separator, so
`.separator('|')` silently changed how an env var decoded. Each source now
carries its own policy: env values split on `','`, and the stdin buffer splits on
line terminators.

```ts
// 3.x: one delimiter everywhere
flag.array(flag.string()).separator('|').env('REGIONS');

// 4.0: name each source you meant
flag.array(flag.string()).split({ cli: '|', env: '|' }).env('REGIONS');
```

Code that only ever passed CLI tokens needs no change.

### Flag diagnostics redact values from every non-argv source

A flag whose stdin, environment, config, or prompt value failed to coerce used to
print that value and carry it in `details.value`. The argument surface already
redacted it. Both surfaces now redact:

```
# 3.x
Invalid value 'sk-live-9f2' from env API_TOKEN for flag --token: must match /^ghp_/

# 4.0
Invalid value '<redacted>' from env API_TOKEN for flag --token: must match /^ghp_/
```

Every message this affects says `'<redacted>'` where the value was, and
`details` no longer carries a `value` key. What identifies the failure stays:
the flag name, the source (`source`, plus `envVar` or `configPath`), the
expected type, the constraint that failed with its bound or pattern, and the
allowed enum values. A custom parse function's own error message is still shown,
since your code wrote it, so write those messages to describe the expectation
rather than to interpolate the value.

Argv is unaffected. A token the user typed is already on their screen, so parse
errors keep quoting it.

Two adjustments. Tests asserting a value inside a resolution error message
assert `'<redacted>'` instead. Code reading `error.details.value` reads the
value from its own source, since the framework no longer copies it into a
diagnostic. A related detail: every coercion failure now carries
`source: 'env' | 'config' | 'stdin' | 'prompt'`, which is what the aggregate
error uses to label an issue `[env API_TOKEN]`.

### `FlagSchema` and `ArgSchema` carry the cardinality axis

`FlagSchema` gains `split`, `duplicateKeys`, and `aggregateStandard`, and
`ArgSchema` gains `separator`, `split`, `duplicateKeys`, `unique`, and
`aggregateStandard`. Code that spells out a whole schema literal adds them;
`createFlagSchema()` and `createArgSchema()` fill them in. `elementSchema` and
`separator` are valid on `keyValue` as well as `array` flags, `standard` is valid
on every kind, `aggregateStandard` only on a kind that aggregates, and `stdin` is
valid on the collection kinds.

## Behavioral Changes To Review

- **Root `--json` and `--quiet` take an explicit value.** `--json=true`,
  `--json=1`, `--json=false`, and `--json=0` set the mode where 3.x failed with
  `Unknown flag`, and `--quiet` accepts the same literals. The last occurrence
  wins, and an invalid literal exits 2 with the parser's `INVALID_VALUE` error.
  Short `-q` stays presence-only. See
  [Output](/guide/output#status-lines-and-quiet-mode).
- **Quiet mode suppresses rendered spinner and progress output.** Activity
  handles resolve to no-ops under quiet verbosity, including on interactive
  TTYs and for explicit static fallbacks. Capture still records lifecycle
  events, so `RunResult.activity` assertions are unaffected. Informational rows
  routed through `out.info()` are suppressed as before.

## New In 4.0

Adopt at your own pace; none of these are required:

- **Stability policy**: [a reference page](/reference/stability) classifying
  every exported type and the rules each category carries into minor releases.
- **Descriptions without an execution graph**: `createCLISchema()` and
  `createCommandSchema()` build a normalized schema tree from plain objects, for
  code generators, docs tooling, and fixtures that never execute.
- **Kind-checked definitions**: the `*Definition` types make illegal field
  combinations unrepresentable, with the same check enforced at runtime for
  JavaScript callers.
- **Verbosity in handler code**: `out.verbosity` and
  `resolveRenderContext().verbosity` expose the active level for custom
  rendering built inside or before a run.
- **One source model for both surfaces**: `arg.config()` and `arg.prompt()` join
  `arg.env()`, `flag.string().stdin()` becomes legal, and every input resolves
  through `CLI -> stdin -> env -> config -> prompt -> default`. See
  [Arguments](/guide/arguments#stdin-backed-arguments).
- **Cardinality as its own axis**: `.split({ cli, env, stdin })` gives each source
  its own decoding, `.duplicateKeys()` decides what a repeated key means,
  collections read stdin with `-` splicing into occurrence order, and
  `arg.boolean()` and `arg.keyValue()` join the arg factories. See
  [Flags](/guide/flags) and [Arguments](/guide/arguments).
- **Trimming a piped value**: `.stdin({ trim: true })` drops one trailing `\n`,
  `\r\n`, or `\r` from a single value, so `echo ./dist | mycli clean` satisfies
  `arg.path({ mustExist: true })`. It defaults to `false`, which is what 3.x
  did, so an existing binding is unaffected. See
  [Flags](/guide/flags#stdin-backed-flags) and
  [Arguments](/guide/arguments#stdin-backed-arguments).
- **Where each value came from**: handlers receive `sources` beside `flags` and
  `args`, carrying the stage that produced each value, and `wasExplicit()`
  answers explicit-versus-defaulted without dropping `.default()`. `resolve()`
  exposes the same records on `ResolveResult.provenance`, and `readFlags()`
  through its `onSources` receiver. See
  [Which source won](/guide/semantics#which-source-won).
- **Typed entry values on both surfaces**: `arg.keyValue(arg.number())` mirrors
  `flag.keyValue(flag.number())`, so `mycli scale web=3` resolves to
  `{ web: 3 }` with the element's constraints, path checks, and validators
  applied to every entry. See [Arguments](/guide/arguments).
- **Stdin in help**: an input that declares `.stdin()` renders `[stdin]` beside
  `[env: X]` and `[config: y]`, or `[stdin: '-']` and `[stdin: when omitted]`
  for the narrower triggers. See [Help](/guide/help).
- **Consumer-owned built-in flags**: `.builtins({ help | json | quiet: 'off' })`
  hands a root-owned token to the commands, for a CLI whose `--json`, `-q`, or
  `--help` means something of its own. See
  [Taking a built-in over](/guide/output#taking-a-built-in-over).

See the [CHANGELOG](https://github.com/kjanat/dreamcli/blob/master/CHANGELOG.md)
for the complete record.
