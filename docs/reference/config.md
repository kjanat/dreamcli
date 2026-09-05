# @kjanat/dreamcli/config

Config file and package manifest discovery. `cli().run()` loads this module on demand when
`.config()` or `.manifest()` is active; import it directly for custom bootstrapping or to register
config formats.

```ts twoslash
import {
  buildConfigSearchPaths,
  configFormat,
  discoverConfig,
  discoverManifest,
  inferCliName,
  packageRepositoryUrl,
} from '@kjanat/dreamcli/config';
import type {
  ConfigDiscoveryResult,
  ConfigSearchPathOptions,
  FormatLoader,
  PackageJsonData,
} from '@kjanat/dreamcli/config';
```

The option and result types are also exported from the root entry.


## `buildConfigSearchPaths(appName, options)`

Build the default search-path list dreamcli uses for config discovery. This is mainly useful for
debugging, custom bootstrapping, or help text that wants to show the exact probed paths. The
`ConfigSearchPathOptions` argument carries the scope directories: `baseDir` (project ancestor walk
starts here), `userConfigDirs`, `systemConfigDirs`, and `loaders`.

```ts twoslash
import { buildConfigSearchPaths } from '@kjanat/dreamcli/config';

const paths = buildConfigSearchPaths('mycli', {
  baseDir: process.cwd(),
  userConfigDirs: ['/home/me/.config'],
  systemConfigDirs: ['/etc'],
});
```

## `configFormat(extensions, parseFn)`

Create a config format loader from a list of file extensions and a parse function. Pass the result
to `.configLoader(...)` or `discoverConfig(...)` to add YAML, TOML, or other formats on top of the
built-in JSON loader.

```ts twoslash
import { configFormat } from '@kjanat/dreamcli/config';

declare const parseYaml: (s: string) => unknown;
declare const parseTOML: (s: string) => unknown;
// ---cut---
configFormat(['yaml', 'yml'], parseYaml);
configFormat(['toml'], parseTOML);
```

## `discoverConfig(appName, adapter, options?)`

Low-level config discovery helper behind `cli(...).config(...)`. It searches standard paths, reads
the first matching file via the provided adapter, and returns either `{ found: true, ... }` with
parsed config data or `{ found: false }` when no config file exists.

```ts twoslash
import {
  configFormat,
  discoverConfig,
} from '@kjanat/dreamcli/config';
import { createTestAdapter } from '@kjanat/dreamcli/testkit';

declare const parseYaml: (s: string) => unknown;
declare const parseTOML: (s: string) => unknown;
const adapter = createTestAdapter();
// ---cut---
const result = await discoverConfig('mycli', adapter, {
  loaders: [
    configFormat(['yaml', 'yml'], parseYaml),
    configFormat(['toml'], parseTOML),
  ],
});
```

## `discoverManifest(adapter, options?)`

Walk up from `options.startDir` (or `adapter.cwd` when omitted) and return the nearest parsed manifest
metadata, or `null` when none is found. This is the helper used by `.manifest()` during `.run()`.
`options.files` chooses the candidate filenames in per-directory priority order (default
`['package.json']`); pass `['deno.json', 'deno.jsonc', 'jsr.json']` for Deno / JSR projects. Files are parsed as
JSON with a JSONC fallback (comments and trailing commas are tolerated), and a config-only manifest
with no recognised metadata is skipped so the walk-up continues.

Pass an absolute filesystem path inside your own package as `startDir` (e.g.
`fileURLToPath(import.meta.url)`) when authoring an installable CLI whose version should reflect its
OWN package rather than the consumer's working directory. Unlike `.manifest({ from })`, which also
accepts `import.meta`, a `file:` URL string, or a `URL` instance and normalizes it, this helper takes a
plain path string, so convert URLs yourself first.

```ts twoslash
import { discoverManifest } from '@kjanat/dreamcli/config';
import { createTestAdapter } from '@kjanat/dreamcli/testkit';
import { fileURLToPath } from 'node:url';

const adapter = createTestAdapter();

// Default: walk up from adapter.cwd looking for package.json
const pkg = await discoverManifest(adapter);
if (pkg !== null) {
  console.log(pkg.version);
}

// Deno / JSR: anchored to the CLI's own module, deno.json then jsr.json
const own = await discoverManifest(adapter, {
  startDir: fileURLToPath(import.meta.url),
  files: ['deno.json', 'deno.jsonc', 'jsr.json'],
});
```

> `discoverPackageJson(adapter, startDir?)` was **removed in v4**. Use
> `discoverManifest(adapter, { startDir, files: ['package.json'] })`.

## `inferCliName(pkg, options?)`

Infer a CLI display name from manifest metadata. It prefers the first key from a `bin` object and
otherwise falls back to the `name` field. By default a leading `@scope/` is stripped; pass
`{ stripScope: false }` to keep the full scoped name (`bin` keys are never scoped, so the option only
affects the `name` fallback — relevant for `deno.json` / `jsr.json`, which have no `bin`).

```ts twoslash
import { inferCliName } from '@kjanat/dreamcli/config';

inferCliName({ bin: { mycli: './dist/cli.js' } }); // 'mycli'
inferCliName({ name: '@scope/mycli' }); // 'mycli'
inferCliName(
  { name: '@scope/mycli' },
  { stripScope: false },
); // '@scope/mycli'
```

## `packageRepositoryUrl(pkg, options?)`

Resolve a manifest's `repository` field to a browsable `https://` URL. Handles the locator formats
npm accepts — the `{ type, url }` object form, `git+`-prefixed and `.git`-suffixed URLs, scp-style
locators (`git@host:u/r.git`), and the `github:`/`gitlab:`/`bitbucket:`/bare `u/r` shorthands.
Returns `undefined` when the field is absent or unrecognised. Used by `.links()` to derive the
header name link.

With `{ require: true }` the return type narrows to `string`, and an absent or unrecognised
locator throws a `CLIError` with code `INVALID_REPOSITORY` instead of returning `undefined`.

```ts twoslash
import { packageRepositoryUrl } from '@kjanat/dreamcli/config';

packageRepositoryUrl({
  repository: 'git+https://github.com/me/mycli.git',
});
// 'https://github.com/me/mycli'
packageRepositoryUrl({ repository: 'github:me/mycli' });
// 'https://github.com/me/mycli'

const url: string = packageRepositoryUrl(
  { repository: 'github:me/mycli' },
  { require: true },
);
```

This subpath statically includes config and manifest discovery, so code that only needs
`packageRepositoryUrl` for a manifest it already holds pays for both.

