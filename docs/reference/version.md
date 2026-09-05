# @kjanat/dreamcli/version

DreamCLI's own build-time version constants. They identify the framework build for diagnostics,
bug reports, and completion-script headers; they are unrelated to the app version configured with
`cli().version(...)` or discovered by `.manifest()`.

```ts twoslash
import { DREAMCLI_REVISION, DREAMCLI_VERSION } from '@kjanat/dreamcli/version';
```

## `DREAMCLI_VERSION`

The package version of the installed build (for example `"4.0.0"`), typed `string`. Reads `"dev"`
when the source tree runs unbundled.

## `DREAMCLI_REVISION`

The git short SHA the build was produced from (for example `"f9b5f1a"`), typed `string`. Reads
`"dev"` when the source tree runs unbundled.

Both values change every release. The subpath keeps them out of root-entry import completions.
