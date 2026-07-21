# Upgrading From 2.x To 3.0

This page covers moving an existing dreamcli 2.5.0 CLI to 3.0.0. For adopting
dreamcli from another framework, see [Migration And Adoption](/guide/migration).

Most 2.x CLIs run on 3.0 unchanged. The breaking changes cluster around the
default command, number parsing, and a few removed exports; everything else in
this page is behavioral polish you may notice in output, plus the new surface
worth adopting.

## Breaking Changes

### The default command is the root surface, not a named subcommand

`.default(cmd)` now registers the command only as the default. It is no longer
added to `schema.commands`, so:

- `mycli mycmd` no longer routes to it by name; the token is treated as the
  default command's first positional.
- It is omitted from the root `Commands:` list.

To restore 2.x behavior where the default is also a routable, listed command:

```ts
cli('mycli').default(serve, { route: true });
```

To only re-list it in `Commands:` without name routing:

```ts
cli('mycli').help({ showDefaultInCommands: true });
```

### Number flags and args reject `Infinity` by default

`finite` now defaults to `true`, so `--retries Infinity` errors instead of
passing `Infinity` to your handler. `NaN` was already rejected. Opt back in per
flag:

```ts
flag.number().finite(false);
```

### `createBunAdapter` is removed

Bun exposes a Node-compatible `process`, so the Bun adapter was a passthrough.
Replace explicit uses with `createNodeAdapter` (identical behavior) or rely on
`createAdapter()` auto-detection. `detectRuntime()` still reports `'bun'`.

### `buildConfigSearchPaths` takes an options object

```ts
// 2.x
buildConfigSearchPaths('mycli', cwd, configDir, loaders);
// 3.0
buildConfigSearchPaths('mycli', {
  baseDir: cwd,
  userConfigDirs: [configDir],
  systemConfigDirs: ['/etc'],
  loaders,
});
```

### npm package always resolves built `dist`

The `bun`/`deno` → `src/*.ts` export conditions are gone and `src` is not
published to npm (JSR still ships source). Deep imports into `src/` from the
npm package no longer resolve; import from the public entrypoints.

### `flag.array()` element position is type-restricted

Flag-level modifiers on array elements (`.alias()`, `.env()`, `.default()`,
`.prompt()`, …) were silently ignored in 2.x and are now compile-time errors,
as are `flag.path()` / `flag.count()` / `flag.keyValue()` / nested arrays in
element position. Move the modifier to the array flag itself.

### Runtime version check no longer hard-fails

2.x threw at adapter construction when the Node/Bun/Deno version was below
dreamcli's minimum, crashing the host CLI even on `--help`. The check is gone;
your package manager's `engines` handling owns runtime policy now. If you
relied on it as a guard, enforce your own minimum at startup.

## Behavioral Changes To Review

- **Kebab ↔ camel flag parity is on by default** — `--doThis` matches a flag
  named `do-this` and vice versa. Disable globally with
  `cli('mycli', { flags: { caseParity: false } })` if you depended on strict
  spelling.
- **Config discovery probes more locations** — project scope now walks ancestor
  directories and `.config/`, user scope adds `~/Library/Application Support`
  on macOS, and `/etc/{app}` is a system fallback. First match still wins, but
  a file in a newly probed location can now win where 2.x found nothing. See
  [Config Files](/guide/config) for the exact order.
- **Help output changed** — root help lists built-in flags under
  `Global options:`, the default command renders inline, examples are
  syntax-highlighted, sections are color-themed on TTYs, and width follows the
  live terminal in `.run()`. Golden-help tests from 2.x will need re-recording.
- **`--help` matches like `--version`** — a help flag preceded by other flags
  (`mycli --verbose --help`) now shows help instead of falling through.
- **`--json` respects the `--` separator everywhere** — `mycli cmd -- --json`
  is a positional, not JSON mode, in `.run()`, `.execute()`, and `runCommand()`
  alike.

## New In 3.0

Adopt at your own pace; none of these are required:

- **Validation**: [Standard Schema](https://standardschema.dev) support in
  `flag.custom(schema)` / `arg.custom(schema)`; string and number constraints
  (`.nonEmpty()`, `.pattern()`, `.int()`, `.min()`, …).
- **New flag kinds**: `flag.url()`, `flag.path()` (existence/type checks, and
  `create: true` to mkdir missing directories), `flag.date()`,
  `flag.duration()`, `flag.bytes()`, `flag.count()`, `flag.keyValue()`.
- **Parser control**: `.negatable()` for `--no-foo`, `.duplicates('error')`,
  array `.separator(',')` and `.unique()`.
- **Output**: `out.color` (gated ANSI palette), `out.status()` (stderr status
  lines), global `--quiet`/`-q`, `out.isHyperlinkSupported`,
  `resolveRenderContext()` for pre-run render decisions.
- **Help**: themes, `flagOrder`/`sortFlags`, function-form `.example()`
  receiving the real program name, JSON help (`--help --json`).
- **Completions**: `.completions({ as: 'flag' })` with shell auto-detection.
- **Config**: expanded discovery scopes and `discoverConfig({ baseDir })`.
- **Diagnostics**: `@kjanat/dreamcli/version` exposes `DREAMCLI_VERSION` /
  `DREAMCLI_REVISION`.

See the [CHANGELOG](https://github.com/kjanat/dreamcli/blob/master/CHANGELOG.md)
for the complete rc-by-rc record.
