# Output

Handlers receive `out` instead of `console`.
The output channel adapts to context automatically.

## Basic Output

```ts twoslash
import { command } from '@kjanat/dreamcli';

command('deploy').action(({ out }) => {
  out.log('Informational message');
  out.warn('Warning message');
  out.error('Error message');
});
```

## JSON Output

```ts twoslash
import { createOutput } from '@kjanat/dreamcli';

const out = createOutput();
out.json({ status: 'ok', count: 42 });
```

When the CLI is invoked with `--json`, structured payloads stay on stdout while
plain text (`log`, `info`, `warn`, `error`) routes to stderr.

`--json` also takes an explicit value like any boolean flag: `--json=true`,
`--json=1`, `--json=false`, and `--json=0`. The last occurrence wins, so a
wrapper script can append `--json=false` to turn a default off, and an invalid
value fails with exit code 2.

## Exit Codes Without Error Output

Use `out.setExitCode(code)` when a command should emit normal output but still
return a non-zero status to scripts.

```ts twoslash
import { command } from '@kjanat/dreamcli';

command('status').action(({ out }) => {
  out.json({ status: 'degraded' });
  out.setExitCode(7);
});
```

`setExitCode()` does not print anything and does not stop execution. Later calls
win, and thrown `CLIError`s still use their own exit codes and error rendering.

## Status Lines and Quiet Mode

`out.status()` prints success and progress notes like `Wrote <path>` to
**stderr**, so stdout stays clean for piping, and it is suppressed under quiet
verbosity:

```ts twoslash
import { command } from '@kjanat/dreamcli';

command('gen').action(({ out }) => {
  out.log('dist/app.js');           // the result, on stdout (stderr in --json)
  out.status('Wrote dist/app.js');  // the note, on stderr, silenced by -q
});
```

Every CLI accepts a global `--quiet`/`-q` flag that sets quiet verbosity,
suppressing `info`, `status`, spinners, and progress bars while `log`, `warn`,
and `error` still emit.
Like `--json`, it is a root-level flag: it is stripped before dispatch (so
command schemas never see it) and only counts before the `--` separator; a
literal `-q` after `--` reaches the command as a positional.

The long spelling takes an explicit value the same way: `--quiet=true`,
`--quiet=1`, `--quiet=false`, and `--quiet=0`, with the last occurrence winning
and an invalid value failing with exit code 2. The short `-q` is presence-only,
as short boolean flags are everywhere else.

`--help` and `--version` render ahead of that error, so a mistyped value never
hides the text that documents the flag.

The root owns those tokens: it strips `--json` and `--quiet`/`-q` from argv,
intercepts `--version`/`-V` once the CLI declares a version, and renders help
for `--help`/`-h` before a command's flags are parsed. A command flag spelled
the same way could never be set, so declaring one throws `RESERVED_FLAG`.
Naming a flag `quiet`, `json`, or `help`, aliasing one to `q` or `h`, or giving
one a negated spelling like `.negatable({ alias: 'quiet' })` is rejected by
`.command()`, `.default()`, and `createCLISchema()`, and `version`/`V` join
that set once a version is configured. Because a version can arrive after the
commands are registered, `.version()` and `.manifest(data)` re-check every
registered command too. A version that `.manifest()` reads off the filesystem
lands later still, so `.run()` runs the guard once discovery supplies it and
fails startup with the same error and the same exit code, routed the way every
other startup failure is: message and suggestion on stderr, or the serialized
error on stdout under `--json`. Rename the flag, reach for `out.status()` when
you wanted output that root `--quiet` suppresses, or release the built-in with
`.builtins()`.

| Method   | Stream                      | Suppressed by quiet |
| -------- | --------------------------- | ------------------- |
| `log`    | stdout (stderr in `--json`) | no                  |
| `info`   | stdout (stderr in `--json`) | yes                 |
| `status` | stderr                     | yes                 |
| `warn`   | stderr                     | no                  |
| `error`  | stderr                     | no                  |

### Taking a built-in over

Some CLIs need the token for themselves. `--json` names the document the
command operates on, `-q` means something domain-specific, `--help` is a
routable topic browser. `.builtins()` releases a built-in to the commands.

```ts twoslash
import { cli, command, flag } from '@kjanat/dreamcli';

const validate = command('validate')
  .flag('json', flag.string().describe('Document to validate'))
  .action(({ flags, out }) => {
    out.log(`Validating ${flags.json}`);
  });

cli('schematool')
  .builtins({ json: 'off' })
  .command(validate);
```

```sh
$ schematool validate --json schema.yaml
Validating schema.yaml
$ schematool validate --json=schema.yaml
Validating schema.yaml
```

Every built-in starts `'on'`. Setting one to `'off'` releases every spelling it
answers to. The root stops reading and stripping the token, `Global options:`
stops listing it, the `RESERVED_FLAG` guard stops reserving it, and the
command's own flag parses and reaches the handler. `quiet: 'off'` releases both
`--quiet` and `-q`. `help: 'off'` releases `--help` and `-h` at the root and at
the command level, along with the bare `help` token, the `--help` footer hint,
the `Run '<bin> --help' for available commands` suggestion on dispatch errors,
and the synthetic `--help` in generated completion scripts. A bare invocation
is unaffected, so `schematool` with no arguments still renders root help when
the CLI has no default command.

Call `.builtins()` before registering the commands that declare a released
flag. `.command()` checks against the state it has, so the reverse order throws
`RESERVED_FLAG`:

```
Command 'validate' defines a '--json' flag, which is reserved by the root
'--json' flag. The root strips that token before dispatch, so the command can
never receive it
```

Its suggestion names both remedies, `Rename the flag, or release the built-in
with .builtins({ json: 'off' }) before registering the command`. The `quiet`
variant adds `use out.status() for output that root --quiet suppresses`.

Repeated calls merge, the last mode per built-in winning, and taking a built-in
back with `'on'` re-checks every registered command.

`version` and `completions` have no entry. `.version()` and `.completions()`
are opt-in, so a CLI declines those two by not calling them.

Only argv-driven activation is disabled. `RunOptions.jsonMode` and
`RunOptions.verbosity` keep working, so `.execute(argv, { jsonMode: true })`
still renders JSON with `json: 'off'`. In tests, pass the same setting to
`runCommand()` so the harness mirrors the CLI the command is registered on:

```ts twoslash
import { command, flag } from '@kjanat/dreamcli';

const validate = command('validate')
  .flag('json', flag.string())
  .action(({ flags, out }) => {
    out.log(`Validating ${flags.json}`);
  });
// ---cut---
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(validate, ['--json', 'schema.yaml'], {
  builtins: { json: 'off' },
});
```

## Tables

```ts twoslash
import { createOutput } from '@kjanat/dreamcli';

type Row = { name: string; status: string; uptime: number };
const rows = [
  { name: 'web-1', status: 'running', uptime: 72 },
  { name: 'worker-1', status: 'degraded', uptime: 18 },
];

const out = createOutput();
out.table<Row>(rows, [
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
  { key: 'uptime', header: 'Uptime (h)' },
]);
```

::: tip Use a `type` alias (not `interface`) for table rows.
TypeScript's structural typing requires `Record<string, unknown>` compatibility.
:::

## Spinners

```ts twoslash
import { createOutput } from '@kjanat/dreamcli';

const deploy = async () => {};

const out = createOutput();
const spinner = out.spinner('Deploying...');
await deploy();
spinner.succeed('Done');
```

Spinners auto-disable when stdout is not a TTY (CI, piped output).
In quiet and `--json` modes, spinners are suppressed entirely.

## Progress Bars

```ts twoslash
import { createOutput } from '@kjanat/dreamcli';

const tick = async () => {};

const out = createOutput();
const progress = out.progress({
  label: 'Uploading',
  total: 100,
});

for (let i = 0; i <= 100; i++) {
  progress.update(i);
  await tick();
}

progress.done('Upload complete');
```

## Output Modes

The output channel automatically adjusts behavior:

| Context  | Behavior                                             |
| -------- | ---------------------------------------------------- |
| TTY      | Pretty formatting, spinners animate, colors          |
| Piped    | Minimal stable output, spinners suppressed           |
| `--quiet` | Informational text and activity suppressed           |
| `--json` | Structured JSON to stdout, everything else to stderr |

One code path, correct output everywhere.

## Pre-run Render Context

Inside a handler, `out` answers every rendering question: `out.jsonMode`,
`out.verbosity`, `out.isTTY`, `out.color`, `out.isHyperlinkSupported`. Content built **before**
`run()` — a banner, hand-rendered help — has no `out`, and re-deriving the
answers from raw argv goes wrong (`argv.includes('--json')` misreads a
post-`--` literal like `mycli -- --json`).

`resolveRenderContext` runs the same composition `run()` feeds into the output
channel, so pre-run styling matches what will actually render:

```ts twoslash
import { resolveRenderContext } from '@kjanat/dreamcli';

const ctx = resolveRenderContext(process.argv.slice(2), {
  isTTY: process.stdout.isTTY === true,
  env: process.env,
});

// Identity formatters when color is off — style unconditionally
const banner = ctx.color.bold('mycli');
// `ctx.jsonMode` used pre-separator-aware --json detection
if (!ctx.jsonMode && ctx.verbosity !== 'quiet') console.error(banner);
```

The returned `color` is the same gated palette the channel will expose as
`out.color` (`ctx.color.isColorSupported` is the boolean form), and
`ctx.isHyperlinkSupported` honors `NO_HYPERLINKS`/`FORCE_HYPERLINKS` the same
way the help header does.

For just the `--`-aware flag reads, the primitives are also exported:
`includesBeforeSeparator(argv, '--json')` and its strip counterpart
`stripBeforeSeparator`.

## What's Next?

- Related examples: [JSON mode](/examples/json-mode), [Spinner and progress](/examples/spinner-progress)
- [Errors](/guide/errors) — structured error handling
- [Testing](/guide/testing) — capturing output in tests
