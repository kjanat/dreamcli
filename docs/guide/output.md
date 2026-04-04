# Output

Handlers receive `out` instead of `console`.
The output channel adapts to context automatically.

## Basic Output

```ts twoslash
command('deploy').action(({ out }) => {
  out.log('Informational message');
  out.warn('Warning message');
  out.error('Error message');
});
```

## JSON Output

```ts twoslash
out.json({ status: 'ok', count: 42 });
```

When the CLI is invoked with `--json`, all output routes through structured JSON.

## Tables

```ts twoslash
type Row = { name: string; status: string; uptime: number };

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
const spinner = out.spinner('Deploying...');
await deploy();
spinner.succeed('Done');
```

Spinners auto-disable when stdout is not a TTY (CI, piped output).
In `--json` mode, spinners are suppressed entirely.

## Progress Bars

```ts twoslash
const progress = out.progress({ label: 'Uploading', total: 100 });

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

## What's Next?

- Related examples: [JSON mode](/examples/json-mode), [Spinner and progress](/examples/spinner-progress)
- [Errors](/guide/errors) — structured error handling
- [Testing](/guide/testing) — capturing output in tests
