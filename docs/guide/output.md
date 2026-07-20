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
In `--json` mode, spinners are suppressed entirely.

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
| `--json` | Structured JSON to stdout, everything else to stderr |

One code path, correct output everywhere.

## Pre-run Render Context

Inside a handler, `out` answers every rendering question: `out.jsonMode`,
`out.isTTY`, `out.color`, `out.isHyperlinkSupported`. Content built **before**
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
if (!ctx.jsonMode) console.error(banner);
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
